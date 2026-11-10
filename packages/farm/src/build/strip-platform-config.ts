import { realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Config keys that only the CLI reads. Their values never belong in a server bundle. */
const PLATFORM_CONFIG_KEYS = new Set(["desktop", "mobile"]);
const CONFIG_FACTORIES = new Set(["defineConfig", "defineFarmConfig"]);

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isConfigObject(node: Node | undefined): node is Node & { properties: Node[] } {
  return node?.type === "ObjectExpression";
}

function propertyName(property: Node): string | undefined {
  if (property.type !== "Property" || property.computed) return undefined;
  const key = property.key as Node & { name?: string; value?: unknown };
  if (key.type === "Identifier") return key.name;
  return typeof key.value === "string" ? key.value : undefined;
}

/** Object literals that are the config: `export default {…}` and `defineConfig({…})`. */
function collectConfigObjects(node: unknown, found: Node[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectConfigObjects(child, found);
    return;
  }
  const current = node as Node;
  if (current.type === "ExportDefaultDeclaration") {
    const declaration = current.declaration as Node;
    if (isConfigObject(declaration)) found.push(declaration);
  }
  if (current.type === "CallExpression") {
    const callee = current.callee as Node & { name?: string; property?: Node & { name?: string } };
    const name = callee.type === "Identifier" ? callee.name : callee.property?.name;
    const argument = (current.arguments as Node[])[0];
    if (name && CONFIG_FACTORIES.has(name) && isConfigObject(argument)) found.push(argument);
  }
  for (const key of Object.keys(current)) {
    if (key !== "start" && key !== "end" && key !== "type") {
      collectConfigObjects(current[key], found);
    }
  }
}

/**
 * Remove the `desktop` and `mobile` entries from the farm.config modules a server build imports.
 * A server needs the config's plugins, middleware, and integrations at runtime, but a platform
 * block (or the function that returns one, with whatever it imports) is CLI input. Without the
 * entries, a web build is byte-identical whether or not the app has them. Configs built some
 * other way keep them.
 */
export function stripPlatformConfigSource(
  code: string,
  parse: (code: string) => unknown,
): string | null {
  if (!code.includes("desktop") && !code.includes("mobile")) return null;
  const objects: Node[] = [];
  collectConfigObjects(parse(code), objects);
  const removals: Array<[number, number]> = [];
  for (const object of objects) {
    const properties = (object as Node & { properties: Node[] }).properties;
    const removed = properties.map((property) => {
      const name = propertyName(property);
      return !!name && PLATFORM_CONFIG_KEYS.has(name);
    });
    // One removal per run of adjacent entries (`desktop` next to `mobile`), taking the
    // separating comma with it, so ranges never overlap and the literal stays valid.
    for (let first = 0; first < properties.length; first++) {
      if (!removed[first]) continue;
      let last = first;
      while (last + 1 < properties.length && removed[last + 1]) last++;
      if (last < properties.length - 1) {
        removals.push([properties[first].start, properties[last + 1].start]);
      } else if (first > 0) {
        removals.push([properties[first - 1].end, properties[last].end]);
      } else {
        const trailingComma = /^\s*,/.exec(code.slice(properties[last].end));
        removals.push([
          properties[first].start,
          properties[last].end + (trailingComma?.[0].length ?? 0),
        ]);
      }
      first = last;
    }
  }
  if (removals.length === 0) return null;
  removals.sort((left, right) => right[0] - left[0]);
  let output = code;
  for (const [start, end] of removals) output = output.slice(0, start) + output.slice(end);
  return output;
}

/** Module ids are real paths (a temp dir under /var is /private/var on macOS). */
function realPath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

export function farmStripPlatformConfigPlugin(configFiles: readonly string[]): Plugin {
  const files = new Set(configFiles.flatMap((file) => [path.resolve(file), realPath(file)]));
  return {
    name: "farm:strip-platform-config",
    // Before the TypeScript transform, so its import elision also drops imports only the
    // removed block used (`readFileSync` for a version, say).
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?", 1)[0];
      if (!files.has(path.resolve(file)) && !files.has(realPath(file))) return null;
      const { parseAst } = await import("rolldown/parseAst");
      const extension = path.extname(file).slice(1);
      const lang = /^[cm]?tsx?$/.test(extension)
        ? extension.endsWith("x")
          ? "tsx"
          : "ts"
        : extension.endsWith("x")
          ? "jsx"
          : "js";
      const stripped = stripPlatformConfigSource(code, (source) => parseAst(source, { lang }));
      return stripped === null ? null : { code: stripped, map: null };
    },
  };
}
