import { createFarmDiagnostic, type FarmDiagnostic, type FarmSourceLocation } from "./diagnostics";

const SERVER_FN_FACTORIES = ["createServerQuery", "createServerFn"] as const;

const FARM_CORE_IMPORT_RE =
  /import\s*(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(["'])@farm\.js\/core(?:\/[\w./-]+)?\2/g;

export type ServerFnBoundaryViolation = {
  factory: (typeof SERVER_FN_FACTORIES)[number];
  /** Offset of the first call to the factory in the analyzed code. */
  start: number;
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
  // Markdown modules never execute import statements: matched text is
  // documentation (fenced code examples), not code, before and after the
  // markdown transform (fences compile to string content).
  if (/\.(md|mdx)(\?|$)/.test(id)) return null;
  if (!code.includes("@farm.js/core")) return null;

  for (const match of code.matchAll(FARM_CORE_IMPORT_RE)) {
    const specifiers = match[1];
    for (const factory of SERVER_FN_FACTORIES) {
      if (!new RegExp(`(?:^|[\\s{,])${factory}(?:[\\s},]|$)`).test(specifiers)) continue;
      // Only a call site makes the module a server-function definition; a
      // type-only or re-exported symbol never executes a handler.
      const call = new RegExp(`(?<![\\w$.])${factory}\\s*(?:<[^>]*>)?\\s*\\(`).exec(code);
      if (call) return { factory, start: call.index };
    }
  }
  return null;
}

export function createServerFnBoundaryDiagnostic(
  violation: ServerFnBoundaryViolation,
  id: string,
  location?: FarmSourceLocation,
): FarmDiagnostic {
  return createFarmDiagnostic(
    "CLIENT_SERVER_FUNCTION",
    id,
    `${violation.factory} handlers run only on the server, but this module is bundled into the client, so the handler and its Node-only imports would run in the browser.`,
    location,
  );
}
