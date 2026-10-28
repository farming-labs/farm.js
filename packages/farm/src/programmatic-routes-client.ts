import { builtinModules } from "node:module";

/**
 * The browser imports a programmatic routes module to hydrate its pages, but
 * only needs each route's component, pending/error/notFound UI, params and
 * search options, and actions (server-function references). Guards, data
 * hooks, static paths, generated metadata, and API handlers run on the server,
 * so the client build removes them from the route options and then drops the
 * top-level imports and declarations only they used. Their server import graph
 * (database clients, credentials, node:fs) never enters the client bundle.
 *
 * The transform fails closed. A routes module (the file Farm loads routes from,
 * and the modules it takes route lists from) is always transformed, whatever it
 * imports, and once the known shapes are stripped any server-only route key Farm
 * did not remove fails the build instead of shipping.
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
  /**
   * The module is known to hold routes: the routes file, or a module a routes file takes
   * route lists from. It is checked even when it imports nothing from Farm.
   */
  routesModule?: boolean;
  /** Exports another routes module passes to defineRoutes() as its routes callback. */
  callbackExports?: readonly string[];
}

export interface ProgrammaticRouteSource {
  /** The import specifier, as written in the routes module. */
  source: string;
  /** Exports of that module defineRoutes() receives as its routes callback. */
  callbackExports: string[];
}

export interface TransformProgrammaticRoutesForClientResult {
  code: string;
  /** True when the module defines programmatic routes, even if nothing was removed. */
  definesRoutes: boolean;
  /** Modules this one takes route definitions from, which must be checked as routes modules. */
  routeSources: ProgrammaticRouteSource[];
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
// Keys too specific to route hooks to be anything else when assigned or declared on a class.
const ROUTE_HOOK_MEMBER_KEYS: ReadonlySet<string> = new Set([
  "guard",
  "staticPaths",
  "generateMetadata",
  ...API_METHOD_KEYS,
]);
const MODULE_EXTENSION_RE = /\.[cm]?[jt]sx?$/;
const NODE_BUILTINS = new Set(builtinModules);

export function transformProgrammaticRoutesForClient(
  options: TransformProgrammaticRoutesForClientOptions,
): TransformProgrammaticRoutesForClientResult | null {
  if (!isTransformableModule(options.id)) return null;
  const routesModule = options.routesModule === true;
  // Other modules only define routes through Farm's builders. A routes module is read
  // structurally: type-only imports are already erased by the time this runs.
  if (!routesModule && !options.code.includes("@farm.js/core")) return null;

  let ast = options.parse(options.code);
  const callbackExports = options.callbackExports ?? [];
  const bindings = findRouteBindings(ast, callbackExports);
  if (!routesModule && bindings.names.size === 0) return null;

  let definitions = findRouteDefinitions(ast, bindings);
  if (!routesModule && definitions.length === 0 && !bindings.definesRoutes) return null;
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
    definitions = findRouteDefinitions(ast, findRouteBindings(ast, callbackExports));
  }
  if (stripped) {
    code = applyReplacements(code, removeUnusedTopLevel(code, ast));
    ast = options.parse(code);
  }

  const finalBindings = findRouteBindings(ast, callbackExports);
  assertNoServerKeysRemain(code, options.id, ast, finalBindings);

  const builtin = findNodeBuiltinImport(ast);
  if (builtin) {
    throw new Error(
      `[Farm.js] ${options.id} defines programmatic routes and is loaded in the browser to ` +
        `hydrate them, but it still imports the server-only module "${builtin}" after Farm ` +
        "removed the server route hooks (guard, data, staticPaths, generateMetadata, and API " +
        "handlers). Use it only inside those hooks, or move it into a module that only they import.",
    );
  }

  return { code, definesRoutes: true, routeSources: findRouteSources(ast, finalBindings) };
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

export function isApplicationModuleId(id: string): boolean {
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
  /** Identifiers that name a local reusing a builder's name, not the builder. */
  shadowed: Set<AstNode>;
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
 * defineRoutes hands its callback (here, or as `callbackExports` from another routes
 * module); and const aliases or destructuring of any of those.
 */
function findRouteBindings(ast: AstNode, callbackExports: readonly string[] = []): RouteBindings {
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

  for (const callback of findExportedFunctions(ast, callbackExports)) {
    const builder = asNodes(callback.params)[0];
    if (builder && bindBuilderPattern(builder)) definesRoutes = true;
  }

  for (let changed = names.size > 0; changed; ) {
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

  const shadowed = findShadowedReferences(ast, names, followed);
  return { names, followed, shadowed, definesRoutes };
}

/** Functions the module exports under one of `names` ("default" for the default export). */
function findExportedFunctions(ast: AstNode, names: readonly string[]): AstNode[] {
  if (names.length === 0) return [];
  const wanted = new Set(names);
  const found: AstNode[] = [];
  const add = (node: AstNode | undefined) => {
    if (node) found.push(node);
  };
  for (const statement of asNodes(ast.body)) {
    if (statement.type === "ExportDefaultDeclaration" && wanted.has("default")) {
      const declaration = statement.declaration as AstNode;
      add(
        declaration.type === "FunctionDeclaration"
          ? declaration
          : findRoutesCallback(ast, declaration),
      );
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.source) continue;
    const declaration = isAstNode(statement.declaration) ? statement.declaration : undefined;
    if (declaration?.type === "FunctionDeclaration" && isAstNode(declaration.id)) {
      if (wanted.has(String(declaration.id.name))) add(declaration);
    }
    for (const item of declaration?.type === "VariableDeclaration"
      ? asNodes(declaration.declarations)
      : []) {
      if (isAstNode(item.id) && item.id.type === "Identifier" && wanted.has(String(item.id.name))) {
        add(isAstNode(item.init) && isFunctionNode(item.init) ? item.init : undefined);
      }
    }
    for (const specifier of asNodes(statement.specifiers)) {
      if (wanted.has(String(readPropertyName(specifier.exported)))) {
        add(findRoutesCallback(ast, specifier.local as AstNode));
      }
    }
  }
  return found;
}

/**
 * Identifiers that resolve to a local declared with a builder's name (a component
 * parameter `{ page }`, a `.map((page) => ...)` callback) rather than to the builder.
 * Only uses inside the scope of such a declaration are exempt.
 */
function findShadowedReferences(
  ast: AstNode,
  names: ReadonlyMap<string, RouteBinding>,
  followed: ReadonlySet<AstNode>,
): Set<AstNode> {
  const scopes = new Map<AstNode, Set<string>>();
  walkWithAncestors(ast, (node, ancestors) => {
    for (const [identifier, scope] of scopedDeclarations(node, ancestors)) {
      const name = String(identifier.name);
      if (!names.has(name) || followed.has(identifier) || !scope) continue;
      let declared = scopes.get(scope);
      if (!declared) scopes.set(scope, (declared = new Set()));
      declared.add(name);
    }
  });

  const shadowed = new Set<AstNode>();
  if (scopes.size === 0) return shadowed;
  walkWithAncestors(ast, (node, ancestors) => {
    if (node.type !== "Identifier" || followed.has(node)) return;
    const name = String(node.name);
    if (ancestors.some((ancestor) => scopes.get(ancestor)?.has(name))) shadowed.add(node);
  });
  return shadowed;
}

const FUNCTION_SCOPES = new Set([
  "Program",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const BLOCK_SCOPES = new Set([
  ...FUNCTION_SCOPES,
  "BlockStatement",
  "StaticBlock",
  "SwitchStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);

/** The identifiers `node` declares, each with the node whose scope holds it. */
function scopedDeclarations(
  node: AstNode,
  ancestors: readonly AstNode[],
): Array<[AstNode, AstNode | undefined]> {
  const nearest = (types: ReadonlySet<string>) => {
    for (let index = ancestors.length - 1; index >= 0; index--) {
      if (types.has(ancestors[index]!.type)) return ancestors[index];
    }
    return undefined;
  };
  const withScope = (identifiers: AstNode[], scope: AstNode | undefined) =>
    identifiers.map((identifier): [AstNode, AstNode | undefined] => [identifier, scope]);

  switch (node.type) {
    case "VariableDeclarator": {
      const declaration = ancestors.at(-1);
      const scope = nearest(declaration?.kind === "var" ? FUNCTION_SCOPES : BLOCK_SCOPES);
      return withScope(patternIdentifiers(node.id), scope);
    }
    case "FunctionDeclaration":
      return [
        ...withScope(patternIdentifiers(node.id), nearest(BLOCK_SCOPES)),
        ...withScope(asNodes(node.params).flatMap(patternIdentifiers), node),
      ];
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return withScope(
        [...patternIdentifiers(node.id), ...asNodes(node.params).flatMap(patternIdentifiers)],
        node,
      );
    case "ClassDeclaration":
      return withScope(patternIdentifiers(node.id), nearest(BLOCK_SCOPES));
    case "ClassExpression":
    case "CatchClause":
      return withScope(
        patternIdentifiers(node.type === "CatchClause" ? node.param : node.id),
        node,
      );
    default:
      return [];
  }
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
  shadowed?: ReadonlySet<AstNode>,
): RouteBinding | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier") {
    return shadowed?.has(node) ? undefined : names.get(String(node.name));
  }
  if (node.type !== "MemberExpression") return undefined;
  if (resolveRouteBinding(node.object, names, shadowed)?.type !== "builder") return undefined;
  if (node.computed === true && !isStaticString(node.property)) return undefined;
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
    const binding = resolveRouteBinding(node.callee, bindings.names, bindings.shadowed);
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
    if (property.computed === true && !isStaticString(property.key)) continue;
    const key = readPropertyName(property.key);
    if (key === "kind" && isAstNode(property.value)) kind = property.value;
    else if (key && UNRESOLVED_KIND_SERVER_KEYS.has(key)) serverKey = true;
  }
  if (!kind) return undefined;
  if (isStaticString(kind)) {
    const value = readPropertyName(kind);
    return value === "page" || value === "layout" || value === "api" ? value : undefined;
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
    if (property.computed === true && !isStaticString(property.key)) {
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
  { names, followed, shadowed }: RouteBindings,
): void {
  walk(ast, (node, parent, key) => {
    if (node.type !== "Identifier" || !parent || followed.has(node) || shadowed.has(node)) return;
    const name = String(node.name);
    const binding = names.get(name);
    if (!binding || binding.type === "defineRoutes") return;
    if (!isReferencePosition(parent, key)) return;
    // Other members of the module, such as core.notFound(), are not route builders. A
    // member Farm can't name, such as routesBuilder[key], could be any of them.
    if (
      binding.type === "builder" &&
      parent.type === "MemberExpression" &&
      key === "object" &&
      (parent.computed !== true || isStaticString(parent.property)) &&
      !resolveRouteBinding(parent, names, shadowed)
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

/** A string literal, or a template literal without expressions. */
function isStaticString(node: unknown): boolean {
  if (!isAstNode(node)) return false;
  if (node.type === "Literal") return typeof node.value === "string";
  return node.type === "TemplateLiteral" && asNodes(node.expressions).length === 0;
}

/**
 * The last line of defence: once the known shapes are stripped, a routes module must not
 * still set a server-only route key anywhere its route list could pick it up. Shapes Farm
 * can't read (a definition that spreads its kind, Object.assign, a builder hidden behind
 * a helper) fail here instead of shipping their hooks and imports to the browser.
 *
 * Exempt are the values of route options Farm kept (components, schemas, metadata) and
 * the arguments of calls into packages (JSX runtimes, schema builders), unless such an
 * argument names a route itself with `kind` or `path`.
 */
function assertNoServerKeysRemain(
  code: string,
  id: string,
  ast: AstNode,
  bindings: RouteBindings,
): void {
  const exempt = new Set<AstNode>();
  for (const definition of findRouteDefinitions(ast, bindings)) {
    for (const property of asNodes(definition.options.properties)) {
      if (isAstNode(property.value)) exempt.add(property.value);
    }
  }

  const packageImports = new Set<string>();
  for (const statement of asNodes(ast.body)) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string" || !isPackageSpecifier(source)) continue;
    for (const specifier of asNodes(statement.specifiers)) {
      if (isAstNode(specifier.local)) packageImports.add(String(specifier.local.name));
    }
  }
  walk(ast, (node) => {
    if (node.type !== "CallExpression" && node.type !== "NewExpression") return;
    const root = rootIdentifier(node.callee);
    if (!root || bindings.shadowed.has(root) || !packageImports.has(String(root.name))) return;
    if (resolveRouteBinding(node.callee, bindings.names, bindings.shadowed)) return;
    for (const argument of asNodes(node.arguments)) {
      if (argument.type === "ObjectExpression" && namesRoute(argument)) continue;
      exempt.add(argument);
    }
  });

  walk(
    ast,
    (node) => {
      const key = remainingServerKey(node);
      if (!key) return;
      throw new Error(
        `[Farm.js] ${id}: ${sourceSnippet(code, node)} still sets the server-only key ` +
          `"${key}" after Farm removed the server route hooks for the browser, so its code and ` +
          "imports would ship in public JavaScript. Farm removes guard, data, staticPaths, " +
          "generateMetadata, and API handlers only from page(), layout(), api(), and " +
          'createRoute() options and { kind: "page" } definitions written inline as object ' +
          "literals. Write this route that way, or move code that uses these keys out of the " +
          "routes module.",
      );
    },
    null,
    "",
    exempt,
  );
}

function remainingServerKey(node: AstNode): string | undefined {
  if (node.type === "ObjectExpression") {
    for (const property of asNodes(node.properties)) {
      if (property.type !== "Property") continue;
      if (property.computed === true && !isStaticString(property.key)) continue;
      const key = readPropertyName(property.key);
      if (!key || !UNRESOLVED_KIND_SERVER_KEYS.has(key)) continue;
      const value = property.value as AstNode;
      // The empty map Farm keeps on a stripped { kind: "api" } definition.
      if (
        key === "methods" &&
        value.type === "ObjectExpression" &&
        !asNodes(value.properties).length
      ) {
        continue;
      }
      return key;
    }
    return undefined;
  }
  let member: unknown;
  if (node.type === "AssignmentExpression" && isAstNode(node.left)) {
    if (node.left.type !== "MemberExpression") return undefined;
    member =
      node.left.computed === true && !isStaticString(node.left.property)
        ? undefined
        : node.left.property;
  } else if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
    member = node.computed === true && !isStaticString(node.key) ? undefined : node.key;
  }
  const key = readPropertyName(member);
  return key && ROUTE_HOOK_MEMBER_KEYS.has(key) ? key : undefined;
}

function namesRoute(node: AstNode): boolean {
  return asNodes(node.properties).some((property) => {
    const key = property.type === "Property" ? readPropertyName(property.key) : undefined;
    return key === "kind" || key === "path";
  });
}

function rootIdentifier(node: unknown): AstNode | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier") return node;
  if (node.type === "MemberExpression") return rootIdentifier(node.object);
  if (node.type === "ChainExpression") return rootIdentifier(node.expression);
  return undefined;
}

/** A bare package specifier, not a relative, absolute, or `@/`/`~/`/`#` alias path. */
function isPackageSpecifier(source: string): boolean {
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9]/i.test(source) && !/^[a-z]:[\\/]/i.test(source);
}

/**
 * Modules whose exports this routes module puts in its route list: imports reached from
 * the default, `routes`, or `Route` export or a defineRoutes() argument, through arrays,
 * spreads, conditionals, local declarations, and calls. Their route definitions reach the
 * browser through this module, so they are checked as routes modules too.
 */
function findRouteSources(ast: AstNode, bindings: RouteBindings): ProgrammaticRouteSource[] {
  const imports = new Map<string, { source: string; imported: string }>();
  for (const statement of asNodes(ast.body)) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string") continue;
    for (const specifier of asNodes(statement.specifiers)) {
      if (!isAstNode(specifier.local)) continue;
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier.type === "ImportSpecifier"
            ? String(readPropertyName(specifier.imported))
            : "*";
      imports.set(String(specifier.local.name), { source, imported });
    }
  }

  const sources = new Map<string, Set<string>>();
  const record = (source: string, callbackExport?: string) => {
    if (ROUTE_IMPORT_SOURCES.has(source) || source.startsWith("@farm.js/core/")) return;
    let callbacks = sources.get(source);
    if (!callbacks) sources.set(source, (callbacks = new Set()));
    if (callbackExport) callbacks.add(callbackExport);
  };
  const visited = new Set<AstNode>();
  const visit = (node: unknown, callback = false): void => {
    if (!isAstNode(node) || visited.has(node)) return;
    visited.add(node);
    switch (node.type) {
      case "Identifier": {
        const name = String(node.name);
        const imported = imports.get(name);
        if (imported) {
          record(
            imported.source,
            callback && imported.imported !== "*" ? imported.imported : undefined,
          );
        } else {
          visit(findLocalDeclaration(ast, name), callback);
        }
        return;
      }
      case "VariableDeclarator":
        return visit(node.init, callback);
      case "MemberExpression":
        return visit(node.object);
      case "ArrayExpression":
        for (const element of asNodes(node.elements)) visit(element);
        return;
      case "ObjectExpression":
        for (const property of asNodes(node.properties)) {
          if (property.type === "SpreadElement") visit(property.argument);
        }
        return;
      case "SpreadElement":
      case "AwaitExpression":
        return visit(node.argument);
      case "ChainExpression":
      case "ParenthesizedExpression":
        return visit(node.expression);
      case "ConditionalExpression":
        visit(node.consequent);
        return visit(node.alternate);
      case "LogicalExpression":
        visit(node.left);
        return visit(node.right);
      case "SequenceExpression":
        return visit(asNodes(node.expressions).at(-1));
      case "CallExpression":
      case "NewExpression": {
        const binding = resolveRouteBinding(node.callee, bindings.names, bindings.shadowed);
        if (binding?.type === "defineRoutes") return visit(asNodes(node.arguments)[0], true);
        if (binding) return;
        visit(node.callee);
        for (const argument of asNodes(node.arguments)) visit(argument);
        return;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const body = node.body as AstNode;
        if (body.type !== "BlockStatement") return visit(body);
        walkFunctionBody(body, (statement) => {
          if (statement.type === "ReturnStatement") visit(statement.argument);
        });
        return;
      }
      default:
        return;
    }
  };

  for (const statement of asNodes(ast.body)) {
    if (statement.type === "ExportDefaultDeclaration") visit(statement.declaration);
    if (statement.type === "ExportAllDeclaration" && isAstNode(statement.source)) {
      record(String(statement.source.value));
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (isAstNode(statement.source)) {
      record(String(statement.source.value));
      continue;
    }
    const declaration = isAstNode(statement.declaration) ? statement.declaration : undefined;
    for (const item of declaration?.type === "VariableDeclaration"
      ? asNodes(declaration.declarations)
      : []) {
      if (isAstNode(item.id) && ROUTE_LIST_EXPORTS.has(String(item.id.name))) visit(item);
    }
    for (const specifier of asNodes(statement.specifiers)) {
      if (ROUTE_LIST_EXPORTS.has(String(readPropertyName(specifier.exported)))) {
        visit(specifier.local);
      }
    }
  }
  walk(ast, (node) => {
    if (
      node.type === "CallExpression" &&
      resolveRouteBinding(node.callee, bindings.names, bindings.shadowed)?.type === "defineRoutes"
    ) {
      visit(node);
    }
  });

  return [...sources].map(([source, callbacks]) => ({
    source,
    callbackExports: [...callbacks],
  }));
}

// The exports Farm's generated route modules read routes from.
const ROUTE_LIST_EXPORTS = new Set(["default", "routes", "Route"]);

function findLocalDeclaration(ast: AstNode, name: string): AstNode | undefined {
  let found: AstNode | undefined;
  walk(ast, (node) => {
    if (found || !isAstNode(node.id) || node.id.name !== name) return;
    if (node.type === "VariableDeclarator" || node.type === "FunctionDeclaration") found = node;
  });
  return found;
}

/** Visit a function body's statements without entering nested functions. */
function walkFunctionBody(body: AstNode, visit: (node: AstNode) => void): void {
  walk(body, visit, null, "", undefined, (node) => node !== body && FUNCTION_SCOPES.has(node.type));
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
  if (isStaticString(node)) {
    const cooked = (asNodes(node.quasis)[0]?.value as { cooked?: unknown } | undefined)?.cooked;
    return typeof cooked === "string" ? cooked : undefined;
  }
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
  skip?: ReadonlySet<AstNode>,
  skipWhen?: (node: AstNode) => boolean,
): void {
  if (skip?.has(node) || skipWhen?.(node)) return;
  visit(node, parent, parentKey);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isAstNode(value)) walk(value, visit, node, key, skip, skipWhen);
    else if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) walk(item, visit, node, key, skip, skipWhen);
    }
  }
}

function walkWithAncestors(
  node: AstNode,
  visit: (node: AstNode, ancestors: readonly AstNode[]) => void,
  ancestors: AstNode[] = [],
): void {
  visit(node, ancestors);
  ancestors.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isAstNode(value)) walkWithAncestors(value, visit, ancestors);
    else if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) walkWithAncestors(item, visit, ancestors);
    }
  }
  ancestors.pop();
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
