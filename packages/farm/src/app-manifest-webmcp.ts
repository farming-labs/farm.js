/**
 * WebMCP tools for the app manifest. They're defined and registered in browser code, so the
 * server never holds them: this reads the app's source files instead, finding
 * `defineWebMCPTool({ ... })` and `registerWebMCPTool({ ... })` calls imported from
 * `@farm.js/webmcp/client`, and keeps what's written there as plain data: the name, title,
 * description and hints, and the input schema when it's a literal. A schema computed at
 * runtime (`z.toJSONSchema(...)`) is reported as such, without guessing.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import fg from "fast-glob";

export interface FarmAppManifestWebMCPTool {
  name: string;
  title?: string;
  description?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  /** The input JSON Schema when the source writes it out; omitted when it's computed. */
  inputSchema?: Record<string, unknown>;
  /** `"computed"` when the schema is built at runtime, so it can't be read from source. */
  inputSchemaSource: "literal" | "computed" | "none";
}

const WEBMCP_CLIENT = "@farm.js/webmcp/client";
const DEFINERS = new Set(["defineWebMCPTool", "registerWebMCPTool", "registerWebMCPTools"]);
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;
const MAX_TOOLS = 500;
const MAX_SCHEMA_BYTES = 64 * 1024;
const NOT_STATIC = Symbol("not static");
const LANGS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
  js: "jsx",
  mjs: "jsx",
  cjs: "jsx",
  jsx: "jsx",
};

type Node = { type: string; [key: string]: any };

let parseAst: (typeof import("rolldown/parseAst"))["parseAst"] | undefined;

/** A literal JSON value, or NOT_STATIC for anything computed. */
function staticValue(node: Node | null | undefined): unknown {
  if (!node) return NOT_STATIC;
  switch (node.type) {
    case "Literal":
      return node.regex || typeof node.value === "bigint" ? NOT_STATIC : node.value;
    case "TemplateLiteral":
      return node.expressions.length ? NOT_STATIC : node.quasis[0].value.cooked;
    case "UnaryExpression":
      if (
        node.operator === "-" &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      )
        return -node.argument.value;
      return NOT_STATIC;
    case "ArrayExpression": {
      const items = [];
      for (const element of node.elements) {
        const value = staticValue(element);
        if (value === NOT_STATIC) return NOT_STATIC;
        items.push(value);
      }
      return items;
    }
    case "ObjectExpression": {
      const object: Record<string, unknown> = {};
      for (const property of node.properties) {
        if (property.type !== "Property" || property.computed || property.kind !== "init")
          return NOT_STATIC;
        const key =
          property.key.type === "Identifier" ? property.key.name : staticValue(property.key);
        if (typeof key !== "string" || key === "__proto__") return NOT_STATIC;
        const value = staticValue(property.value);
        if (value === NOT_STATIC) return NOT_STATIC;
        object[key] = value;
      }
      return object;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return staticValue(node.expression);
    default:
      return NOT_STATIC;
  }
}

function property(object: Node, name: string): Node | undefined {
  return object.properties.find(
    (entry: Node) =>
      entry.type === "Property" &&
      !entry.computed &&
      (entry.key.name === name || entry.key.value === name),
  )?.value;
}

function toolFromObject(object: Node): FarmAppManifestWebMCPTool | null {
  const name = staticValue(property(object, "name"));
  if (typeof name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(name)) return null;
  const text = (key: string) => {
    const value = staticValue(property(object, key));
    return typeof value === "string" && value.length <= 2000 ? value : undefined;
  };
  const annotations = staticValue(property(object, "annotations"));
  const hints =
    annotations && typeof annotations === "object" && !Array.isArray(annotations)
      ? Object.fromEntries(
          HINTS.filter(
            (hint) => typeof (annotations as Record<string, unknown>)[hint] === "boolean",
          ).map((hint) => [hint, (annotations as Record<string, unknown>)[hint]]),
        )
      : {};
  const schemaNode = property(object, "inputSchema");
  const schema = staticValue(schemaNode);
  const literal =
    schema !== NOT_STATIC &&
    schema !== null &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    Buffer.byteLength(JSON.stringify(schema)) <= MAX_SCHEMA_BYTES;
  const title = text("title");
  const description = text("description");
  return {
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...hints,
    ...(literal ? { inputSchema: schema as Record<string, unknown> } : {}),
    inputSchemaSource: literal ? "literal" : schemaNode ? "computed" : "none",
  };
}

/** Tools defined in one module, by the local names its webmcp client imports have. */
export function findFarmWebMCPTools(
  code: string,
  filename = "module.tsx",
): FarmAppManifestWebMCPTool[] {
  if (!code.includes(WEBMCP_CLIENT)) return [];
  const lang = LANGS[path.extname(filename).slice(1)] ?? "tsx";
  // Required on the first module that imports the client rather than imported, so loading
  // core (a production server does, through farm.config) never loads the native parser.
  parseAst ??= (
    createRequire(typeof __filename === "string" ? __filename : import.meta.url)(
      "rolldown/parseAst",
    ) as typeof import("rolldown/parseAst")
  ).parseAst;
  let program: Node;
  try {
    program = parseAst(code, { lang }) as unknown as Node;
  } catch {
    return [];
  }
  const locals = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== WEBMCP_CLIENT)
      continue;
    for (const specifier of statement.specifiers) {
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      if (specifier.type === "ImportSpecifier" && DEFINERS.has(imported))
        locals.set(specifier.local.name, imported);
    }
  }
  if (!locals.size) return [];
  const found: { start: number; tool: FarmAppManifestWebMCPTool }[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const current = node as Node;
    if (current.type === "CallExpression" && current.callee.type === "Identifier") {
      const definer = locals.get(current.callee.name);
      const [argument] = current.arguments;
      if (definer && argument) {
        const objects =
          definer === "registerWebMCPTools"
            ? argument.type === "ArrayExpression"
              ? argument.elements.filter(
                  (element: Node | null) => element?.type === "ObjectExpression",
                )
              : []
            : argument.type === "ObjectExpression"
              ? [argument]
              : [];
        for (const object of objects) {
          const tool = toolFromObject(object);
          if (tool) found.push({ start: object.start, tool });
        }
      }
    }
    for (const [key, value] of Object.entries(current))
      if (key !== "type" && value && typeof value === "object") visit(value);
  };
  visit(program.body);
  // In the order they're written.
  return found.sort((a, b) => a.start - b.start).map(({ tool }) => tool);
}

const cache = new Map<string, { mtimeMs: number; tools: FarmAppManifestWebMCPTool[] }>();

/**
 * Every WebMCP tool the app's source defines, first definition of a name wins. Reads files
 * that mention the webmcp client only, and rereads a file only after it changes.
 */
export function collectFarmWebMCPTools(root: string, srcDir = "src"): FarmAppManifestWebMCPTool[] {
  const base = path.resolve(root, srcDir);
  let files: string[];
  try {
    files = fg.sync("**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}", {
      cwd: base,
      absolute: true,
      ignore: ["**/node_modules/**", "**/*.d.ts", "**/*.{test,spec}.*", "**/__tests__/**"],
    });
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const tools: FarmAppManifestWebMCPTool[] = [];
  for (const file of files.sort()) {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    let entry = cache.get(file);
    if (!entry || entry.mtimeMs !== mtimeMs) {
      let code = "";
      try {
        code = fs.readFileSync(file, "utf8");
      } catch {
        /* Gone since listing. */
      }
      entry = { mtimeMs, tools: findFarmWebMCPTools(code, file) };
      cache.set(file, entry);
    }
    for (const tool of entry.tools) {
      if (seen.has(tool.name) || tools.length >= MAX_TOOLS) continue;
      seen.add(tool.name);
      tools.push(tool);
    }
  }
  return tools;
}
