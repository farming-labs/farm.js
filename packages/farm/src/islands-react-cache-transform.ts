/**
 * Islands mode: a server module's `cache` import from `react` comes from
 * `@farm.js/core/internal/react-cache` (see `react-cache.ts`), so it memoizes per request as it
 * does in React Server Components. Other imports from `react` stay. `React.cache` through a
 * default or namespace import keeps React's.
 */
import path from "node:path";
import { parseAst } from "rolldown/parseAst";

export const FARM_REACT_CACHE_MODULE = "@farm.js/core/internal/react-cache";

type AstNode = Record<string, any>;

export function rewriteFarmReactCacheImport(code: string, file: string): string | null {
  if (!code.includes("cache") || !code.includes("react")) return null;
  const extension = path.extname(file).slice(1);
  const lang = extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
  let program: AstNode;
  try {
    program = parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
  } catch {
    return null;
  }
  let output = code;
  const declarations = (program.body ?? []).filter(
    (node: AstNode) =>
      node.type === "ImportDeclaration" &&
      node.source?.value === "react" &&
      node.importKind !== "type",
  );
  let changed = false;
  for (const node of [...declarations].sort((left, right) => right.start - left.start)) {
    const specifiers: AstNode[] = node.specifiers ?? [];
    const caches = specifiers.filter(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type" &&
        (specifier.imported?.name ?? specifier.imported?.value) === "cache",
    );
    if (caches.length === 0) continue;
    const others = specifiers.filter((specifier) => !caches.includes(specifier));
    const text = (specifier: AstNode) => code.slice(specifier.start, specifier.end);
    const defaults = others.filter((specifier) => specifier.type !== "ImportSpecifier");
    const named = others.filter((specifier) => specifier.type === "ImportSpecifier");
    const clause = [
      ...defaults.map(text),
      ...(named.length > 0 ? [`{ ${named.map(text).join(", ")} }`] : []),
    ].join(", ");
    const lines = [
      ...(clause ? [`import ${clause} from "react";`] : []),
      `import { ${caches.map((specifier) => `cache as ${specifier.local.name}`).join(", ")} } from ${JSON.stringify(FARM_REACT_CACHE_MODULE)};`,
    ];
    output = output.slice(0, node.start) + lines.join("\n") + output.slice(node.end);
    changed = true;
  }
  return changed ? output : null;
}
