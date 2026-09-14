const SERVER_FN_FACTORIES = ["createServerQuery", "createServerFn"] as const;

const FARM_CORE_IMPORT_RE =
  /import\s*(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(["'])@farm\.js\/core(?:\/[\w./-]+)?\2/g;

export type ServerFnBoundaryViolation = {
  factory: (typeof SERVER_FN_FACTORIES)[number];
};

/**
 * Detect a module that defines a Farm server function (createServerQuery /
 * createServerFn) while being compiled for the client environment. Without
 * the server-function transform (@farm.js/plugin/rsc with
 * experimental.serverActions enabled) there is no client stub: the server
 * handler and its dependency graph would be bundled into the browser and
 * executed there, surfacing as confusing Vite externalization errors for
 * Node built-ins (#408).
 */
export function findClientServerFnViolation(
  code: string,
  id: string,
): ServerFnBoundaryViolation | null {
  if (id.startsWith("\0") || id.startsWith("virtual:") || id.includes("node_modules")) return null;
  if (!code.includes("@farm.js/core")) return null;

  for (const match of code.matchAll(FARM_CORE_IMPORT_RE)) {
    const specifiers = match[1];
    for (const factory of SERVER_FN_FACTORIES) {
      if (!new RegExp(`(?:^|[\\s{,])${factory}(?:[\\s},]|$)`).test(specifiers)) continue;
      // Only a call site makes the module a server-function definition; a
      // type-only or re-exported symbol never executes a handler.
      if (new RegExp(`(?<![\\w$.])${factory}\\s*(?:<[^>]*>)?\\s*\\(`).test(code)) {
        return { factory };
      }
    }
  }
  return null;
}

/** Markdown examples are content; ESM declarations and MDX expressions are not. */
export async function findMarkdownServerFnViolation(
  code: string,
  id: string,
): Promise<ServerFnBoundaryViolation | null> {
  const violation = findClientServerFnViolation(code, id);
  if (!violation) return null;

  // Reuse the Markdown compiler's parser only for a potential violation. Normal
  // JS/TS transforms and Markdown without server-function examples stay cheap.
  const { createProcessor } = await import("@mdx-js/mdx");
  let tree;
  try {
    tree = createProcessor().parse(code);
  } catch {
    // Unsupported/invalid syntax must not silently disable a boundary check.
    return violation;
  }

  type Node = {
    type: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: Node[];
  };
  const ranges: [number, number][] = [];
  const visit = (node: Node) => {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push([start, end]);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  for (const [start, end] of ranges.reverse()) {
    code = code.slice(0, start) + code.slice(start, end).replace(/[^\r\n]/g, " ") + code.slice(end);
  }
  return findClientServerFnViolation(code, id);
}

export function formatServerFnBoundaryError(
  violation: ServerFnBoundaryViolation,
  id: string,
): string {
  return [
    `${violation.factory} handlers run only on the server, but ${id} is being bundled into the client.`,
    `Importing a ${violation.factory} module from client code executes the server handler (and its Node-only imports) in the browser.`,
    `Either enable the server-function transform (add @farm.js/plugin/rsc and set experimental.serverActions: true in farm.config.ts) so client imports become server references,`,
    `or keep the query on the server: call it from server components, or expose an API route and use createAPIClient from the client.`,
  ].join("\n");
}
