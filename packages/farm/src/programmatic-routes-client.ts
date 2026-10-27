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
const ROUTE_FACTORY_NAMES = new Map<string, RouteFactoryKind>([
  ["createRoute", "page"],
  ["page", "page"],
  ["layout", "layout"],
  ["api", "api"],
]);
const API_METHOD_KEYS = ["GET", "HEAD", "QUERY", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const SERVER_ONLY_KEYS: Record<RouteFactoryKind, ReadonlySet<string>> = {
  page: new Set(["guard", "data", "staticPaths", "generateMetadata"]),
  layout: new Set(["generateMetadata"]),
  api: new Set(API_METHOD_KEYS),
};
// A `{ kind: "api" }` definition holds its handlers under `methods`.
const RAW_API_SERVER_ONLY_KEYS: ReadonlySet<string> = new Set(["methods", ...API_METHOD_KEYS]);
const MODULE_EXTENSION_RE = /\.[cm]?[jt]sx?$/;
const NODE_BUILTINS = new Set(builtinModules);

export function transformProgrammaticRoutesForClient(
  options: TransformProgrammaticRoutesForClientOptions,
): TransformProgrammaticRoutesForClientResult | null {
  if (!isTransformableModule(options.id) || !options.code.includes("@farm.js/core")) return null;

  let ast = options.parse(options.code);
  const bindings = findRouteBindings(ast);
  if (!bindings) return null;

  let definitions = findRouteDefinitions(ast, bindings);
  if (definitions.length === 0 && !bindings.definesRoutes) return null;
  assertRouteBindingsFollowed(options.code, options.id, ast, bindings);

  // Strip the outermost definitions first, then look again: a definition nested
  // inside a kept option would otherwise be skipped with its outer replacement.
  let code = options.code;
  let stripped = false;
  for (;;) {
    const replacements = definitions.flatMap((definition) => {
      const replacement = stripRouteDefinition(code, options.id, definition);
      return replacement ? [replacement] : [];
    });
    if (replacements.length === 0) break;
    stripped = true;
    code = applyReplacements(code, withoutNested(replacements));
    ast = options.parse(code);
    definitions = findRouteDefinitions(ast, findRouteBindings(ast)!);
  }
  if (stripped) code = applyReplacements(code, removeUnusedTopLevel(code, ast));

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

type RouteBinding =
  | { type: "factory"; kind: RouteFactoryKind }
  | { type: "builder" }
  | { type: "defineRoutes" };

interface RouteBindings {
  names: Map<string, RouteBinding>;
  /** Identifiers Farm read as declaring or using a route binding. */
  followed: Set<AstNode>;
  definesRoutes: boolean;
}

interface RouteDefinition {
  /** null when a `{ kind }` object sets kind to something other than a string literal. */
  kind: RouteFactoryKind | null;
  /** The options of a factory call, or the `{ kind }` definition object itself. */
  options: AstNode;
  /** The factory call, or null for a `{ kind }` definition object. */
  call: AstNode | null;
}

const UNRESOLVED_KIND_SERVER_KEYS: ReadonlySet<string> = new Set([
  ...SERVER_ONLY_KEYS.page,
  ...RAW_API_SERVER_ONLY_KEYS,
]);

/**
 * Find the names that hold Farm's route builders: page, layout, api, createRoute,
 * routesBuilder, defineRoutes, or the whole module imported from Farm; the builder
 * defineRoutes hands its callback; and const aliases or destructuring of any of those.
 */
function findRouteBindings(ast: AstNode): RouteBindings | null {
  const names = new Map<string, RouteBinding>();
  const followed = new Set<AstNode>();
  let definesRoutes = false;

  for (const statement of asNodes(ast.body)) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string" || !ROUTE_IMPORT_SOURCES.has(source)) continue;

    for (const specifier of asNodes(statement.specifiers)) {
      if (specifier.importKind === "type" || !isAstNode(specifier.local)) continue;
      let binding: RouteBinding | undefined;
      if (specifier.type === "ImportNamespaceSpecifier") {
        binding = { type: "builder" };
      } else if (specifier.type === "ImportSpecifier" && isAstNode(specifier.imported)) {
        binding = builderMember(String(specifier.imported.name ?? specifier.imported.value));
      }
      if (binding) names.set(String(specifier.local.name), binding);
    }
  }

  if (names.size === 0) return null;

  const bind = (target: unknown, binding: RouteBinding | undefined): boolean => {
    if (!binding || !isAstNode(target) || target.type !== "Identifier") return false;
    followed.add(target);
    if (names.has(String(target.name))) return false;
    names.set(String(target.name), binding);
    return true;
  };
  // `(r) => ...` or `{ page, api: a }` taken from a builder.
  const bindBuilderPattern = (pattern: AstNode): boolean => {
    if (pattern.type === "Identifier") return bind(pattern, { type: "builder" });
    if (pattern.type !== "ObjectPattern") return false;
    let changed = false;
    for (const property of asNodes(pattern.properties)) {
      if (property.type !== "Property" || property.computed === true) continue;
      const key = readPropertyName(property.key);
      if (key && bind(property.value, builderMember(key))) changed = true;
    }
    return changed;
  };

  for (let changed = true; changed; ) {
    changed = false;
    walk(ast, (node) => {
      if (node.type === "VariableDeclarator" && isAstNode(node.id)) {
        const binding = resolveRouteBinding(node.init, names);
        if (!binding) return;
        markFollowed(node.init, followed);
        if (node.id.type === "Identifier") changed = bind(node.id, binding) || changed;
        else if (binding.type === "builder") changed = bindBuilderPattern(node.id) || changed;
        return;
      }
      if (node.type !== "CallExpression") return;
      if (resolveRouteBinding(node.callee, names)?.type !== "defineRoutes") return;
      definesRoutes = true;
      markFollowed(node.callee, followed);
      const callback = findRoutesCallback(ast, asNodes(node.arguments)[0]);
      const builder = callback ? asNodes(callback.params)[0] : undefined;
      if (builder) changed = bindBuilderPattern(builder) || changed;
    });
  }

  return { names, followed, definesRoutes };
}

function builderMember(name: string): RouteBinding | undefined {
  if (name === "defineRoutes") return { type: "defineRoutes" };
  if (name === "routesBuilder") return { type: "builder" };
  const kind = ROUTE_FACTORY_NAMES.get(name);
  return kind ? { type: "factory", kind } : undefined;
}

function resolveRouteBinding(
  node: unknown,
  names: ReadonlyMap<string, RouteBinding>,
): RouteBinding | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier") return names.get(String(node.name));
  if (node.type !== "MemberExpression") return undefined;
  if (resolveRouteBinding(node.object, names)?.type !== "builder") return undefined;
  if (node.computed === true && !isStringLiteral(node.property)) return undefined;
  const property = readPropertyName(node.property);
  return property ? builderMember(property) : undefined;
}

function markFollowed(node: unknown, followed: Set<AstNode>): void {
  if (!isAstNode(node)) return;
  if (node.type === "Identifier") followed.add(node);
  else if (node.type === "MemberExpression") markFollowed(node.object, followed);
}

/** The callback defineRoutes receives inline, or a function the module declares by name. */
function findRoutesCallback(ast: AstNode, argument: AstNode | undefined): AstNode | undefined {
  if (!argument) return undefined;
  if (isFunctionNode(argument)) return argument;
  if (argument.type !== "Identifier") return undefined;
  let found: AstNode | undefined;
  walk(ast, (node) => {
    if (found || !isAstNode(node.id) || node.id.name !== argument.name) return;
    if (node.type === "FunctionDeclaration") found = node;
    else if (
      node.type === "VariableDeclarator" &&
      isAstNode(node.init) &&
      isFunctionNode(node.init)
    ) {
      found = node.init;
    }
  });
  return found;
}

function findRouteDefinitions(ast: AstNode, bindings: RouteBindings): RouteDefinition[] {
  const definitions: RouteDefinition[] = [];
  const callOptions = new Set<AstNode>();

  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const binding = resolveRouteBinding(node.callee, bindings.names);
    if (binding?.type !== "factory") return;
    markFollowed(node.callee, bindings.followed);
    const args = asNodes(node.arguments);
    const options = args.find((argument) => argument.type === "SpreadElement") ?? args[1];
    if (!options) return;
    callOptions.add(options);
    definitions.push({ kind: binding.kind, options, call: node });
  });

  // defineRoutes() also takes route definition objects written out by hand.
  walk(ast, (node) => {
    if (node.type !== "ObjectExpression" || callOptions.has(node)) return;
    const kind = readDefinitionKind(node);
    if (kind !== undefined) definitions.push({ kind, options: node, call: null });
  });

  return definitions;
}

function readDefinitionKind(node: AstNode): RouteFactoryKind | null | undefined {
  let kind: AstNode | undefined;
  let serverKey = false;
  for (const property of asNodes(node.properties)) {
    if (property.type !== "Property") continue;
    if (property.computed === true && !isStringLiteral(property.key)) continue;
    const key = readPropertyName(property.key);
    if (key === "kind" && isAstNode(property.value)) kind = property.value;
    else if (key && UNRESOLVED_KIND_SERVER_KEYS.has(key)) serverKey = true;
  }
  if (!kind) return undefined;
  if (kind.type === "Literal") {
    return kind.value === "page" || kind.value === "layout" || kind.value === "api"
      ? kind.value
      : undefined;
  }
  return serverKey ? null : undefined;
}

function stripRouteDefinition(
  code: string,
  id: string,
  { kind, options, call }: RouteDefinition,
): Replacement | null {
  if (!kind) {
    throw unstrippableRouteError(code, id, {
      node: options,
      subject: "the route definition",
      problem: "sets kind to an expression",
      keys: UNRESOLVED_KIND_SERVER_KEYS,
      example: 'kind: "page"',
    });
  }
  const serverOnlyKeys = call ? SERVER_ONLY_KEYS[kind] : rawServerOnlyKeys(kind);
  const refuse = (problem: string) =>
    unstrippableRouteError(code, id, {
      node: call ?? options,
      subject: call ? `the ${kind}() route options` : `the { kind: "${kind}" } route definition`,
      problem,
      keys: serverOnlyKeys,
      example: call
        ? `${kind}("/path", { ${kind === "api" ? "GET: handlers.GET" : "guard: adminGuard"} })`
        : `{ kind: "${kind}", ${kind === "api" ? "methods: { GET: handlers.GET }" : "guard: adminGuard"} }`,
    });
  const kept: string[] = [];
  const removed: string[] = [];

  // Only keys written out in an object literal can be removed. Options passed by
  // reference, spread in, or under a computed key could still hold the server
  // keys, which would ship their handlers and imports to the browser.
  if (options.type !== "ObjectExpression") {
    throw refuse(
      options.type === "SpreadElement" ? "are spread in from a list" : "are not an object literal",
    );
  }
  for (const property of asNodes(options.properties)) {
    if (property.type !== "Property") throw refuse("spread another object");
    if (property.computed === true && !isStringLiteral(property.key)) {
      throw refuse("use a computed key");
    }
  }

  for (const property of asNodes(options.properties)) {
    const key = readPropertyName(property.key);
    const value = property.value as AstNode;
    const emptyMethods =
      key === "methods" &&
      value.type === "ObjectExpression" &&
      asNodes(value.properties).length === 0;
    if (
      key &&
      !emptyMethods &&
      (serverOnlyKeys.has(key) || (kind === "api" && serverOnlyKeys.has(key.toUpperCase())))
    ) {
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
  // defineRoutes() normalizes the methods of an API definition, so keep an empty map.
  if (!call && kind === "api" && removed.includes("methods")) kept.push("methods: {}");
  return { start: options.start, end: options.end, code: `{ ${kept.join(", ")} }` };
}

function rawServerOnlyKeys(kind: RouteFactoryKind): ReadonlySet<string> {
  return kind === "api" ? RAW_API_SERVER_ONLY_KEYS : SERVER_ONLY_KEYS[kind];
}

function unstrippableRouteError(
  code: string,
  id: string,
  details: {
    node: AstNode;
    subject: string;
    problem: string;
    keys: ReadonlySet<string>;
    example: string;
  },
): Error {
  return new Error(
    `[Farm.js] ${id}: in ${sourceSnippet(code, details.node)}, ${details.subject} ` +
      `${details.problem}, so Farm can't remove the server-only keys ` +
      `(${[...details.keys].join(", ")}) before the browser loads this routes module. Write ` +
      `them inline as an object literal with each of those keys spelled out, for example ` +
      `${details.example}.`,
  );
}

/**
 * Route definitions are found by following the names that hold Farm's route builders.
 * A builder that escapes, such as one passed to a helper, stored in an array, or
 * destructured with a default, could create routes Farm never sees, so the client
 * build refuses it instead of shipping their server-only keys.
 */
function assertRouteBindingsFollowed(
  code: string,
  id: string,
  ast: AstNode,
  { names, followed }: RouteBindings,
): void {
  // A local that reuses a builder's name (a shadowing variable or parameter) can't be
  // told apart by name, so its uses are left alone.
  const shadowed = new Set<string>();
  walk(ast, (node) => {
    for (const declared of declaredIdentifiers(node)) {
      if (names.has(String(declared.name)) && !followed.has(declared)) {
        shadowed.add(String(declared.name));
      }
    }
  });

  walk(ast, (node, parent, key) => {
    if (node.type !== "Identifier" || !parent || followed.has(node)) return;
    const name = String(node.name);
    const binding = names.get(name);
    if (!binding || binding.type === "defineRoutes" || shadowed.has(name)) return;
    if (!isReferencePosition(parent, key)) return;
    // Other members of the module, such as core.notFound(), are not route builders.
    if (
      binding.type === "builder" &&
      parent.type === "MemberExpression" &&
      key === "object" &&
      !resolveRouteBinding(parent, names)
    ) {
      return;
    }
    throw new Error(
      `[Farm.js] ${id}: Farm can't follow the route builder "${name}" in ` +
        `${sourceSnippet(code, parent)}, so routes it creates would keep their server-only ` +
        "keys (guard, data, staticPaths, generateMetadata, and API handlers) when the browser " +
        'loads this routes module. Call it directly, for example page("/path", { ... }), ' +
        "or through a const alias or destructuring in this module.",
    );
  });
}

function declaredIdentifiers(node: AstNode): AstNode[] {
  switch (node.type) {
    case "VariableDeclarator":
      return patternIdentifiers(node.id);
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return [...patternIdentifiers(node.id), ...asNodes(node.params).flatMap(patternIdentifiers)];
    case "ClassDeclaration":
    case "ClassExpression":
      return patternIdentifiers(node.id);
    case "CatchClause":
      return patternIdentifiers(node.param);
    default:
      return [];
  }
}

function patternIdentifiers(pattern: unknown): AstNode[] {
  if (!isAstNode(pattern)) return [];
  if (pattern.type === "Identifier") return [pattern];
  if (pattern.type === "ObjectPattern") {
    return asNodes(pattern.properties).flatMap((property) =>
      patternIdentifiers(property.type === "RestElement" ? property.argument : property.value),
    );
  }
  if (pattern.type === "ArrayPattern") return asNodes(pattern.elements).flatMap(patternIdentifiers);
  if (pattern.type === "AssignmentPattern") return patternIdentifiers(pattern.left);
  if (pattern.type === "RestElement") return patternIdentifiers(pattern.argument);
  return [];
}

function isReferencePosition(parent: AstNode, key: string): boolean {
  if (key === "label" || parent.type.startsWith("Import")) return false;
  if (parent.type === "ExportSpecifier" && key === "exported") return false;
  if (parent.computed === true) return true;
  if (key === "property" && parent.type === "MemberExpression") return false;
  return !(
    key === "key" &&
    (parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition")
  );
}

function sourceSnippet(code: string, node: AstNode): string {
  const source = code.slice(node.start, node.end).replace(/\s+/g, " ");
  return source.length > 80 ? `${source.slice(0, 77)}...` : source;
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
      const declared = asNodes(node.declarations).flatMap((item) =>
        patternIdentifiers(item.id).map((identifier) => String(identifier.name)),
      );
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

function walk(
  node: AstNode,
  visit: (node: AstNode, parent: AstNode | null, key: string) => void,
  parent: AstNode | null = null,
  parentKey = "",
): void {
  visit(node, parent, parentKey);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isAstNode(value)) walk(value, visit, node, key);
    else if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) walk(item, visit, node, key);
    }
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
