import { builtinModules } from "node:module";

/**
 * The browser imports a programmatic routes module to hydrate its pages, but
 * only needs each route's component, pending/error/notFound UI, params and
 * search options, and actions (server-function references). Guards, data
 * hooks, static paths, generated metadata, and API handlers run on the server,
 * so the client build removes them from the route options and then drops the
 * top-level imports and declarations only they used. Their server import graph
 * (database clients, credentials, node:fs) never enters the client bundle.
 */

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface Replacement {
  start: number;
  end: number;
  code: string;
}

type RouteFactoryKind = "page" | "layout" | "api";

export interface TransformProgrammaticRoutesForClientOptions {
  code: string;
  id: string;
  parse: (code: string) => AstNode;
}

export interface TransformProgrammaticRoutesForClientResult {
  code: string;
  /** True when the module defines programmatic routes, even if nothing was removed. */
  definesRoutes: boolean;
}

const ROUTE_IMPORT_SOURCES = new Set(["@farm.js/core", "@farm.js/core/routes"]);
const ROUTE_FACTORY_NAMES: Record<string, RouteFactoryKind> = {
  createRoute: "page",
  page: "page",
  layout: "layout",
  api: "api",
};
const SERVER_ONLY_KEYS: Record<RouteFactoryKind, ReadonlySet<string>> = {
  page: new Set(["guard", "data", "staticPaths", "generateMetadata"]),
  layout: new Set(["generateMetadata"]),
  api: new Set(["GET", "HEAD", "QUERY", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]),
};
const MODULE_EXTENSION_RE = /\.[cm]?[jt]sx?$/;
const NODE_BUILTINS = new Set(builtinModules);

export function transformProgrammaticRoutesForClient(
  options: TransformProgrammaticRoutesForClientOptions,
): TransformProgrammaticRoutesForClientResult | null {
  if (!isTransformableModule(options.id) || !options.code.includes("@farm.js/core")) return null;

  const ast = options.parse(options.code);
  const bindings = findRouteFactoryBindings(ast);
  if (!bindings) return null;

  const calls = findRouteFactoryCalls(ast, bindings);
  if (calls.length === 0 && !bindings.definesRoutes) return null;

  const replacements = calls.flatMap((call) => {
    const replacement = stripRouteOptions(options.code, options.id, call);
    return replacement ? [replacement] : [];
  });

  let code = applyReplacements(options.code, withoutNested(replacements));
  if (replacements.length > 0) {
    code = applyReplacements(code, removeUnusedTopLevel(code, options.parse(code)));
  }

  const builtin = findNodeBuiltinImport(options.parse(code));
  if (builtin) {
    throw new Error(
      `[Farm.js] ${options.id} defines programmatic routes and is loaded in the browser to ` +
        `hydrate them, but it still imports the server-only module "${builtin}" after Farm ` +
        "removed the server route hooks (guard, data, staticPaths, generateMetadata, and API " +
        "handlers). Use it only inside those hooks, or move it into a module that only they import.",
    );
  }

  return { code, definesRoutes: true };
}

/**
 * Find a Node builtin that an application module reachable from `entry` imports in the client
 * graph. Package internals are not walked: packages map their own builtins for the browser.
 */
export function findClientNodeBuiltinChain(
  entry: string,
  getImportedIds: (id: string) => readonly string[] | undefined,
): string[] | null {
  const parents = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const imported of getImportedIds(id) ?? []) {
      if (isNodeBuiltinId(imported)) {
        const chain = [imported];
        for (let cursor: string | null = id; cursor; cursor = parents.get(cursor) ?? null) {
          chain.unshift(cursor);
        }
        return chain;
      }
      if (parents.has(imported) || !isApplicationModuleId(imported)) continue;
      parents.set(imported, id);
      queue.push(imported);
    }
  }

  return null;
}

function isTransformableModule(id: string): boolean {
  if (id.startsWith("\0") || id.includes("/node_modules/") || id.includes("\\node_modules\\")) {
    return false;
  }
  return MODULE_EXTENSION_RE.test(id.split("?", 1)[0]!);
}

function isApplicationModuleId(id: string): boolean {
  return !id.startsWith("\0") && isTransformableModule(id);
}

function isNodeBuiltinId(id: string): boolean {
  const external = id.indexOf("__vite-browser-external:");
  const bare = external === 0 || external === 1 ? id.slice(external + 24) : id;
  return bare.startsWith("node:") || NODE_BUILTINS.has(bare);
}

interface RouteFactoryCall {
  kind: RouteFactoryKind;
  options: AstNode;
  call: AstNode;
}

interface RouteFactoryBindings {
  factories: Map<string, RouteFactoryKind>;
  namespaces: Set<string>;
  definesRoutes: boolean;
}

function findRouteFactoryBindings(ast: AstNode): RouteFactoryBindings | null {
  const factories = new Map<string, RouteFactoryKind>();
  const namespaces = new Set<string>();
  const defineRoutesNames = new Set<string>();
  let definesRoutes = false;

  for (const statement of asNodes(ast.body)) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string" || !ROUTE_IMPORT_SOURCES.has(source)) continue;

    for (const specifier of asNodes(statement.specifiers)) {
      const local = isAstNode(specifier.local) ? specifier.local.name : undefined;
      if (typeof local !== "string") continue;
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(local);
      } else if (specifier.type === "ImportSpecifier" && isAstNode(specifier.imported)) {
        const imported = String(specifier.imported.name ?? specifier.imported.value);
        if (imported === "defineRoutes") defineRoutesNames.add(local);
        const kind = ROUTE_FACTORY_NAMES[imported];
        if (kind) factories.set(local, kind);
      }
    }
  }

  if (factories.size === 0 && namespaces.size === 0 && defineRoutesNames.size === 0) return null;

  // defineRoutes(({ page, api }) => [...]) and defineRoutes((r) => [r.page(...)]) hand the
  // route builders to the callback.
  walk(ast, (node) => {
    if (node.type !== "CallExpression" || !isAstNode(node.callee)) return;
    const callee = node.callee;
    const isDefineRoutes =
      (callee.type === "Identifier" && defineRoutesNames.has(String(callee.name))) ||
      (callee.type === "MemberExpression" &&
        callee.computed !== true &&
        isAstNode(callee.object) &&
        namespaces.has(String(callee.object.name)) &&
        isAstNode(callee.property) &&
        callee.property.name === "defineRoutes");
    if (!isDefineRoutes) return;
    definesRoutes = true;
    const callback = asNodes(node.arguments)[0];
    if (!callback || !isFunctionNode(callback)) return;

    const builder = asNodes(callback.params)[0];
    if (!builder) return;
    if (builder.type === "Identifier") {
      namespaces.add(String(builder.name));
    } else if (builder.type === "ObjectPattern") {
      for (const property of asNodes(builder.properties)) {
        if (property.type !== "Property" || property.computed === true) continue;
        const key = readPropertyName(property.key);
        const value = isAstNode(property.value) ? property.value : undefined;
        const kind = key ? ROUTE_FACTORY_NAMES[key] : undefined;
        if (kind && key !== "createRoute" && value?.type === "Identifier") {
          factories.set(String(value.name), kind);
        }
      }
    }
  });

  return { factories, namespaces, definesRoutes };
}

function findRouteFactoryCalls(ast: AstNode, bindings: RouteFactoryBindings): RouteFactoryCall[] {
  const calls: RouteFactoryCall[] = [];

  walk(ast, (node) => {
    if (node.type !== "CallExpression" || !isAstNode(node.callee)) return;
    const callee = node.callee;
    let kind: RouteFactoryKind | undefined;
    if (callee.type === "Identifier") {
      kind = bindings.factories.get(String(callee.name));
    } else if (
      callee.type === "MemberExpression" &&
      callee.computed !== true &&
      isAstNode(callee.object) &&
      callee.object.type === "Identifier" &&
      bindings.namespaces.has(String(callee.object.name)) &&
      isAstNode(callee.property)
    ) {
      kind = ROUTE_FACTORY_NAMES[String(callee.property.name)];
    }

    const options = asNodes(node.arguments)[1];
    if (kind && options) calls.push({ kind, options, call: node });
  });

  return calls;
}

function stripRouteOptions(
  code: string,
  id: string,
  { kind, options, call }: RouteFactoryCall,
): Replacement | null {
  const serverOnlyKeys = SERVER_ONLY_KEYS[kind];
  const kept: string[] = [];
  const removed: string[] = [];

  // Only keys written out in an object literal can be removed. Options passed by
  // reference, spread in, or under a computed key could still hold the server
  // keys, which would ship their handlers and imports to the browser.
  if (options.type !== "ObjectExpression") {
    throw unstrippableRouteOptionsError(code, id, kind, call, "are not an object literal");
  }
  for (const property of asNodes(options.properties)) {
    if (property.type !== "Property") {
      throw unstrippableRouteOptionsError(code, id, kind, call, "spread another object");
    }
    if (property.computed === true && !isStringLiteral(property.key)) {
      throw unstrippableRouteOptionsError(code, id, kind, call, "use a computed key");
    }
  }

  for (const property of asNodes(options.properties)) {
    const key = readPropertyName(property.key);
    if (key && serverOnlyKeys.has(kind === "api" ? key.toUpperCase() : key)) {
      removed.push(key);
    } else {
      kept.push(code.slice(property.start, property.end));
    }
  }

  if (removed.length === 0) return null;
  // A page records that its props come from server hooks, so hydration knows
  // that props the server did not resolve (a rejected guard) cannot be
  // recomputed in the browser.
  const propHooks = removed.filter((key) => key === "guard" || key === "data");
  if (kind === "page" && propHooks.length > 0) {
    kept.push(`__farmServerHooks: ${JSON.stringify(propHooks)}`);
  }
  return { start: options.start, end: options.end, code: `{ ${kept.join(", ")} }` };
}

function unstrippableRouteOptionsError(
  code: string,
  id: string,
  kind: RouteFactoryKind,
  call: AstNode,
  problem: string,
): Error {
  const source = code.slice(call.start, call.end).replace(/\s+/g, " ");
  const snippet = source.length > 80 ? `${source.slice(0, 77)}...` : source;
  const keys = [...SERVER_ONLY_KEYS[kind]].join(", ");
  return new Error(
    `[Farm.js] ${id}: in ${snippet}, the ${kind}() route options ${problem}, so Farm can't remove ` +
      `the server-only keys (${keys}) before the browser loads this routes module. Write the ` +
      `options inline as an object literal with each of those keys spelled out, for example ` +
      `${kind}("/path", { ${kind === "api" ? "GET: handlers.GET" : "guard: adminGuard"} }).`,
  );
}

function isStringLiteral(node: unknown): boolean {
  return isAstNode(node) && node.type === "Literal" && typeof node.value === "string";
}

/**
 * Remove top-level imports and non-exported declarations that nothing still
 * reachable from the module's exports and statements uses.
 */
function removeUnusedTopLevel(code: string, ast: AstNode): Replacement[] {
  interface TopLevelStatement {
    node: AstNode;
    declared: string[];
    references: Set<string>;
    root: boolean;
  }

  const statements: TopLevelStatement[] = asNodes(ast.body).map((node) => {
    if (node.type === "ImportDeclaration") {
      const declared = asNodes(node.specifiers).flatMap((specifier) =>
        isAstNode(specifier.local) ? [String(specifier.local.name)] : [],
      );
      return { node, declared, references: new Set(), root: declared.length === 0 };
    }
    if (node.type === "VariableDeclaration") {
      const declared = asNodes(node.declarations).flatMap((item) => patternNames(item.id));
      const references = new Set<string>();
      for (const item of asNodes(node.declarations)) collectReferences(item.init, references);
      return { node, declared, references, root: false };
    }
    if (
      (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") &&
      isAstNode(node.id)
    ) {
      const references = new Set<string>();
      collectReferences({ ...node, id: null }, references);
      return { node, declared: [String(node.id.name)], references, root: false };
    }
    const references = new Set<string>();
    collectReferences(node, references);
    return { node, declared: [], references, root: true };
  });

  const declaredBy = new Map<string, TopLevelStatement>();
  for (const statement of statements) {
    for (const name of statement.declared) declaredBy.set(name, statement);
  }

  const live = new Set<string>();
  const queue = statements.filter((statement) => statement.root).flatMap((s) => [...s.references]);
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (live.has(name)) continue;
    live.add(name);
    const statement = declaredBy.get(name);
    if (statement) queue.push(...statement.references);
  }

  const replacements: Replacement[] = [];
  for (const statement of statements) {
    if (statement.root || statement.declared.some((name) => live.has(name))) {
      if (statement.node.type === "ImportDeclaration") {
        const rewritten = rewriteImport(code, statement.node, live);
        if (rewritten) replacements.push(rewritten);
      }
      continue;
    }
    replacements.push({ start: statement.node.start, end: statement.node.end, code: "" });
  }
  return replacements;
}

function rewriteImport(code: string, node: AstNode, live: Set<string>): Replacement | null {
  const specifiers = asNodes(node.specifiers);
  const kept = specifiers.filter(
    (specifier) => isAstNode(specifier.local) && live.has(String(specifier.local.name)),
  );
  if (kept.length === specifiers.length) return null;

  const defaults = kept.filter((specifier) => specifier.type !== "ImportSpecifier");
  const named = kept.filter((specifier) => specifier.type === "ImportSpecifier");
  const clauses = defaults.map((specifier) => code.slice(specifier.start, specifier.end));
  if (named.length > 0) {
    clauses.push(`{ ${named.map((item) => code.slice(item.start, item.end)).join(", ")} }`);
  }
  const source = code.slice((node.source as AstNode).start, (node.source as AstNode).end);
  return { start: node.start, end: node.end, code: `import ${clauses.join(", ")} from ${source};` };
}

function findNodeBuiltinImport(ast: AstNode): string | null {
  let found: string | null = null;
  walk(ast, (node) => {
    if (found) return;
    if (
      node.type !== "ImportDeclaration" &&
      node.type !== "ImportExpression" &&
      node.type !== "ExportAllDeclaration" &&
      node.type !== "ExportNamedDeclaration"
    ) {
      return;
    }
    const source = isAstNode(node.source) ? node.source.value : undefined;
    if (typeof source === "string" && isNodeBuiltinId(source)) found = source;
  });
  return found;
}

function collectReferences(node: unknown, names: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectReferences(item, names);
    return;
  }
  if (!isAstNode(node)) return;
  if (node.type === "Identifier") {
    names.add(String(node.name));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (
      key === "key" &&
      node.computed !== true &&
      (node.type === "Property" ||
        node.type === "MethodDefinition" ||
        node.type === "PropertyDefinition")
    ) {
      continue;
    }
    if (key === "property" && node.type === "MemberExpression" && node.computed !== true) continue;
    if (key === "label") continue;
    collectReferences(value, names);
  }
}

function patternNames(pattern: unknown): string[] {
  if (!isAstNode(pattern)) return [];
  if (pattern.type === "Identifier") return [String(pattern.name)];
  if (pattern.type === "ObjectPattern") {
    return asNodes(pattern.properties).flatMap((property) =>
      patternNames(property.type === "RestElement" ? property.argument : property.value),
    );
  }
  if (pattern.type === "ArrayPattern") return asNodes(pattern.elements).flatMap(patternNames);
  if (pattern.type === "AssignmentPattern") return patternNames(pattern.left);
  if (pattern.type === "RestElement") return patternNames(pattern.argument);
  return [];
}

function withoutNested(replacements: Replacement[]): Replacement[] {
  return replacements.filter(
    (replacement) =>
      !replacements.some(
        (other) =>
          other !== replacement && other.start <= replacement.start && other.end >= replacement.end,
      ),
  );
}

function applyReplacements(code: string, replacements: Replacement[]): string {
  let output = code;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.code + output.slice(replacement.end);
  }
  return output;
}

function readPropertyName(node: unknown): string | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier") return String(node.name);
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

function isFunctionNode(node: AstNode): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isAstNode(value)) walk(value, visit);
    else if (Array.isArray(value)) for (const item of value) if (isAstNode(item)) walk(item, visit);
  }
}

function asNodes(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isAstNode) : [];
}

function isAstNode(value: unknown): value is AstNode {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AstNode).type === "string" &&
    typeof (value as AstNode).start === "number"
  );
}
