/**
 * Diagnostics for server-only access in modules compiled for the client.
 *
 * A module entering the client graph runs in the browser. Module-scope reads
 * of non-public process.env values evaluate to undefined there and broke
 * layout hydration in #560, and Node builtin imports resolve to browser
 * stubs whose exports are mostly undefined (see browser-builtins.ts). Both
 * deserve a clear build-time warning naming the module instead of a runtime
 * mystery (#1065).
 */
import { builtinModules, isBuiltin } from "node:module";
import { createFarmDiagnostic, type FarmDiagnostic, type FarmSourceLocation } from "./diagnostics";

type EstreeNode = { type: string; start?: number; [key: string]: unknown };

const FUNCTION_BODY_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// The names a bare builtin specifier starts with: `fs`, or `path` for `path/posix`.
const BARE_BUILTIN_NAMES = new Set(
  builtinModules
    .filter((name) => !name.startsWith("_") && !name.includes(":"))
    .map((name) => name.split("/", 1)[0]!),
);

// A bare builtin specifier (`"fs"`, `"path/posix"`) in an import, dynamic import, re-export, or
// require call. Only a prefilter: the AST decides, and the resolver whether the browser gets a stub.
const BARE_BUILTIN_SPECIFIER_RE = new RegExp(
  String.raw`(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'](?:` +
    [...BARE_BUILTIN_NAMES].join("|") +
    String.raw`)(?:/[^"']*)?["']`,
);

// What comes right before a string in specifier position: `from`, `import`, `import(`, `require(`.
const SPECIFIER_POSITION_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*$/;

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

// Characters in a builtin module's name: lowercase letters, digits and `_` (`worker_threads`, `v8`).
function isBuiltinNameCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
}

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
 * strings, comments and regular expressions, a string that starts with `node:` (an import or
 * require specifier), or a bare builtin such as `"fs"` in specifier position. The parse that
 * analysis needs is the expensive part, and a module that only mentions these inside a literal,
 * such as a compiled Markdown page's code samples, needs none.
 */
export function mayUseServerOnlyApis(code: string): boolean {
  if (
    !code.includes("process.env") &&
    !code.includes("node:") &&
    !BARE_BUILTIN_SPECIFIER_RE.test(code)
  ) {
    return false;
  }

  // Brace depth inside each open template-literal `${` expression.
  const templateBraces: number[] = [];
  let index = 0;
  // The last significant code character, and the identifier it ends, decide whether a slash
  // starts a regular expression.
  let previous = 0;
  let previousWordStart = -1;

  // A string token, opened by the quote at `quote`, that names a builtin: `node:` anything, or a
  // bare builtin name, alone or with a subpath, right after `from`, `import` or `require(`.
  const startsBuiltinSpecifier = (quote: number) => {
    const start = quote + 1;
    if (code.startsWith("node:", start)) return true;
    let end = start;
    while (end < code.length && isBuiltinNameCode(code.charCodeAt(end))) end += 1;
    const after = code.charCodeAt(end);
    return (
      end > start &&
      (after === code.charCodeAt(quote) || after === 47) /* / */ &&
      BARE_BUILTIN_NAMES.has(code.slice(start, end)) &&
      SPECIFIER_POSITION_RE.test(code.slice(Math.max(0, quote - 16), quote))
    );
  };

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
      if (startsBuiltinSpecifier(index)) return true;
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
      if (startsBuiltinSpecifier(index)) return true;
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

export type ClientBoundaryFindingKind =
  /** A non-public process.env key read at module scope. */
  | "server-env"
  /**
   * A declared-public key read through process.env at module scope. The value
   * is still undefined in the browser (only publicEnv is populated there), so
   * it gets its own diagnostic pointing at the supported accessor.
   */
  | "public-env"
  /** A Node builtin imported at module scope (`node:fs`, or bare `fs`). */
  | "builtin";

export interface ClientBoundaryFinding {
  kind: ClientBoundaryFindingKind;
  /** The process.env key, or the builtin specifier as written. */
  name: string;
  /** Offset of the read or import in the analyzed code. */
  start: number;
}

/**
 * One walk over the module AST for every client-boundary finding, in source
 * order, each name reported once per kind at its first occurrence.
 *
 * Reads and dynamic imports inside function bodies are skipped: they may be
 * server-gated at runtime — a lazy `await import("node:fs")` behind a server
 * check is the recommended escape hatch — and flagging them would drown the
 * signal in noise. Static import/export-from declarations always execute at
 * module scope, so they are always flagged.
 *
 * A bare specifier is reported whenever Node has a builtin by that name. The
 * browser may get a real package instead (an installed `events` or `buffer`),
 * so the caller checks how it resolves before reporting it.
 */
export function analyzeClientBoundary(
  program: EstreeNode,
  publicKeys: ReadonlySet<string>,
): ClientBoundaryFinding[] {
  const findings: ClientBoundaryFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: ClientBoundaryFindingKind, name: string, node: EstreeNode) => {
    const key = `${kind}\0${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, name, start: node.start ?? 0 });
  };
  const addEnvKey = (key: string, node: EstreeNode) => {
    if (key !== "NODE_ENV") add(publicKeys.has(key) ? "public-env" : "server-env", key, node);
  };

  const visit = (node: unknown, inFunction: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, inFunction);
      return;
    }
    const estree = node as EstreeNode;
    if (typeof estree.type !== "string") return;

    if (!inFunction) {
      const builtin = readBuiltinSource(estree);
      if (builtin !== undefined) add("builtin", builtin, estree);

      const key = readProcessEnvKey(estree);
      if (key !== undefined) {
        addEnvKey(key, estree);
        return;
      }

      // `const { DATABASE_URL } = process.env` reads each named key at module scope.
      if (
        estree.type === "VariableDeclarator" &&
        isProcessEnv(estree.init as EstreeNode | undefined) &&
        (estree.id as EstreeNode | undefined)?.type === "ObjectPattern"
      ) {
        for (const property of (estree.id as { properties?: EstreeNode[] }).properties ?? []) {
          if (property.type !== "Property") continue;
          const name = readPropertyKey(property);
          if (name !== undefined) addEnvKey(name, property);
        }
        visit((estree.id as EstreeNode).properties, inFunction);
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
  return findings;
}

function readBuiltinSource(node: EstreeNode): string | undefined {
  let value: unknown;
  if (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration" ||
    node.type === "ImportExpression"
  ) {
    value = (node.source as { value?: unknown } | null | undefined)?.value;
  } else if (node.type === "CallExpression") {
    const callee = node.callee as EstreeNode | undefined;
    if (callee?.type === "Identifier" && (callee as { name?: string }).name === "require") {
      const arg = (node.arguments as EstreeNode[] | undefined)?.[0];
      value = arg?.type === "Literal" ? (arg as { value?: unknown }).value : undefined;
    }
  }
  return typeof value === "string" && isBuiltin(value) ? value : undefined;
}

function isProcessEnv(node: EstreeNode | undefined): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    (node.object as EstreeNode | undefined)?.type === "Identifier" &&
    (node.object as { name?: string }).name === "process" &&
    (node.property as { name?: string } | undefined)?.name === "env"
  );
}

function readProcessEnvKey(node: EstreeNode): string | undefined {
  if (node.type !== "MemberExpression" || !isProcessEnv(node.object as EstreeNode)) {
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

function readPropertyKey(property: EstreeNode): string | undefined {
  const key = property.key as EstreeNode | undefined;
  if (!property.computed && key?.type === "Identifier") return (key as { name?: string }).name;
  const value = key?.type === "Literal" ? (key as { value?: unknown }).value : undefined;
  return typeof value === "string" ? value : undefined;
}

/** The diagnostic for one finding in `file`, at `location` in its original source when known. */
export function createClientBoundaryDiagnostic(
  file: string,
  finding: ClientBoundaryFinding,
  location?: FarmSourceLocation,
): FarmDiagnostic {
  switch (finding.kind) {
    case "server-env":
      return createFarmDiagnostic(
        "CLIENT_SERVER_ENV",
        file,
        `process.env.${finding.name} is read at module scope in a module compiled for the browser, where it is undefined.`,
        location,
      );
    case "public-env":
      return createFarmDiagnostic(
        "CLIENT_PROCESS_ENV_PUBLIC",
        file,
        `process.env.${finding.name} is declared public, but process.env is not populated in the browser, so this module-scope read is undefined there.`,
        location,
      );
    case "builtin":
      return createFarmDiagnostic(
        "CLIENT_NODE_BUILTIN",
        file,
        `"${finding.name}" is imported into a module compiled for the browser, which gets a stub whose exports without a Web API equivalent are undefined.`,
        location,
      );
  }
}
