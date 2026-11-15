/**
 * Diagnostics for server-only access in modules compiled for the client.
 *
 * A module entering the client graph runs in the browser. Module-scope reads
 * of non-public process.env values evaluate to undefined there and broke
 * layout hydration in #560, and node: builtin imports resolve to browser
 * stubs whose exports are mostly undefined (see browser-builtins.ts). Both
 * deserve a clear build-time warning naming the module instead of a runtime
 * mystery (#1065).
 */

type EstreeNode = { type: string; [key: string]: unknown };

const FUNCTION_BODY_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

export function shouldInspectClientBoundary(id: string, code: string): boolean {
  if (id.startsWith("\0") || id.startsWith("virtual:") || id.includes("node_modules")) return false;
  return mayUseServerOnlyApis(code);
}

// Identifiers after which a slash starts a regular expression, not a division.
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function isIdentifierCode(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 36 ||
    code > 127
  );
}

/**
 * Whether the module could hold what `analyzeClientBoundary` reports: `process.env` outside
 * strings, comments and regular expressions, or a string that starts with `node:` (an import or
 * require specifier). The parse that analysis needs is the expensive part, and a module that only
 * mentions either inside a literal, such as a compiled Markdown page's code samples, needs none.
 */
export function mayUseServerOnlyApis(code: string): boolean {
  if (!code.includes("process.env") && !code.includes("node:")) return false;

  // Brace depth inside each open template-literal `${` expression.
  const templateBraces: number[] = [];
  let index = 0;
  // The last significant code character, and the identifier it ends, decide whether a slash
  // starts a regular expression.
  let previous = 0;
  let previousWordStart = -1;

  const startsNodeSpecifier = (start: number) => code.startsWith("node:", start);

  const skipTemplateText = (): boolean => {
    while (index < code.length) {
      const character = code.charCodeAt(index);
      if (character === 92 /* \\ */) {
        index += 2;
      } else if (character === 96 /* ` */) {
        index += 1;
        previous = 96;
        return false;
      } else if (character === 36 /* $ */ && code.charCodeAt(index + 1) === 123 /* { */) {
        index += 2;
        templateBraces.push(0);
        previous = 123;
        return true;
      } else {
        index += 1;
      }
    }
    return false;
  };

  while (index < code.length) {
    const character = code.charCodeAt(index);
    const next = code.charCodeAt(index + 1);

    if (character === 47 /* / */ && next === 47) {
      const end = code.indexOf("\n", index);
      index = end === -1 ? code.length : end;
      continue;
    }
    if (character === 47 && next === 42 /* * */) {
      const end = code.indexOf("*/", index + 2);
      index = end === -1 ? code.length : end + 2;
      continue;
    }
    if (character === 39 /* ' */ || character === 34 /* " */) {
      if (startsNodeSpecifier(index + 1)) return true;
      index += 1;
      while (index < code.length) {
        const inner = code.charCodeAt(index);
        if (inner === 92) {
          index += 2;
          continue;
        }
        index += 1;
        if (inner === character || inner === 10 /* \n */) break;
      }
      previous = character;
      continue;
    }
    if (character === 96) {
      if (startsNodeSpecifier(index + 1)) return true;
      index += 1;
      skipTemplateText();
      continue;
    }
    if (character === 47) {
      const word = previousWordStart === -1 ? "" : code.slice(previousWordStart, index).trim();
      const startsExpression =
        !(isIdentifierCode(previous) || previous === 41 /* ) */ || previous === 93) /* ] */ ||
        KEYWORDS_BEFORE_EXPRESSION.has(word);
      index += 1;
      if (startsExpression) {
        let inClass = false;
        while (index < code.length) {
          const inner = code.charCodeAt(index);
          if (inner === 10) break;
          index += 1;
          if (inner === 92) index += 1;
          else if (inner === 91 /* [ */) inClass = true;
          else if (inner === 93) inClass = false;
          else if (inner === 47 && !inClass) break;
        }
        previous = 41;
        previousWordStart = -1;
      } else {
        previous = 47;
        previousWordStart = -1;
      }
      continue;
    }
    if (templateBraces.length > 0 && (character === 123 || character === 125)) {
      const depth = templateBraces.length - 1;
      if (character === 123) {
        templateBraces[depth]! += 1;
      } else if (templateBraces[depth] === 0) {
        templateBraces.pop();
        index += 1;
        skipTemplateText();
        continue;
      } else {
        templateBraces[depth]! -= 1;
      }
    }
    if (isIdentifierCode(character)) {
      const start = index;
      if (
        character === 112 /* p */ &&
        code.startsWith("process.env", index) &&
        !isIdentifierCode(previous === 0 ? 32 : code.charCodeAt(index - 1))
      ) {
        return true;
      }
      while (index < code.length && isIdentifierCode(code.charCodeAt(index))) index += 1;
      previous = code.charCodeAt(index - 1);
      previousWordStart = start;
      continue;
    }
    if (character > 32) {
      previous = character;
      previousWordStart = -1;
    }
    index += 1;
  }
  return false;
}

export interface ClientBoundaryFindings {
  /** Non-public process.env keys read at module scope. */
  envKeys: string[];
  /**
   * Declared-public keys read via process.env at module scope. The value is
   * still undefined in the browser — only publicEnv is populated there — so
   * these get their own warning pointing at the supported accessor.
   */
  publicEnvKeys: string[];
  /** node: builtin specifiers imported into the module. */
  builtinImports: string[];
}

/**
 * One walk over the module AST for both diagnostics.
 *
 * Reads and dynamic imports inside function bodies are skipped: they may be
 * server-gated at runtime — a lazy `await import("node:fs")` behind a server
 * check is the recommended escape hatch — and flagging them would drown the
 * signal in noise. Static import/export-from declarations always execute at
 * module scope, so they are always flagged.
 */
export function analyzeClientBoundary(
  program: EstreeNode,
  publicKeys: ReadonlySet<string>,
): ClientBoundaryFindings {
  const envKeys = new Set<string>();
  const publicEnvKeys = new Set<string>();
  const builtinImports = new Set<string>();

  const visit = (node: unknown, inFunction: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, inFunction);
      return;
    }
    const estree = node as EstreeNode;
    if (typeof estree.type !== "string") return;

    if (!inFunction) {
      const builtin = readNodeBuiltinSource(estree);
      if (builtin !== undefined) builtinImports.add(builtin);

      const key = readProcessEnvKey(estree);
      if (key !== undefined) {
        if (key !== "NODE_ENV") {
          (publicKeys.has(key) ? publicEnvKeys : envKeys).add(key);
        }
        return;
      }
    }

    // Params and defaults evaluate at call time along with the body.
    const nextInFunction = inFunction || FUNCTION_BODY_TYPES.has(estree.type);
    for (const [childKey, value] of Object.entries(estree)) {
      if (childKey === "type") continue;
      visit(value, nextInFunction);
    }
  };

  visit((program as { body?: unknown }).body, false);
  return {
    envKeys: [...envKeys],
    publicEnvKeys: [...publicEnvKeys],
    builtinImports: [...builtinImports],
  };
}

function readNodeBuiltinSource(node: EstreeNode): string | undefined {
  if (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration" ||
    node.type === "ImportExpression"
  ) {
    const value = (node.source as { value?: unknown } | null | undefined)?.value;
    return typeof value === "string" && value.startsWith("node:") ? value : undefined;
  }
  if (node.type === "CallExpression") {
    const callee = node.callee as EstreeNode | undefined;
    if (callee?.type === "Identifier" && (callee as { name?: string }).name === "require") {
      const arg = (node.arguments as EstreeNode[] | undefined)?.[0];
      const value = arg?.type === "Literal" ? (arg as { value?: unknown }).value : undefined;
      return typeof value === "string" && value.startsWith("node:") ? value : undefined;
    }
  }
  return undefined;
}

function readProcessEnvKey(node: EstreeNode): string | undefined {
  if (node.type !== "MemberExpression") return undefined;
  const object = node.object as EstreeNode | undefined;
  if (
    !object ||
    object.type !== "MemberExpression" ||
    (object.object as EstreeNode | undefined)?.type !== "Identifier" ||
    (object.object as { name?: string }).name !== "process" ||
    (object.property as { name?: string })?.name !== "env"
  ) {
    return undefined;
  }

  const property = node.property as EstreeNode | undefined;
  if (!property) return undefined;
  if (!node.computed && property.type === "Identifier") {
    return (property as { name?: string }).name;
  }
  if (node.computed && property.type === "Literal") {
    const value = (property as { value?: unknown }).value;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function formatClientBoundaryWarning(id: string, findings: ClientBoundaryFindings): string {
  const { envKeys, publicEnvKeys, builtinImports } = findings;
  const lines = [`${id} is compiled for the client but uses server-only APIs:`];
  if (envKeys.length > 0) {
    lines.push(
      `- module-scope read of process.env.${envKeys.join(", process.env.")} — undefined in the browser. Move the read behind a server boundary, or expose it through env.public in farm.config.ts.`,
    );
  }
  if (publicEnvKeys.length > 0) {
    lines.push(
      `- module-scope read of process.env.${publicEnvKeys.join(", process.env.")} — process.env is not populated in the browser even for public keys. Read it through publicEnv from "@farm.js/core/env".`,
    );
  }
  if (builtinImports.length > 0) {
    lines.push(
      `- import of ${builtinImports.join(", ")} — stubbed in the browser, where exports without a Web API equivalent are undefined. Move the import into server-only code.`,
    );
  }
  return lines.join("\n");
}
