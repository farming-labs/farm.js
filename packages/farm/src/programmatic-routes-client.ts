/**
 * The browser copy of a programmatic page or layout imports only the module that defines its
 * component, never the routes file. Guards, data hooks, static paths, generated metadata, API
 * handlers, and whatever the routes file imports for them stay out of the client graph because
 * the client graph never reaches the routes file.
 *
 * Farm already evaluates the routes file on the server to build its route table. That
 * evaluation also tells it where each component lives: the server module graph holds every
 * module the routes file reached, with its exports, so the module that exports the very
 * function (or object) a route uses as its `component` is that component's own module. This
 * works for any way the route list is built (helpers, re-exported lists, assignments, aliases)
 * because it reads the evaluated value instead of the routes file's syntax. A component that no
 * other module exports (declared in the routes file, or computed there) has no module to
 * import, so a client build that needs it fails with an actionable error.
 *
 * A module that holds route definitions is never a component's client import, however it holds
 * them: Farm finds definitions in every evaluated module's exports (inside objects, arrays,
 * maps, and sets), and route factories record the module that called them while routes are
 * evaluated, which also finds definitions kept behind a function. A definition written as an
 * object literal and kept out of every export can't be traced, so then a component module is
 * accepted only when neither it nor anything it imports holds route-defining code.
 */

import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { getProgrammaticRouteDefinitionSource } from "./routes-shared";

export type ProgrammaticClientRouteKind = "page" | "layout";

export interface ProgrammaticClientModuleExport {
  /** Absolute path of the module that exports the value. */
  file: string;
  /** The export name that holds it. */
  exportName: string;
}

export interface ProgrammaticClientRoute {
  kind: ProgrammaticClientRouteKind;
  path: string;
  /** Absolute path of the routes file that defines the route. */
  routesFile: string;
  component?: ProgrammaticClientModuleExport;
  pending?: ProgrammaticClientModuleExport;
  /**
   * The route options the server resolves into the page's props (params, search, guard, data).
   * The browser copy renders only from props the server resolved.
   */
  serverProps?: string[];
  /** Why the browser copy can't be generated, when it can't. */
  problem?: string;
}

export interface ProgrammaticClientRoutes {
  /** Keyed by {@link programmaticClientRouteKey}. */
  routes: ReadonlyMap<string, ProgrammaticClientRoute>;
  /**
   * Routes files and the modules that export route definitions. None of them may enter the
   * client graph.
   */
  routeSourceFiles: ReadonlySet<string>;
}

/** What the `farm` Vite plugin shares with Farm's other Vite plugins. */
export interface FarmProgrammaticRoutesPluginApi {
  getProgrammaticClientRoutes(): ProgrammaticClientRoutes | undefined;
}

/** One evaluated module, as the server's module runner holds it. */
export interface ProgrammaticRouteGraphModule {
  id: string;
  /** Absolute file path, without a query. */
  file?: string;
  imports: Iterable<string>;
  exports: unknown;
  /** Loaded by the runtime instead of the module runner (a package dependency). */
  external?: boolean;
  /** The specifier importers request it by. */
  url?: string;
  /** The code the module runner evaluated (absent for a package dependency). */
  code?: string;
}

export interface ProgrammaticRouteGraph {
  getModuleById(id: string): ProgrammaticRouteGraphModule | undefined;
  getModulesByFile(file: string): Iterable<ProgrammaticRouteGraphModule>;
}

interface RouteLike {
  kind?: unknown;
  path?: unknown;
  component?: unknown;
  pending?: unknown;
  params?: unknown;
  search?: unknown;
  guard?: unknown;
  data?: unknown;
}

const SERVER_PROPS_KEYS = ["params", "search", "guard", "data"] as const;

export function programmaticClientRouteKey(
  routesFile: string,
  kind: ProgrammaticClientRouteKind,
  routePath: string,
): string {
  return `${toPosixPath(routesFile)}\0${kind}\0${routePath}`;
}

/**
 * Map each programmatic page and layout in an evaluated routes file to the modules that export
 * its component (and its pending component, which shapes the hydrated tree).
 */
export function resolveProgrammaticClientRoutes(options: {
  graph: ProgrammaticRouteGraph;
  routesFile: string;
  routes: readonly unknown[];
  normalizeRoutePath: (routePath: string) => string;
}): ProgrammaticClientRoutes {
  const routesFile = toPosixPath(options.routesFile);
  const modules = collectGraph(options.graph, routesFile);
  const routeSourceFiles = new Set<string>([routesFile]);
  const exportsByValue = new Map<unknown, Array<{ module: GraphEntry; exportName: string }>>();
  const modulesByFile = new Map<string, GraphEntry[]>();
  const definitions = options.routes.filter(isProgrammaticRouteDefinition) as RouteLike[];

  for (const module of modules.values()) {
    if (module.file) {
      modulesByFile.set(module.file, [...(modulesByFile.get(module.file) ?? []), module]);
    }
    for (const [exportName, value] of module.exports) {
      if (!isReferenceValue(value)) continue;
      if (!module.routeSource && holdsRouteDefinition(value, definitions)) {
        module.routeSource = true;
      }
      const owners = exportsByValue.get(value) ?? [];
      owners.push({ module, exportName });
      exportsByValue.set(value, owners);
    }
  }

  // Route factories record the stack that made each definition: the module that called them
  // defines routes, even when it keeps them behind a function instead of exporting them.
  let untraced = false;
  const definedIn = new Map<RouteLike, GraphEntry[]>();
  for (const route of definitions) {
    const source = getProgrammaticRouteDefinitionSource(route);
    const callers = (source?.stacks ?? []).map((stack) => findRouteCallers(stack, modulesByFile));
    for (const caller of callers.flat()) caller.routeSource = true;
    definedIn.set(route, callers.flat());
    if (!source || source.raw || (callers[0] ?? []).length === 0) untraced = true;
  }
  for (const module of modules.values()) {
    if (module.routeSource && module.file) routeSourceFiles.add(module.file);
  }

  const reaches = createReachability(modules);
  const closure = createClosure(modules);
  const routeCode = new Map<GraphEntry, boolean>();
  const definesRoutes = (module: GraphEntry) => {
    if (!routeCode.has(module)) routeCode.set(module, mayDefineRoutes(module.code));
    return routeCode.get(module)!;
  };
  // Why a module can't be a component's client import, if it can't.
  const refusal = new Map<GraphEntry, string | null>();
  const refuse = (module: GraphEntry): string | null => {
    if (refusal.has(module)) return refusal.get(module)!;
    let reason: string | null = null;
    for (const reached of closure(module)) {
      if (reached.routeSource) {
        reason =
          reached === module
            ? `${module.file}, which defines routes`
            : `${module.file}, which imports ${reached.file ?? reached.id}, which defines routes`;
        break;
      }
      if (untraced && !reached.external && definesRoutes(reached)) {
        reason =
          `${module.file}, and a route defined as an object literal outside every export ` +
          `can't be traced to its module, so Farm can't tell that ` +
          `${reached === module ? "it" : (reached.file ?? reached.id)} defines no routes ` +
          "(build such routes with page(), layout(), or api(), or export them)";
        break;
      }
    }
    refusal.set(module, reason);
    return reason;
  };

  const locate = (
    route: RouteLike,
    value: unknown,
    label: string,
  ): ProgrammaticClientModuleExport | string => {
    if (!isReferenceValue(value)) return `its ${label} is not a component`;
    const owners = exportsByValue.get(value) ?? [];
    const local = owners.filter(({ module }) => module.file && !module.external);
    const eligible = local.filter(({ module }) => !refuse(module));
    if (eligible.length === 0) {
      const refused = local.find(({ module }) => refuse(module));
      if (refused) return `its ${label} is exported by ${refuse(refused.module)}`;
      if (owners.some(({ module }) => module.external)) {
        return `its ${label} comes from a package; re-export it from a module in your app`;
      }
      return `its ${label} is not exported by any module the routes file imports`;
    }
    // The defining module, not a barrel that re-exports it: the one that reaches no other.
    let defining = eligible.filter(
      (candidate) =>
        !eligible.some(
          (other) => other.module !== candidate.module && reaches(candidate.module, other.module),
        ),
    );
    if (defining.length === 0) defining = eligible;
    if (new Set(defining.map(({ module }) => module)).size > 1) {
      // Several unrelated modules export it (each re-exporting a package, say). Take the one
      // the routes file or the route's own module imported it from, then the shallowest.
      const importers = [...(modulesByFile.get(routesFile) ?? []), ...(definedIn.get(route) ?? [])];
      const imported = defining.filter((candidate) =>
        importers.some((importer) => importsBinding(importer, candidate)),
      );
      if (imported.length > 0) defining = imported;
      const depth = Math.min(...defining.map(({ module }) => module.depth));
      defining = defining.filter(({ module }) => module.depth === depth);
      const files = [...new Set(defining.map(({ module }) => module.file!))];
      if (files.length > 1) {
        return (
          `its ${label} is exported by several modules (${files.join(", ")}) and Farm can't ` +
          "tell which one the routes file uses"
        );
      }
    }
    const chosen = defining.sort(compareOwners)[0]!;
    return { file: chosen.module.file!, exportName: chosen.exportName };
  };

  const routes = new Map<string, ProgrammaticClientRoute>();
  for (const route of definitions) {
    if ((route.kind !== "page" && route.kind !== "layout") || typeof route.path !== "string") {
      continue;
    }
    const routePath = options.normalizeRoutePath(route.path);
    const clientRoute: ProgrammaticClientRoute = {
      kind: route.kind,
      path: routePath,
      routesFile,
    };
    const problems: string[] = [];
    const component = locate(route, route.component, "component");
    if (typeof component === "string") problems.push(component);
    else clientRoute.component = component;

    if (route.kind === "page") {
      if (route.pending) {
        const pending = locate(route, route.pending, "pending component");
        if (typeof pending === "string") problems.push(pending);
        else clientRoute.pending = pending;
      }
      const serverProps = SERVER_PROPS_KEYS.filter((key) => Boolean(route[key]));
      if (serverProps.length > 0) clientRoute.serverProps = serverProps;
    }
    if (problems.length > 0) clientRoute.problem = problems.join("; ");
    routes.set(programmaticClientRouteKey(routesFile, route.kind, routePath), clientRoute);
  }

  return { routes, routeSourceFiles };
}

/** The server module runner's evaluated modules, which hold each module's exports. */
export function createEvaluatedRouteGraph(server: {
  environments?: Record<string, unknown>;
}): ProgrammaticRouteGraph | undefined {
  const evaluated = (
    server.environments?.ssr as { runner?: { evaluatedModules?: EvaluatedModulesLike } } | undefined
  )?.runner?.evaluatedModules;
  if (!evaluated) return undefined;
  const toGraphModule = (node: EvaluatedModuleLike): ProgrammaticRouteGraphModule => ({
    id: node.id,
    file: node.file || undefined,
    url: node.url,
    imports: node.imports,
    exports: node.exports,
    external: Boolean(node.meta && "externalize" in node.meta),
    code:
      node.meta && typeof (node.meta as { code?: unknown }).code === "string"
        ? (node.meta as { code: string }).code
        : undefined,
  });
  return {
    getModuleById: (id) => {
      const node = evaluated.getModuleById(id);
      return node ? toGraphModule(node) : undefined;
    },
    getModulesByFile: (file) =>
      [...(evaluated.fileToModulesMap.get(file) ?? [])].map(toGraphModule),
  };
}

interface EvaluatedModuleLike {
  id: string;
  url?: string;
  file: string;
  imports: Set<string>;
  exports: unknown;
  meta?: object;
}

interface EvaluatedModulesLike {
  getModuleById(id: string): EvaluatedModuleLike | undefined;
  fileToModulesMap: Map<string, Set<EvaluatedModuleLike>>;
}

export function mergeProgrammaticClientRoutes(
  entries: readonly ProgrammaticClientRoutes[],
): ProgrammaticClientRoutes {
  const routes = new Map<string, ProgrammaticClientRoute>();
  const routeSourceFiles = new Set<string>();
  for (const entry of entries) {
    for (const [key, route] of entry.routes) routes.set(key, route);
    for (const file of entry.routeSourceFiles) routeSourceFiles.add(file);
  }
  return { routes, routeSourceFiles };
}

export interface GenerateProgrammaticClientRouteModuleOptions {
  kind: "page" | "layout" | "api";
  routePath: string;
  routesFile: string;
  route: ProgrammaticClientRoute | undefined;
  /** The renderer's server runtime, which provides createElement and Suspense. */
  rendererServer: string;
  /** Turns an absolute file path into the import specifier the build resolves. */
  toImportSpecifier: (file: string) => string;
}

/**
 * The browser copy of a programmatic route: its component module's export, wrapped the way the
 * server wraps it, and nothing from the routes file.
 */
export function generateProgrammaticClientRouteModule(
  options: GenerateProgrammaticClientRouteModuleOptions,
): string {
  const label = `Programmatic ${options.kind} route "${options.routePath}" in ${options.routesFile}`;
  if (options.kind === "api") {
    throw new Error(
      `[Farm.js] ${label} is server-only, but the browser bundle imports it. API routes never ` +
        "reach the browser; call them over HTTP instead.",
    );
  }
  const route = options.route;
  if (!route) {
    throw new Error(
      `[Farm.js] ${label} renders in the browser, but Farm did not find it when it evaluated ` +
        "the routes file on the server, so it can't tell which module holds its component.",
    );
  }
  if (route.problem || !route.component) {
    throw new Error(
      `[Farm.js] ${label} renders in the browser, but ${route.problem ?? "its component has no module"}. ` +
        "The browser never loads the routes file, so move the component to its own module and " +
        "import it into the routes file (for example `import { AdminPage } from " +
        '"./features/admin/page"`).',
    );
  }

  const component = importExport(route.component, "__farmComponent", options.toImportSpecifier);
  if (route.kind === "layout") {
    return `${component}\nexport default __farmComponent;\n`;
  }

  const pending = route.pending
    ? importExport(route.pending, "__farmPending", options.toImportSpecifier)
    : "";
  if (!route.pending && !route.serverProps) {
    // Nothing to resolve: the server renders the component itself, and so does the browser.
    return `${component}\nexport default __farmComponent;\n`;
  }

  const definition = [
    `kind: "page"`,
    `path: ${JSON.stringify(route.path)}`,
    "component: __farmComponent",
    ...(route.pending ? ["pending: __farmPending"] : []),
    // Read by createRouteModuleFromProgrammaticPage: the page renders only from props the
    // server resolved for this document.
    ...(route.serverProps ? [`__farmServerHooks: ${JSON.stringify(route.serverProps)}`] : []),
  ];

  return `
import * as __farmRendererRuntime from ${JSON.stringify(options.rendererServer)};
import { createRouteModuleFromProgrammaticPage as __farmCreatePageRouteModule } from "@farm.js/core/routes";
${component}
${pending}

const __farmRouteModule = __farmCreatePageRouteModule(
  { ${definition.join(", ")} },
  {
    createElement: __farmRendererRuntime.createElement,
    Suspense: __farmRendererRuntime.Suspense,
    // Optional hook: only renderers that need it export markFunctionComponent.
    markFunctionComponent: Reflect.get(__farmRendererRuntime, "markFunctionComponent"),
  },
);

export const __farmRouteSchemas = __farmRouteModule.__farmRouteSchemas;
export const __farmRouteParsesProps = __farmRouteModule.__farmRouteParsesProps;
export const __farmResolveRouteProps = __farmRouteModule.__farmResolveRouteProps;
export default __farmRouteModule.default;
`.trimStart();
}

/**
 * The import chain from a client route module to a Node builtin, if its static imports reach
 * one through modules of the app: server-only code that reached the browser bundle.
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

const NODE_BUILTINS = new Set(builtinModules);
const MODULE_EXTENSION_RE = /\.[cm]?[jt]sx?$/;

function isApplicationModuleId(id: string): boolean {
  if (id.startsWith("\0") || id.includes("/node_modules/") || id.includes("\\node_modules\\")) {
    return false;
  }
  return MODULE_EXTENSION_RE.test(id.split("?", 1)[0]!);
}

function isNodeBuiltinId(id: string): boolean {
  const external = id.indexOf("__vite-browser-external:");
  const bare = external === 0 || external === 1 ? id.slice(external + 24) : id;
  return bare.startsWith("node:") || NODE_BUILTINS.has(bare);
}

/** RSC replaces a routes module a client component imports with an action-only proxy. */
export function isProgrammaticRouteActionProxy(code: string | null | undefined): boolean {
  return Boolean(code?.includes("__farmRouteActionTarget: true"));
}

type GraphEntry = {
  id: string;
  file?: string;
  url?: string;
  code?: string;
  external: boolean;
  imports: string[];
  exports: Array<[string, unknown]>;
  routeSource: boolean;
  order: number;
  /** Imports between the routes file and this module. */
  depth: number;
};

function collectGraph(graph: ProgrammaticRouteGraph, routesFile: string): Map<string, GraphEntry> {
  const modules = new Map<string, GraphEntry>();
  const queue = [...graph.getModulesByFile(routesFile)].map((node) => ({ node, depth: 0 }));
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (modules.has(node.id)) continue;
    const file = node.file ? toModuleFile(node.file) : undefined;
    const entry: GraphEntry = {
      id: node.id,
      file,
      url: node.url,
      code: node.code,
      external: node.external === true,
      imports: [...node.imports],
      exports: readExports(node.exports),
      routeSource: file === routesFile,
      order: modules.size,
      depth,
    };
    modules.set(node.id, entry);
    if (entry.external) continue;
    for (const id of entry.imports) {
      const imported = graph.getModuleById(id);
      if (imported && !modules.has(imported.id)) queue.push({ node: imported, depth: depth + 1 });
    }
  }
  return modules;
}

function createReachability(modules: Map<string, GraphEntry>) {
  const cache = new Map<string, Set<string>>();
  const reachable = (start: GraphEntry): Set<string> => {
    const cached = cache.get(start.id);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [...start.imports];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const module = modules.get(id);
      if (module && !module.external) stack.push(...module.imports);
    }
    cache.set(start.id, seen);
    return seen;
  };
  return (from: GraphEntry, to: GraphEntry) => reachable(from).has(to.id);
}

/** A module, then every module it imports, breadth first. Packages are listed, not entered. */
function createClosure(modules: Map<string, GraphEntry>) {
  return function* closure(start: GraphEntry): Generator<GraphEntry> {
    const seen = new Set<string>([start.id]);
    const queue = [start];
    while (queue.length > 0) {
      const module = queue.shift()!;
      yield module;
      if (module.external) continue;
      for (const id of module.imports) {
        const imported = modules.get(id);
        if (!imported || seen.has(id)) continue;
        seen.add(id);
        queue.push(imported);
      }
    }
  };
}

const WALK_DEPTH = 10;
const WALK_BUDGET = 20_000;

/**
 * Whether an exported value holds a route definition or a defineRoutes() manifest anywhere
 * inside it: in a holder object, an array, a map, or a set, or as a function's property.
 */
function holdsRouteDefinition(value: unknown, definitions: readonly RouteLike[]): boolean {
  const seen = new Set<unknown>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (queue.length > 0 && seen.size < WALK_BUDGET) {
    const { value: current, depth } = queue.shift()!;
    if (!isReferenceValue(current) || seen.has(current)) continue;
    seen.add(current);
    if (isRouteManifest(current) || isDefinitionObject(current, definitions)) return true;
    if (depth >= WALK_DEPTH || ArrayBuffer.isView(current) || current instanceof Promise) continue;
    const next = (child: unknown) => {
      if (isReferenceValue(child)) queue.push({ value: child, depth: depth + 1 });
    };
    try {
      if (Array.isArray(current)) current.forEach(next);
      else if (current instanceof Map) {
        for (const [key, child] of current) {
          next(key);
          next(child);
        }
      } else if (current instanceof Set) current.forEach(next);
      else {
        for (const key of Object.keys(current as object)) {
          // Read data properties only: a getter may run arbitrary code.
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (descriptor && "value" in descriptor) next(descriptor.value);
        }
      }
    } catch {
      // A proxy or exotic object that refuses inspection holds nothing Farm can read.
    }
  }
  return false;
}

function isRouteManifest(value: unknown): boolean {
  return (
    (value as { __farmRoutes?: unknown }).__farmRoutes === true &&
    Array.isArray((value as { routes?: unknown }).routes)
  );
}

/**
 * A route definition: a route kind with its path, and either a function of its own (a
 * component, guard, or handler) or the values of a definition in this routes file.
 */
function isDefinitionObject(value: unknown, definitions: readonly RouteLike[]): boolean {
  if (!isProgrammaticRouteDefinition(value)) return false;
  const route = value as Record<string, unknown>;
  const where = route.kind === "redirect" ? route.source : route.path;
  if (typeof where !== "string") return false;
  const values = Object.values(route);
  const own = (child: unknown) =>
    typeof child === "function" ||
    (isReferenceValue(child) &&
      Object.values(child as object).some((nested) => typeof nested === "function"));
  if (values.some(own)) return true;
  return definitions.some(
    (definition) =>
      definition.kind === route.kind &&
      Object.entries(definition).every(
        ([key, child]) => !isReferenceValue(child) || route[key] === child,
      ) &&
      (definition as Record<string, unknown>)[route.kind === "redirect" ? "source" : "path"] ===
        where,
  );
}

/**
 * The modules a route factory's stack runs through: the innermost module that called it, and
 * when that is a package, also the innermost module of the app. Frames in the factory's own
 * file are Farm's.
 */
function findRouteCallers(stack: string, modulesByFile: Map<string, GraphEntry[]>): GraphEntry[] {
  const files = stack
    .split("\n")
    .slice(1)
    .map(stackFrameFile)
    .filter((file): file is string => Boolean(file));
  const own = files[0];
  const callers: GraphEntry[] = [];
  for (const file of files) {
    if (file === own) continue;
    const modules = modulesByFile.get(file);
    if (!modules) continue;
    callers.push(...modules);
    if (modules.some((module) => !module.external)) break;
  }
  return callers;
}

function stackFrameFile(frame: string): string | undefined {
  const line = frame.trim();
  if (!line.startsWith("at ")) return undefined;
  const location = line.endsWith(")")
    ? line.slice(line.lastIndexOf("(") + 1, -1)
    : line.slice(3).replace(/^async /, "");
  const file = location.replace(/:\d+(?::\d+)?$/, "");
  if (!file || file === location || file.startsWith("node:") || file.includes("<anonymous>")) {
    return undefined;
  }
  return toModuleFile(file);
}

/** Whether `importer`'s evaluated code imports the export `candidate` names from its module. */
function importsBinding(
  importer: GraphEntry,
  candidate: { module: GraphEntry; exportName: string },
): boolean {
  if (!importer.code || !importer.imports.includes(candidate.module.id)) return false;
  const specifiers = new Set([candidate.module.url, candidate.module.id].filter(Boolean));
  for (const match of importer.code.matchAll(SSR_IMPORT_RE)) {
    if (!specifiers.has(readJsonString(match[1]!))) continue;
    if (match[2] === undefined) return true;
    const names = readJsonArray(`[${match[2]}]`);
    if (!names || names.includes(candidate.exportName)) return true;
  }
  return false;
}

// `await __vite_ssr_import__("/src/a.ts", {"importedNames":["A"]})`, as Vite's SSR transform
// writes imports and re-exports.
const SSR_IMPORT_RE =
  /__vite_ssr_import__\(("(?:[^"\\]|\\.)*")(?:\s*,\s*\{\s*"importedNames"\s*:\s*\[([^\]]*)\])?/g;
const ROUTE_KINDS = new Set(["page", "layout", "api", "redirect"]);
const ROUTE_FACTORIES = new Set([
  "page",
  "layout",
  "api",
  "redirect",
  "createRoute",
  "routesBuilder",
  "defineRoutes",
]);

/**
 * Whether evaluated code could build a route definition: an object with a route `kind` (or
 * one set from a variable), or a route factory imported from Farm. Code Farm can't read
 * counts as able to.
 */
function mayDefineRoutes(code: string | undefined): boolean {
  if (code === undefined) return true;
  for (const match of code.matchAll(KIND_KEY_RE)) {
    const value = code.slice(match.index! + match[0].length);
    const quote = value[0];
    if (quote !== '"' && quote !== "'" && quote !== "`") return true;
    const end = value.indexOf(quote, 1);
    if (end < 0 || ROUTE_KINDS.has(value.slice(1, end))) return true;
  }
  if (KIND_SHORTHAND_RE.test(code) || KIND_ASSIGNMENT_RE.test(code)) return true;
  for (const match of code.matchAll(SSR_IMPORT_RE)) {
    if (!FARM_CORE_RE.test(readJsonString(match[1]!) ?? "")) continue;
    if (match[2] === undefined) return true;
    const names = readJsonArray(`[${match[2]}]`);
    if (!names || names.some((name) => ROUTE_FACTORIES.has(String(name)))) return true;
  }
  return false;
}

const KIND_KEY_RE = /(?<![\w$.])["']?kind["']?\s*:\s*/g;
const KIND_SHORTHAND_RE = /[{,]\s*kind\s*[,}]/;
const KIND_ASSIGNMENT_RE = /(?:\.kind|\[\s*["'`]kind["'`]\s*\])\s*=(?!=)/;
const FARM_CORE_RE = /^@farm\.js\/core(?:\/routes)?$/;

function readJsonString(text: string): string | undefined {
  try {
    const value = JSON.parse(text);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function readJsonArray(text: string): unknown[] | undefined {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readExports(namespace: unknown): Array<[string, unknown]> {
  if (!namespace || (typeof namespace !== "object" && typeof namespace !== "function")) return [];
  const entries: Array<[string, unknown]> = [];
  let keys: string[];
  try {
    keys = Object.keys(namespace);
  } catch {
    return [];
  }
  for (const key of keys) {
    try {
      entries.push([key, (namespace as Record<string, unknown>)[key]]);
    } catch {
      // A binding still in its temporal dead zone (an import cycle) holds no component yet.
    }
  }
  return entries;
}

function isReferenceValue(value: unknown): boolean {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

function isProgrammaticRouteDefinition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "page" || kind === "layout" || kind === "api" || kind === "redirect";
}

function compareOwners(
  left: { module: GraphEntry; exportName: string },
  right: { module: GraphEntry; exportName: string },
): number {
  if (left.module !== right.module) return right.module.order - left.module.order;
  if (left.exportName === "default") return -1;
  if (right.exportName === "default") return 1;
  return left.exportName < right.exportName ? -1 : left.exportName > right.exportName ? 1 : 0;
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

function importExport(
  value: ProgrammaticClientModuleExport,
  local: string,
  toImportSpecifier: (file: string) => string,
): string {
  const source = JSON.stringify(toImportSpecifier(value.file));
  if (value.exportName === "default") return `import ${local} from ${source};`;
  const imported = IDENTIFIER_RE.test(value.exportName)
    ? value.exportName
    : JSON.stringify(value.exportName);
  return `import { ${imported} as ${local} } from ${source};`;
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** A module's file as a path, for a file path or a `file:` URL alike. */
function toModuleFile(file: string): string {
  if (file.startsWith("file://")) {
    try {
      return toPosixPath(fileURLToPath(file));
    } catch {
      return toPosixPath(file);
    }
  }
  return toPosixPath(file.split("?", 1)[0]!);
}
