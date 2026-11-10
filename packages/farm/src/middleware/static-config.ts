/**
 * The `config` a middleware file exports, read from its source at build time so prerendering
 * knows which paths the file's own `matcher` leaves alone. Only literal matchers count (strings,
 * regular expressions, arrays of them): anything computed, or a request-aware function, may match
 * any path, so it reads as unknown and the page stays server-handled.
 */
import type { MiddlewareMatcher } from "./types";

export interface StaticMiddlewareConfig {
  matcher?: MiddlewareMatcher | MiddlewareMatcher[];
  exclude?: Array<string | RegExp>;
}

interface Node {
  type: string;
  [key: string]: any;
}

/** A literal string or regular expression, or undefined when the node is anything else. */
function literalMatcher(node: Node | null | undefined): string | RegExp | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "Literal" && node.regex)
    return new RegExp(node.regex.pattern, node.regex.flags);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? undefined;
  }
  return undefined;
}

function literalMatchers(node: Node): Array<string | RegExp> | undefined {
  const values = node.type === "ArrayExpression" ? node.elements : [node];
  const matchers: Array<string | RegExp> = [];
  for (const value of values) {
    const matcher = literalMatcher(value);
    if (matcher === undefined) return undefined;
    matchers.push(matcher);
  }
  return matchers;
}

function unwrap(node: Node): Node {
  while (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "ParenthesizedExpression"
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * The file's `export const config = { matcher, exclude }`: `null` when it exports no `config` (the
 * file covers its folder), `"unknown"` when `config` is not a literal one.
 */
export function readStaticMiddlewareConfig(
  program: Node,
): StaticMiddlewareConfig | null | "unknown" {
  let found: StaticMiddlewareConfig | null | "unknown" = null;
  for (const statement of program.body as Node[]) {
    if (statement.type === "ExportNamedDeclaration" && !statement.declaration) {
      // `export { config }` or a re-export: the value is not here.
      if (statement.specifiers.some((specifier: Node) => specifier.exported?.name === "config")) {
        return "unknown";
      }
      continue;
    }
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : null;
    if (!declaration || declaration.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations as Node[]) {
      if (declarator.id?.type !== "Identifier" || declarator.id.name !== "config") continue;
      if (declaration.kind !== "const" || !declarator.init) return "unknown";
      const init = unwrap(declarator.init);
      if (init.type !== "ObjectExpression") return "unknown";
      const config: StaticMiddlewareConfig = {};
      for (const property of init.properties as Node[]) {
        if (property.type !== "Property" || property.computed) return "unknown";
        const key = property.key?.name ?? property.key?.value;
        if (key !== "matcher" && key !== "exclude") continue;
        const matchers = literalMatchers(unwrap(property.value));
        if (!matchers) return "unknown";
        if (key === "matcher") config.matcher = matchers;
        else config.exclude = matchers;
      }
      found = config;
    }
  }
  return found;
}

/** {@link readStaticMiddlewareConfig} for a file on disk; a file that does not parse is unknown. */
export async function readMiddlewareFileConfig(
  filePath: string,
): Promise<StaticMiddlewareConfig | null | "unknown"> {
  try {
    const [{ readFile }, vite] = await Promise.all([import("node:fs/promises"), import("vite")]);
    const parsed = (
      vite as { parseSync(file: string, code: string): { program: Node; errors?: unknown[] } }
    ).parseSync(filePath, await readFile(filePath, "utf8"));
    if (parsed.errors?.length) return "unknown";
    return readStaticMiddlewareConfig(parsed.program);
  } catch {
    return "unknown";
  }
}
