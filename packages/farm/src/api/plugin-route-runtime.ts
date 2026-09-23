import { resolvePluginRoutes, type PluginRoutesFactory } from "./route";
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
  for (const definition of resolvePluginRoutes(plugins)) {
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
    if (signature(result) !== signature(expected)) {
      throw new Error(
        "Plugin API routes changed between build and runtime. Route paths and methods must be stable across environments; rebuild the app.",
      );
    }
  }
  return result;
}
