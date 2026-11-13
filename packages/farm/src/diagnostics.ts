/**
 * Stable codes for the build diagnostics Farm reports.
 *
 * Every diagnostic names its code, where it happened, what is wrong, how to fix it, and where the
 * rule is documented, so a developer or a coding agent can act on the line alone and look the code
 * up when it needs more. Codes follow `farm doctor`'s: upper snake case, never reused for another
 * rule. The text is formatted like a TypeScript diagnostic, which editors and CI problem matchers
 * already read: `src/widget.tsx:10:13 - warning CLIENT_SERVER_ENV: …`.
 */
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import path from "node:path";

export type FarmDiagnosticSeverity = "error" | "warning";

interface FarmDiagnosticRule {
  severity: FarmDiagnosticSeverity;
  fix: string;
  /** Docs path whose section documents the rule. */
  docs: string;
}

const CLIENT_BOUNDARY_DOCS = "/docs/environment-functions#client-boundary-diagnostics";

export const FARM_DIAGNOSTIC_RULES = {
  CLIENT_SERVER_ENV: {
    severity: "warning",
    fix: "Read it on the server (a server function, API route, or server component), or declare it in env.public in farm.config.ts and read it through publicEnv.",
    docs: CLIENT_BOUNDARY_DOCS,
  },
  CLIENT_PROCESS_ENV_PUBLIC: {
    severity: "warning",
    fix: 'Read it through publicEnv from "@farm.js/core/env".',
    docs: CLIENT_BOUNDARY_DOCS,
  },
  CLIENT_NODE_BUILTIN: {
    severity: "warning",
    fix: "Move the import into server-only code, or import it lazily inside a function that runs only on the server.",
    docs: CLIENT_BOUNDARY_DOCS,
  },
  CLIENT_SERVER_FUNCTION: {
    severity: "error",
    fix: "Add @farm.js/plugin/rsc and set experimental.serverActions: true so client imports become server references, or call it from server code, or expose an API route and call it with createAPIClient.",
    docs: CLIENT_BOUNDARY_DOCS,
  },
  CLIENT_SERVER_ONLY_IMPORT: {
    severity: "error",
    fix: "Move what the client needs out of that module, or call it from a server component, server function, or API route.",
    docs: CLIENT_BOUNDARY_DOCS,
  },
} as const satisfies Record<string, FarmDiagnosticRule>;

export type FarmDiagnosticCode = keyof typeof FARM_DIAGNOSTIC_RULES;

/** A position in the original source: 1-based line and column, as editors show them. */
export interface FarmSourceLocation {
  line: number;
  column: number;
}

export interface FarmDiagnostic {
  code: FarmDiagnosticCode;
  severity: FarmDiagnosticSeverity;
  /** Absolute file path, with forward slashes. */
  file: string;
  line?: number;
  column?: number;
  message: string;
  fix: string;
  /** Absolute URL of the docs section for the rule. */
  docs: string;
}

const FARM_DOCS_ORIGIN = "https://farmjs.dev";

export function createFarmDiagnostic(
  code: FarmDiagnosticCode,
  file: string,
  message: string,
  location?: FarmSourceLocation,
): FarmDiagnostic {
  const rule = FARM_DIAGNOSTIC_RULES[code];
  return {
    code,
    severity: rule.severity,
    file: file.split("?", 1)[0]!.replace(/\\/g, "/"),
    ...location,
    message,
    fix: rule.fix,
    docs: FARM_DOCS_ORIGIN + rule.docs,
  };
}

/** Formats a diagnostic, naming the file relative to `root` when it lies inside it. */
export function formatFarmDiagnostic(diagnostic: FarmDiagnostic, root?: string): string {
  let file = diagnostic.file;
  if (root) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    if (relative && !relative.startsWith("../") && !path.isAbsolute(relative)) file = relative;
  }
  const position =
    diagnostic.line === undefined ? "" : `:${diagnostic.line}:${diagnostic.column ?? 1}`;
  return [
    `${file}${position} - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    `  fix: ${diagnostic.fix}`,
    `  docs: ${diagnostic.docs}`,
  ].join("\n");
}

/**
 * Maps an offset in the code a transform hook received back to the original source.
 *
 * A normal-order plugin sees code that Vite has already compiled (TypeScript and JSX removed), so
 * an offset in it says little about the file the developer wrote: a read on line 10 of a `.tsx`
 * module can sit on line 1 of the compiled code. The combined sourcemap of the transforms so far
 * leads back to the source. With no usable map, the location is left out rather than guessed.
 */
export function createFarmSourceLocator(
  code: string,
  getCombinedSourcemap: () => unknown,
): (offset: number) => FarmSourceLocation | undefined {
  let trace: TraceMap | null | undefined;
  let lineStarts: number[] | undefined;
  return (offset) => {
    if (trace === undefined) {
      try {
        const map = getCombinedSourcemap() as ConstructorParameters<typeof TraceMap>[0] | null;
        trace = map ? new TraceMap(map) : null;
      } catch {
        trace = null;
      }
    }
    if (!trace) return undefined;
    if (!lineStarts) {
      lineStarts = [0];
      for (let index = code.indexOf("\n"); index !== -1; index = code.indexOf("\n", index + 1)) {
        lineStarts.push(index + 1);
      }
    }
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    const original = originalPositionFor(trace, {
      line: low + 1,
      column: offset - lineStarts[low]!,
    });
    return original.line === null
      ? undefined
      : { line: original.line, column: (original.column ?? 0) + 1 };
  };
}
