import type { FarmConfig, FarmRequest, FarmResponse } from "./types";
import type { ViteDevServer } from "vite";
import {
  clearRequestContext,
  deleteRequestContext,
  getRequestContext,
  getRequestContextSnapshot,
  hasRequestContext,
  setRequestContext,
} from "./request-context";

export interface PluginRequestContext {
  set: (
    target: FarmRequest | Request,
    key: string,
    value: any,
    options?: { exposeToPage?: boolean },
  ) => void;
  get: <T = any>(target: FarmRequest | Request, key: string) => T | undefined;
  has: (target: FarmRequest | Request, key: string) => boolean;
  delete: (target: FarmRequest | Request, key: string) => boolean;
  clear: (target: FarmRequest | Request) => void;
  getAll: (target: FarmRequest | Request, options?: { exposedOnly?: boolean }) => Map<string, any>;
}

export interface FarmPluginContext {
  config: FarmConfig;
  viteServer?: ViteDevServer;
  isDev: boolean;
  isProd: boolean;
  requestContext: PluginRequestContext;
}

export interface RouteDiscoveredPayload {
  kind: "page" | "layout";
  pattern: string;
  modulePath: string;
}

export interface RoutesGeneratedPayload {
  routes: RouteDiscoveredPayload[];
  pageCount: number;
  layoutCount: number;
}

export interface MiddlewareDiscoveredPayload {
  path: string;
  filePath: string;
  handlerCount: number;
}

export interface APIRouteDiscoveredPayload {
  path: string;
  filePath: string;
  methods: string[];
}

export interface RouteMatchPayload {
  pathname: string;
  method?: string;
}

export interface RouteMatchResultPayload {
  pathname: string;
  matched: boolean;
  routePattern: string | null;
  params: Record<string, string>;
  layoutPatterns: string[];
}

export interface RenderLifecyclePayload {
  pathname: string;
  method: string;
  routePattern: string | null;
  params: Record<string, string>;
}

export interface APIHandlerLifecyclePayload {
  pathname: string;
  method: string;
  routePath?: string;
}

export interface ErrorLifecyclePayload {
  phase: string;
  error: unknown;
  meta?: Record<string, unknown>;
}

export interface HMRUpdatePayload {
  file: string;
  modules: string[];
}

export interface BundleLifecyclePayload {
  root: string;
  preset: string;
  universal: boolean;
  distDir: string;
}

export interface BundleResultPayload extends BundleLifecyclePayload {
  success: boolean;
}

export interface NitroBuildLifecyclePayload {
  root: string;
  preset: string;
  distDir: string;
  outputDir: string;
}

export interface ShutdownPayload {
  reason: string;
}

export interface FarmPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";

  init?: (context: FarmPluginContext) => void | Promise<void>;
  ready?: (context: FarmPluginContext) => void | Promise<void>;
  devServerCreated?: (
    viteServer: ViteDevServer,
    context: FarmPluginContext,
  ) => void | Promise<void>;

  config?: (config: FarmConfig, context: FarmPluginContext) => FarmConfig | Promise<FarmConfig>;
  configResolved?: (config: FarmConfig, context: FarmPluginContext) => void | Promise<void>;
  buildStart?: (context: FarmPluginContext) => void | Promise<void>;
  buildEnd?: (context: FarmPluginContext) => void | Promise<void>;

  routeDiscovered?: (
    route: RouteDiscoveredPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  routesGenerated?: (
    routes: RoutesGeneratedPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  middlewareDiscovered?: (
    middleware: MiddlewareDiscoveredPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  apiRouteDiscovered?: (
    route: APIRouteDiscoveredPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  beforeRouteMatch?: (route: RouteMatchPayload, context: FarmPluginContext) => void | Promise<void>;
  afterRouteMatch?: (
    result: RouteMatchResultPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  beforeRender?: (
    render: RenderLifecyclePayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  afterRender?: (
    html: string,
    render: RenderLifecyclePayload,
    context: FarmPluginContext,
  ) => string | Promise<string> | void | Promise<void>;
  beforeApiHandler?: (
    request: Request,
    api: APIHandlerLifecyclePayload,
    context: FarmPluginContext,
  ) => Request | Promise<Request> | void | Promise<void>;
  afterApiHandler?: (
    response: Response,
    api: APIHandlerLifecyclePayload,
    context: FarmPluginContext,
  ) => Response | Promise<Response> | void | Promise<void>;
  onError?: (error: ErrorLifecyclePayload, context: FarmPluginContext) => void | Promise<void>;
  hmrUpdate?: (update: HMRUpdatePayload, context: FarmPluginContext) => void | Promise<void>;
  beforeBundle?: (
    bundle: BundleLifecyclePayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  afterBundle?: (result: BundleResultPayload, context: FarmPluginContext) => void | Promise<void>;
  beforeNitroBuild?: (nitroConfig: any, context: FarmPluginContext) => any | Promise<any>;
  afterNitroBuild?: (
    payload: NitroBuildLifecyclePayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  shutdown?: (payload: ShutdownPayload, context: FarmPluginContext) => void | Promise<void>;

  beforeRequest?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  afterResponse?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmPluginContext,
  ) => void | Promise<void>;

  // Transform hooks
  transformHTML?: (html: string, context: FarmPluginContext) => string | Promise<string>;
  transformPage?: (component: any, context: FarmPluginContext) => any | Promise<any>;
}

export class PluginManager {
  private plugins: FarmPlugin[] = [];
  private context: FarmPluginContext;

  constructor(context: Omit<FarmPluginContext, "requestContext">) {
    this.context = {
      ...context,
      requestContext: {
        set(target, key, value, options) {
          setRequestContext(target as object, key, value, options);
        },
        get(target, key) {
          return getRequestContext(target as object, key);
        },
        has(target, key) {
          return hasRequestContext(target as object, key);
        },
        delete(target, key) {
          return deleteRequestContext(target as object, key);
        },
        clear(target) {
          clearRequestContext(target as object);
        },
        getAll(target, options) {
          return getRequestContextSnapshot(target as object, options);
        },
      },
    };
  }

  addPlugin(plugin: FarmPlugin) {
    this.plugins.push(plugin);
  }

  addPlugins(plugins: FarmPlugin[]) {
    for (const plugin of plugins) {
      this.addPlugin(plugin);
    }
  }

  getPlugins(): FarmPlugin[] {
    return [...this.plugins];
  }

  getSortedPlugins(): FarmPlugin[] {
    const pre = this.plugins.filter((p) => p.enforce === "pre");
    const normal = this.plugins.filter((p) => !p.enforce);
    const post = this.plugins.filter((p) => p.enforce === "post");
    return [...pre, ...normal, ...post];
  }

  async runHook<K extends keyof FarmPlugin>(hookName: K, ...args: any[]): Promise<any> {
    const plugins = this.getSortedPlugins();

    for (const plugin of plugins) {
      const hook = plugin[hookName];
      if (typeof hook === "function") {
        const result = await (hook as any).apply(plugin, [...args, this.context]);
        if (result !== undefined) {
          return result;
        }
      }
    }
  }

  async runHookSerial<K extends keyof FarmPlugin>(
    hookName: K,
    initialValue: any,
    ...args: any[]
  ): Promise<any> {
    const plugins = this.getSortedPlugins();
    let value = initialValue;

    for (const plugin of plugins) {
      const hook = plugin[hookName];
      if (typeof hook === "function") {
        const result = await (hook as any).apply(plugin, [value, ...args, this.context]);
        if (result !== undefined) {
          value = result;
        }
      }
    }

    return value;
  }

  async runHookParallel<K extends keyof FarmPlugin>(hookName: K, ...args: any[]): Promise<boolean> {
    const plugins = this.getSortedPlugins();

    // Run selected hooks sequentially for deterministic execution and short-circuiting.
    const sequentialHooks = new Set<keyof FarmPlugin>([
      "beforeRequest",
      "afterResponse",
      "beforeApiHandler",
      "afterApiHandler",
      "beforeRouteMatch",
      "afterRouteMatch",
      "beforeRender",
      "afterRender",
    ]);

    if (sequentialHooks.has(hookName)) {
      for (const plugin of plugins) {
        const hook = plugin[hookName];
        if (typeof hook === "function") {
          // Check if response is already sent (only for beforeRequest)
          if (hookName === "beforeRequest") {
            const res = args[1];
            if (res && res.writableEnded) {
              return true;
            }
          }

          await (hook as any).apply(plugin, [...args, this.context]);

          // Check again after plugin execution (only for beforeRequest)
          if (hookName === "beforeRequest") {
            const res = args[1];
            if (res && res.writableEnded) {
              return true;
            }
          }
        }
      }
    } else {
      // Run other hooks in parallel
      const promises: Promise<any>[] = [];
      for (const plugin of plugins) {
        const hook = plugin[hookName];
        if (typeof hook === "function") {
          promises.push((hook as any).apply(plugin, [...args, this.context]));
        }
      }
      await Promise.all(promises);
    }

    return false;
  }

  updateContext(updates: Partial<FarmPluginContext>) {
    this.context = {
      ...this.context,
      ...updates,
      requestContext: this.context.requestContext,
    };
  }
}

export function definePlugin(plugin: FarmPlugin): FarmPlugin {
  return plugin;
}
export { farmPlugin } from "./vite";
