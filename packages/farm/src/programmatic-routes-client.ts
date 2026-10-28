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
 */

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

  for (const module of modules.values()) {
    for (const [exportName, value] of module.exports) {
      if (isRouteValue(value)) module.routeSource = true;
      if (!isReferenceValue(value)) continue;
      const owners = exportsByValue.get(value) ?? [];
      owners.push({ module, exportName });
      exportsByValue.set(value, owners);
    }
    if (module.routeSource && module.file) routeSourceFiles.add(module.file);
  }

  const reaches = createReachability(modules);
  const locate = (value: unknown, label: string): ProgrammaticClientModuleExport | string => {
    if (!isReferenceValue(value)) return `its ${label} is not a component`;
    const owners = exportsByValue.get(value) ?? [];
    const eligible = owners.filter(
      ({ module }) => module.file && !module.external && !module.routeSource,
    );
    if (eligible.length === 0) {
      const routeModule = owners.find(({ module }) => module.routeSource && module.file);
      if (routeModule) {
        return `its ${label} is exported by ${routeModule.module.file}, which defines routes`;
      }
      if (owners.some(({ module }) => module.external)) {
        return `its ${label} comes from a package; re-export it from a module in your app`;
      }
      return `its ${label} is not exported by any module the routes file imports`;
    }
    // The defining module, not a barrel that re-exports it: the one that reaches no other.
    const defining = eligible.filter(
      (candidate) =>
        !eligible.some(
          (other) => other.module !== candidate.module && reaches(candidate.module, other.module),
        ),
    );
    const chosen = (defining.length > 0 ? defining : eligible).sort(compareOwners)[0]!;
    return { file: chosen.module.file!, exportName: chosen.exportName };
  };

  const routes = new Map<string, ProgrammaticClientRoute>();
  for (const value of options.routes) {
    if (!isProgrammaticRouteDefinition(value)) continue;
    const route = value as RouteLike;
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
    const component = locate(route.component, "component");
    if (typeof component === "string") problems.push(component);
    else clientRoute.component = component;

    if (route.kind === "page") {
      if (route.pending) {
        const pending = locate(route.pending, "pending component");
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
  const toGraphModule = (node: EvaluatedModuleLike) => ({
    id: node.id,
    file: node.file || undefined,
    imports: node.imports,
    exports: node.exports,
    external: Boolean(node.meta && "externalize" in node.meta),
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

/** RSC replaces a routes module a client component imports with an action-only proxy. */
export function isProgrammaticRouteActionProxy(code: string | null | undefined): boolean {
  return Boolean(code?.includes("__farmRouteActionTarget: true"));
}

type GraphEntry = {
  id: string;
  file?: string;
  external: boolean;
  imports: string[];
  exports: Array<[string, unknown]>;
  routeSource: boolean;
  order: number;
};

function collectGraph(graph: ProgrammaticRouteGraph, routesFile: string): Map<string, GraphEntry> {
  const modules = new Map<string, GraphEntry>();
  const queue = [...graph.getModulesByFile(routesFile)];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (modules.has(node.id)) continue;
    const entry: GraphEntry = {
      id: node.id,
      file: node.file ? toPosixPath(node.file) : undefined,
      external: node.external === true,
      imports: [...node.imports],
      exports: readExports(node.exports),
      routeSource: node.file ? toPosixPath(node.file) === routesFile : false,
      order: modules.size,
    };
    modules.set(node.id, entry);
    if (entry.external) continue;
    for (const id of entry.imports) {
      const imported = graph.getModuleById(id);
      if (imported && !modules.has(imported.id)) queue.push(imported);
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

function isRouteValue(value: unknown): boolean {
  if (isProgrammaticRouteDefinition(value)) return true;
  if ((value as { __farmRoutes?: unknown } | null)?.__farmRoutes === true) return true;
  return Array.isArray(value) && value.some((item) => isProgrammaticRouteDefinition(item));
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
