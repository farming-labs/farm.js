/**
 * Diagnostics for server-only access in modules compiled for the client.
 *
 * A module entering the client graph runs in the browser. Module-scope reads
 * of non-public process.env values evaluate to undefined there and broke
 * layout hydration in #560, and node: builtin imports are silently stubbed
 * with empty objects by farm:browser-external-stub. Both deserve a clear
 * build-time warning naming the module instead of a runtime mystery (#1065).
 */

type EstreeNode = { type: string; [key: string]: unknown };

const FUNCTION_BODY_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

export function shouldInspectClientBoundary(id: string, code: string): boolean {
  if (id.startsWith("\0") || id.startsWith("virtual:") || id.includes("node_modules")) return false;
  return code.includes("process.env") || code.includes("node:");
}

export interface ClientBoundaryFindings {
  /** Non-public process.env keys read at module scope. */
  envKeys: string[];
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
        if (key !== "NODE_ENV" && !publicKeys.has(key)) envKeys.add(key);
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
  return { envKeys: [...envKeys], builtinImports: [...builtinImports] };
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

export function formatClientBoundaryWarning(
  id: string,
  envKeys: string[],
  builtinImports: string[],
): string {
  const lines = [`${id} is compiled for the client but uses server-only APIs:`];
  if (envKeys.length > 0) {
    lines.push(
      `- module-scope read of process.env.${envKeys.join(", process.env.")} — undefined in the browser. Move the read behind a server boundary, or expose it through env.public in farm.config.ts.`,
    );
  }
  if (builtinImports.length > 0) {
    lines.push(
      `- import of ${builtinImports.join(", ")} — stubbed with an empty object in the browser. Move the import into server-only code.`,
    );
  }
  return lines.join("\n");
}
