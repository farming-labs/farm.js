import { parseAst } from "vite";

const JSX_RUNTIME_MODULES = new Set(["react/jsx-runtime", "react/jsx-dev-runtime"]);
const JSX_FACTORY_EXPORTS = new Set(["jsx", "jsxs", "jsxDEV"]);
const AUTOMATIC_BOUNDARY_TAGS = new Set([
  "article",
  "aside",
  "div",
  "footer",
  "header",
  "main",
  "nav",
  "section",
  "span",
]);
const AUTOMATIC_BOUNDARY_IMPORT = "@farm.js/plugin/rsc/optimized-boundary";

interface AstNode {
  type?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

export interface AutomaticOptimizedBoundaryTransform {
  code: string;
  boundaryCount: number;
}

function nodeName(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const candidate = node as { name?: unknown; value?: unknown };
  if (typeof candidate.name === "string") return candidate.name;
  if (typeof candidate.value === "string") return candidate.value;
  return undefined;
}

function isClientModule(body: AstNode[]): boolean {
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") return false;
    if (statement.type !== "ExpressionStatement") return false;
    const expression = statement.expression as AstNode | undefined;
    if (expression?.type !== "Literal") return false;
    if ((expression as { value?: unknown }).value === "use client") return true;
  }
  return false;
}

function collectJsxFactories(body: AstNode[]): Set<string> {
  const factories = new Set<string>();

  for (const statement of body) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = nodeName(statement.source);
    if (!source || !JSX_RUNTIME_MODULES.has(source)) continue;

    for (const specifier of (statement.specifiers as AstNode[] | undefined) || []) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = nodeName(specifier.imported);
      const local = nodeName(specifier.local);
      if (imported && local && JSX_FACTORY_EXPORTS.has(imported)) factories.add(local);
    }
  }

  return factories;
}

function collectBoundaryCalls(node: unknown, factories: Set<string>, calls: AstNode[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectBoundaryCalls(child, factories, calls);
    return;
  }

  const candidate = node as AstNode;
  if (candidate.type === "CallExpression") {
    const callee = candidate.callee as AstNode | undefined;
    const args = (candidate.arguments as AstNode[] | undefined) || [];
    const tag = args[0];
    if (
      callee?.type === "Identifier" &&
      factories.has(nodeName(callee) || "") &&
      tag?.type === "Literal" &&
      AUTOMATIC_BOUNDARY_TAGS.has(String((tag as { value?: unknown }).value)) &&
      typeof candidate.start === "number" &&
      typeof candidate.end === "number"
    ) {
      calls.push(candidate);
    }
  }

  for (const [key, value] of Object.entries(candidate)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    collectBoundaryCalls(value, factories, calls);
  }
}

function createHelperName(code: string): string {
  const base = "__farmOptimizeBoundary";
  let name = base;
  let suffix = 1;
  while (new RegExp(`\\b${name}\\b`).test(code)) name = `${base}${suffix++}`;
  return name;
}

function importInsertionPoint(body: AstNode[]): number {
  let position = 0;
  for (const statement of body) {
    if (statement.type === "ImportDeclaration" && typeof statement.end === "number") {
      position = statement.end;
      continue;
    }
    if (statement.type === "ExpressionStatement") {
      const expression = statement.expression as AstNode | undefined;
      if (expression?.type === "Literal" && typeof statement.end === "number") {
        position = statement.end;
        continue;
      }
    }
    break;
  }
  return position;
}

/**
 * Wrap React JSX-runtime calls for native host boundaries with Farm's
 * server-only optimizer. Eligibility is decided against the fully evaluated
 * React element at runtime, so unsupported trees retain normal React behavior.
 */
export function transformAutomaticOptimizedBoundaries(
  code: string,
  id: string,
): AutomaticOptimizedBoundaryTransform | null {
  const cleanId = id.split("?", 1)[0].replace(/\\/g, "/");
  if (!/\.[cm]?[jt]sx?$/.test(cleanId)) return null;
  if (cleanId.includes("/node_modules/") || cleanId.includes("/.farm/")) return null;
  if (!code.includes("react/jsx-runtime") && !code.includes("react/jsx-dev-runtime")) return null;

  let ast: AstNode;
  try {
    ast = parseAst(code) as unknown as AstNode;
  } catch {
    return null;
  }

  const body = (ast.body as AstNode[] | undefined) || [];
  if (isClientModule(body)) return null;

  const factories = collectJsxFactories(body);
  if (factories.size === 0) return null;

  const calls: AstNode[] = [];
  collectBoundaryCalls(ast, factories, calls);
  if (calls.length === 0) return null;

  const helperName = createHelperName(code);
  const insertions: Array<{ position: number; text: string; order: number }> = [];
  for (const call of calls) {
    insertions.push({ position: call.start!, text: `${helperName}(`, order: 1 });
    insertions.push({ position: call.end!, text: ")", order: 0 });
  }
  insertions.push({
    position: importInsertionPoint(body),
    text: `${importInsertionPoint(body) === 0 ? "" : "\n"}import { _optimizeBoundary as ${helperName} } from ${JSON.stringify(AUTOMATIC_BOUNDARY_IMPORT)};\n`,
    order: 2,
  });

  let transformed = code;
  for (const insertion of insertions.sort(
    (left, right) => right.position - left.position || left.order - right.order,
  )) {
    transformed =
      transformed.slice(0, insertion.position) +
      insertion.text +
      transformed.slice(insertion.position);
  }

  return { code: transformed, boundaryCount: calls.length };
}
