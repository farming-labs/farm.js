import {
  resolvePluginRoutes,
  type PluginLocalAPI,
  type PluginLocalAPIEndpoint,
  type PluginRoutesFactory,
  type RouteMethod,
} from "./route";
import { invokeAPIRouteEndpoint } from "./runtime";
import { registerAPIRouteShape } from "./route-shape";

interface MountedRoute {
  path: string;
  methods: string[];
  endpoints: Record<string, any>;
  filePath?: string;
  pluginMethods?: string[];
}

/** The same registration step is used by dev discovery and the production bundle. */
export function mergePluginAPIRoutes(
  existing: readonly MountedRoute[],
  plugins: readonly { name: string; routes?: PluginRoutesFactory }[],
  expected?: readonly { path: string; methods: readonly string[] }[],
  options: { bodySizeLimit?: number } = {},
): Array<MountedRoute & { filePath: string }> {
  const routes = new Map<string, MountedRoute & { filePath: string }>();
  const shapes = new Map();
  for (const route of existing) {
    registerAPIRouteShape(shapes, route.path, route.filePath || route.path, "app");
    routes.set(route.path, {
      ...route,
      filePath: route.filePath || "",
      methods: [...route.methods],
      endpoints: { ...route.endpoints },
    });
  }
  const api = createPluginLocalAPI(existing, options.bodySizeLimit);
  for (const definition of resolvePluginRoutes(plugins, { api })) {
    registerAPIRouteShape(shapes, definition.path, `plugin:${definition.path}`, "app");
    let route = routes.get(definition.path);
    if (route?.methods.includes(definition.method)) {
      throw new Error(
        `Duplicate API route for ${definition.method} ${definition.path}. Plugin routes cannot override app or other plugin endpoints.`,
      );
    }
    if (!route) {
      route = { path: definition.path, filePath: "", methods: [], endpoints: {} };
      routes.set(definition.path, route);
    }
    route.methods.push(definition.method);
    route.pluginMethods = [...(route.pluginMethods ?? []), definition.method];
    route.endpoints[definition.method] = definition.endpoint;
  }
  const result = [...routes.values()];
  if (expected) {
    const signature = (entries: readonly { path: string; methods: readonly string[] }[]) =>
      entries
        .map(({ path, methods }) => `${path}:${[...methods].sort().join(",")}`)
        .sort()
        .join("\n");
    const actualSignature = signature(result);
    const expectedSignature = signature(expected);
    if (actualSignature !== expectedSignature) {
      throw new Error(
        "Plugin API routes changed between build and runtime. Route paths and methods must be stable across environments; rebuild the app.\n" +
          `Expected:\n${expectedSignature || "(none)"}\nReceived:\n${actualSignature || "(none)"}`,
      );
    }
  }
  return result;
}

function createPluginLocalAPI(
  routes: readonly MountedRoute[],
  bodySizeLimit?: number,
): PluginLocalAPI {
  const endpoints = new Map<string, PluginLocalAPIEndpoint>();
  for (const route of routes) {
    for (const method of route.methods) {
      const normalizedMethod = method.toUpperCase() as RouteMethod;
      const endpoint = route.endpoints[normalizedMethod];
      if (typeof endpoint !== "function") continue;
      const descriptor: PluginLocalAPIEndpoint = Object.freeze({
        path: route.path,
        method: normalizedMethod,
        input: Object.freeze({
          body: endpoint.__types?.body,
          query: endpoint.__types?.query,
          params: endpoint.__types?.params,
          headers: endpoint.__types?.headers,
        }),
        output: endpoint.__output,
        mcp:
          endpoint.__mcp === true
            ? true
            : endpoint.__mcp
              ? Object.freeze({ ...endpoint.__mcp })
              : undefined,
        invoke(request: Request, params: Readonly<Record<string, string | string[]>> = {}) {
          return invokeAPIRouteEndpoint(endpoint, request, { ...params }, bodySizeLimit);
        },
      });
      endpoints.set(`${normalizedMethod} ${route.path}`, descriptor);
    }
  }
  const listedEndpoints = Object.freeze(Array.from(endpoints.values()));

  return Object.freeze({
    available: true,
    get(method: RouteMethod, path: string) {
      return endpoints.get(`${method.toUpperCase()} ${path}`);
    },
    list() {
      return listedEndpoints;
    },
  });
}
