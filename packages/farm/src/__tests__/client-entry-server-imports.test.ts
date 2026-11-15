// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

// Entry points that run in the browser, as built by tsup.config.ts.
const BROWSER_ENTRIES = [
  "client.ts",
  "renderer-client.ts",
  "client/lifecycle.ts",
  "client/production-runtime.ts",
  "api-client.ts",
  "query/client.ts",
  "server-fn-client.ts",
  "server-query-client.ts",
  "navigation.ts",
  "router.ts",
  "theme/client.tsx",
  "i18n/client.tsx",
];

// Server-side observability. Bundling it into the browser ships OpenTelemetry
// and Farm's tracing to every page.
const SERVER_ONLY = new Set(["observability.ts", "tracing.ts"]);
const SERVER_ONLY_PACKAGES = new Set(["@opentelemetry/api"]);

/** Runtime imports of a module: type-only imports and exports are erased. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function resolveLocal(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** The import chain from `entry` to a server-only module, if one exists. */
function findServerOnlyChain(entry: string): string[] | undefined {
  const start = path.join(SRC, entry);
  const parent = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  const chainTo = (file: string, last: string) => {
    const chain = [last];
    for (let current: string | null = file; current; current = parent.get(current) ?? null) {
      chain.unshift(path.relative(SRC, current));
    }
    return chain;
  };
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeImports(file)) {
      if (SERVER_ONLY_PACKAGES.has(specifier)) return chainTo(file, specifier);
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveLocal(file, specifier);
      if (!resolved || parent.has(resolved)) continue;
      parent.set(resolved, file);
      if (SERVER_ONLY.has(path.relative(SRC, resolved))) {
        return chainTo(resolved, "(server-only)");
      }
      queue.push(resolved);
    }
  }
  return undefined;
}

describe("browser entries", () => {
  it.each(BROWSER_ENTRIES)("%s does not import server observability", (entry) => {
    expect(findServerOnlyChain(entry)).toBeUndefined();
  });
});
