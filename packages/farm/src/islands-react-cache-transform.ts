/**
 * Islands mode: a server module's `cache` import from `react` comes from
 * `@farm.js/core/internal/react-cache` (see `react-cache.ts`), so it memoizes per request as it
 * does in React Server Components, and so does `React.cache` through a default or namespace
 * import of `react`. Other imports from `react` stay.
 */
import path from "node:path";
import { parseAst } from "rolldown/parseAst";

export const FARM_REACT_CACHE_MODULE = "@farm.js/core/internal/react-cache";

type AstNode = Record<string, any>;

const REACT_CACHE_LOCAL = "__farm_react_cache__";
/** The APIs Farm serves per request, and the local name a member use becomes. */
const REACT_CACHE_APIS: Record<string, string> = {
  cache: REACT_CACHE_LOCAL,
  cacheSignal: "__farm_react_cache_signal__",
};

export function rewriteFarmReactCacheImport(code: string, file: string): string | null {
  if (!code.includes("cache") || !code.includes("react")) return null; // also covers cacheSignal
  const extension = path.extname(file).slice(1);
  const lang = extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
  let program: AstNode;
  try {
    program = parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
  } catch {
    return null;
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const declarations = (program.body ?? []).filter(
    (node: AstNode) =>
      node.type === "ImportDeclaration" &&
      node.source?.value === "react" &&
      node.importKind !== "type",
  );
  const namespaces = new Set<string>();
  let memberImportAt: number | null = null;
  for (const node of declarations) {
    const specifiers: AstNode[] = node.specifiers ?? [];
    for (const specifier of specifiers) {
      if (
        specifier.type === "ImportDefaultSpecifier" ||
        specifier.type === "ImportNamespaceSpecifier"
      ) {
        namespaces.add(specifier.local.name);
        memberImportAt ??= node.end;
      }
    }
    const caches = specifiers.filter(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type" &&
        Object.prototype.hasOwnProperty.call(
          REACT_CACHE_APIS,
          specifier.imported?.name ?? specifier.imported?.value ?? "",
        ),
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
      `import { ${caches.map((specifier) => `${specifier.imported?.name ?? specifier.imported?.value} as ${specifier.local.name}`).join(", ")} } from ${JSON.stringify(FARM_REACT_CACHE_MODULE)};`,
    ];
    edits.push({ start: node.start, end: node.end, text: lines.join("\n") });
  }
  // `React.cache` through a default or namespace import.
  if (namespaces.size > 0 && memberImportAt !== null) {
    const used = new Set<string>();
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      const current = node as AstNode;
      if (typeof current.type !== "string") return;
      if (current.type === "ImportDeclaration") return;
      if (
        current.type === "MemberExpression" &&
        !current.computed &&
        current.object?.type === "Identifier" &&
        namespaces.has(current.object.name) &&
        Object.prototype.hasOwnProperty.call(REACT_CACHE_APIS, current.property?.name ?? "")
      ) {
        const name = current.property.name as string;
        edits.push({ start: current.start, end: current.end, text: REACT_CACHE_APIS[name]! });
        used.add(name);
        return;
      }
      for (const [key, value] of Object.entries(current)) {
        if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
        if (value && typeof value === "object") visit(value);
      }
    };
    visit(program);
    if (used.size > 0) {
      edits.push({
        start: memberImportAt,
        end: memberImportAt,
        text: `\nimport { ${[...used].map((name) => `${name} as ${REACT_CACHE_APIS[name]}`).join(", ")} } from ${JSON.stringify(FARM_REACT_CACHE_MODULE)};`,
      });
    }
  }
  if (edits.length === 0) return null;
  let output = code;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}
