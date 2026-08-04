import type { FarmConfig, FarmRequest, FarmResponse } from "./types";
import type { ViteDevServer } from "vite";
import type { FarmClientPlugin } from "./client/plugin";
import { getResolvedEnv, type ResolvedFarmEnv } from "./env";
import {
  clearRequestContext,
  deleteRequestContext,
  getRequestContext,
  getRequestContextSnapshot,
  hasRequestContext,
  setRequestContext,
} from "./request-context";
import { getFarmPluginIntegrationContext } from "./plugin-integration-context";

type MaybePromise<T> = T | Promise<T>;

export interface FarmPluginIntegrationContext<TInstance = any> {
  /** Key used to register the integration in farm.config.ts. */
  readonly key: string;
  readonly category: string;
  readonly type: string;
  readonly instance: TInstance;
  readonly serverRuntime: boolean;
}

export class FarmRuntimeShutdownError extends Error {
  readonly errors: readonly unknown[];

  constructor(message: string, errors: readonly unknown[]) {
    super(message);
    this.name = "FarmRuntimeShutdownError";
    this.errors = errors;
  }
}

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

export interface FarmRequestStore {
  set(key: string, value: unknown, options?: { exposeToPage?: boolean }): void;
  get<T = unknown>(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  snapshot(options?: { exposedOnly?: boolean }): Map<string, unknown>;
}

export interface FarmPluginContext {
  config: FarmConfig;
  viteServer?: ViteDevServer;
  isDev: boolean;
  isProd: boolean;
  /** The owning integration when this plugin is contributed through `integration.plugins`. */
  readonly integration?: Readonly<FarmPluginIntegrationContext>;
  /** Register resource cleanup that must run when the application runtime closes. */
  lifecycle: FarmPluginLifecycle;
  /** @deprecated Use `ctx.req` inside request hooks. */
  requestContext: PluginRequestContext;
}

export interface FarmPluginLifecycle {
  /**
   * Register a database, storage, queue, or other resource disposer.
   * Disposers run once in reverse registration order after plugin shutdown hooks.
   */
  onShutdown(dispose: () => void | Promise<void>): () => void;
}

export interface FarmRequestPluginContext extends FarmPluginContext {
  /** Request-scoped values for the current hook invocation. */
  readonly req: FarmRequestStore;
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
  outputDir?: string;
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

export type FarmPluginRuntimeKind =
  | "request"
  | "page"
  | "api"
  | "action"
  | "integration"
  | "docs"
  | "asset"
  | (string & {});

export interface FarmPluginRouteRuntimePayload {
  pathname: string;
  pattern?: string | null;
  params?: Record<string, string>;
}

export interface FarmPluginSetupContext extends FarmPluginContext {
  env: ResolvedFarmEnv;
}

export interface FarmPluginStateContext<TState = unknown> extends FarmPluginContext {
  state: TState;
}

export interface FarmPluginRuntimeBaseEvent<
  TState = unknown,
> extends FarmPluginStateContext<TState> {
  request: Request;
  /** Request-scoped values shared by plugin hooks. */
  req: FarmRequestStore;
  kind: FarmPluginRuntimeKind;
  route?: FarmPluginRouteRuntimePayload;
  signal: AbortSignal;
  waitUntil(promise: Promise<unknown>): void;
}

export type FarmPluginRuntimeContextEvent<TState = unknown> = FarmPluginRuntimeBaseEvent<TState>;

export interface FarmPluginRuntimeBeforeEvent<
  TState = unknown,
  TRequestContext extends object = Record<string, unknown>,
> extends FarmPluginRuntimeBaseEvent<TState> {
  ctx: Readonly<TRequestContext>;
}

export interface FarmPluginRuntimeAfterEvent<
  TState = unknown,
  TRequestContext extends object = Record<string, unknown>,
> extends FarmPluginRuntimeBeforeEvent<TState, TRequestContext> {
  response: Response;
  durationMs: number;
}

export interface FarmPluginRuntimeErrorEvent<
  TState = unknown,
  TRequestContext extends object = Record<string, unknown>,
> extends FarmPluginRuntimeBeforeEvent<TState, TRequestContext> {
  error: unknown;
  durationMs: number;
}

export type FarmPluginRuntimeStartEvent<TState = unknown> = FarmPluginStateContext<TState>;

export interface FarmPluginRuntimeCloseEvent<TState = unknown>
  extends FarmPluginStateContext<TState>, ShutdownPayload {}

export interface FarmPluginRuntimeHooks<
  TState = unknown,
  TRequestContext extends object = Record<string, unknown>,
> {
  start?(event: FarmPluginRuntimeStartEvent<TState>): MaybePromise<void>;
  context?(event: FarmPluginRuntimeContextEvent<TState>): MaybePromise<TRequestContext>;
  before?(
    event: FarmPluginRuntimeBeforeEvent<TState, TRequestContext>,
  ): MaybePromise<Request | Response | void>;
  after?(
    event: FarmPluginRuntimeAfterEvent<TState, TRequestContext>,
  ): MaybePromise<Response | void>;
  error?(event: FarmPluginRuntimeErrorEvent<TState, TRequestContext>): MaybePromise<void>;
  close?(event: FarmPluginRuntimeCloseEvent<TState>): MaybePromise<void>;
}

export interface FarmPluginRuntimeRequestOptions {
  kind?: FarmPluginRuntimeKind;
  route?: FarmPluginRouteRuntimePayload;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type FarmPluginRuntimeRequestHandler = (request: Request) => MaybePromise<Response>;

export interface FarmPluginRuntimeSession {
  request: Request;
  response?: Response;
  ctx: Readonly<Record<string, unknown>>;
  startedAt: number;
  options: FarmPluginRuntimeRequestOptions;
  waitUntil(promise: Promise<unknown>): void;
}

export type FarmPluginDiscoveredRoute =
  | RouteDiscoveredPayload
  | ({ kind: "middleware" } & MiddlewareDiscoveredPayload)
  | ({ kind: "api" } & APIRouteDiscoveredPayload);

export interface FarmPluginRouterHooks<TState = unknown> {
  discovered?(
    route: FarmPluginDiscoveredRoute,
    context: FarmPluginStateContext<TState>,
  ): MaybePromise<void>;
  generated?(
    routes: RoutesGeneratedPayload,
    context: FarmPluginStateContext<TState>,
  ): MaybePromise<void>;
  before?(route: RouteMatchPayload, context: FarmPluginStateContext<TState>): MaybePromise<void>;
  after?(
    result: RouteMatchResultPayload,
    context: FarmPluginStateContext<TState>,
  ): MaybePromise<void>;
}

export interface FarmPluginRenderHooks<TState = unknown> {
  before?(
    render: RenderLifecyclePayload,
    context: FarmPluginStateContext<TState>,
  ): MaybePromise<void>;
  html?(
    html: string,
    render: RenderLifecyclePayload,
    context: FarmPluginStateContext<TState>,
  ): MaybePromise<string | void>;
}

export interface FarmPluginBuildHooks<TState = unknown> {
  before?(
    bundle: BundleLifecyclePayload,
    context: FarmPluginStateContext<TState>,
  ): MaybePromise<void>;
  configure?(buildConfig: any, context: FarmPluginStateContext<TState>): MaybePromise<any>;
  after?(result: BundleResultPayload, context: FarmPluginStateContext<TState>): MaybePromise<void>;
}

export interface FarmPluginDevHooks<TState = unknown> {
  server?(viteServer: ViteDevServer, context: FarmPluginStateContext<TState>): MaybePromise<void>;
  update?(update: HMRUpdatePayload, context: FarmPluginStateContext<TState>): MaybePromise<void>;
}

export interface FarmPluginClientConfig<
  TState = unknown,
  TPublic = undefined,
> extends FarmClientPlugin<TState, TPublic> {
  /** Explicitly public, JSON-safe data embedded in the browser bundle. */
  public?: TPublic;
}

export interface FarmPlugin<
  TState = any,
  TRequestContext extends object = Record<string, unknown>,
  TClientState = any,
  TClientPublic = any,
> {
  name: string;
  version?: string;
  enforce?: "pre" | "post";

  /** Transform Farm config before it is resolved. */
  configure?: (config: FarmConfig, context: FarmPluginContext) => MaybePromise<FarmConfig | void>;
  /** Initialize private plugin state once for this plugin manager. */
  setup?: (context: FarmPluginSetupContext) => MaybePromise<TState>;

  runtime?: FarmPluginRuntimeHooks<TState, TRequestContext>;
  router?: FarmPluginRouterHooks<TState>;
  render?: FarmPluginRenderHooks<TState>;
  build?: FarmPluginBuildHooks<TState>;
  dev?: FarmPluginDevHooks<TState>;
  /** Optional browser lifecycle for this logical plugin. */
  client?: FarmPluginClientConfig<TClientState, TClientPublic>;

  /** @deprecated Use `setup` instead. */
  init?: (context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `runtime.start` instead. */
  ready?: (context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `dev.server` instead. */
  devServerCreated?: (
    viteServer: ViteDevServer,
    context: FarmPluginContext,
  ) => void | Promise<void>;

  /** @deprecated Use `configure` instead. */
  config?: (config: FarmConfig, context: FarmPluginContext) => FarmConfig | Promise<FarmConfig>;
  configResolved?: (config: FarmConfig, context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `build.before` instead. */
  buildStart?: (context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `build.after` instead. */
  buildEnd?: (context: FarmPluginContext) => void | Promise<void>;

  /** @deprecated Use `router.discovered` instead. */
  routeDiscovered?: (
    route: RouteDiscoveredPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `router.generated` instead. */
  routesGenerated?: (
    routes: RoutesGeneratedPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `router.discovered` instead. */
  middlewareDiscovered?: (
    middleware: MiddlewareDiscoveredPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `router.discovered` instead. */
  apiRouteDiscovered?: (
    route: APIRouteDiscoveredPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `router.before` instead. */
  beforeRouteMatch?: (route: RouteMatchPayload, context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `router.after` instead. */
  afterRouteMatch?: (
    result: RouteMatchResultPayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `render.before` instead. */
  beforeRender?: (
    render: RenderLifecyclePayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `render.html` instead. */
  afterRender?: (
    html: string,
    render: RenderLifecyclePayload,
    context: FarmPluginContext,
  ) => string | Promise<string> | void | Promise<void>;
  /** @deprecated Use `runtime.before` instead. */
  beforeApiHandler?: (
    request: Request,
    api: APIHandlerLifecyclePayload,
    context: FarmRequestPluginContext,
  ) => Request | Promise<Request> | void | Promise<void>;
  /** @deprecated Use `runtime.after` instead. */
  afterApiHandler?: (
    response: Response,
    api: APIHandlerLifecyclePayload,
    context: FarmPluginContext,
  ) => Response | Promise<Response> | void | Promise<void>;
  onError?: (error: ErrorLifecyclePayload, context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `dev.update` instead. */
  hmrUpdate?: (update: HMRUpdatePayload, context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `build.before` instead. */
  beforeBundle?: (
    bundle: BundleLifecyclePayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `build.after` instead. */
  afterBundle?: (result: BundleResultPayload, context: FarmPluginContext) => void | Promise<void>;
  /** @deprecated Use `build.configure` instead. */
  beforeNitroBuild?: (nitroConfig: any, context: FarmPluginContext) => any | Promise<any>;
  afterNitroBuild?: (
    payload: NitroBuildLifecyclePayload,
    context: FarmPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use `runtime.close` instead. */
  shutdown?: (payload: ShutdownPayload, context: FarmPluginContext) => void | Promise<void>;

  /** @deprecated Use the Web Request based `runtime.before` hook instead. */
  beforeRequest?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmRequestPluginContext,
  ) => void | Promise<void>;
  /** @deprecated Use the Web Response based `runtime.after` hook instead. */
  afterResponse?: (
    req: FarmRequest,
    res: FarmResponse,
    context: FarmRequestPluginContext,
  ) => void | Promise<void>;

  // Transform hooks
  /** @deprecated Use `render.html` instead. */
  transformHTML?: (html: string, context: FarmPluginContext) => string | Promise<string>;
  /** @deprecated Use `render.before` or `render.html` instead. */
  transformPage?: (component: any, context: FarmPluginContext) => any | Promise<any>;
}

export class PluginManager {
  private plugins: FarmPlugin[] = [];
  private hookPresence = new Map<keyof FarmPlugin, boolean>();
  private runtimeHookPresence = new Map<"context" | "before" | "after" | "error", boolean>();
  private context: FarmPluginContext;
  private pluginStates = new Map<FarmPlugin, unknown>();
  private setupComplete = false;
  private initialized = false;
  private runtimeReady = false;
  private runtimeClosed = false;
  private runtimeStartPromise?: Promise<void>;
  private runtimeClosePromise?: Promise<void>;
  private runtimeShutdownHooksRunning = false;
  private runtimeDisposers: Array<() => void | Promise<void>> = [];
  private runtimeRequestContexts = new WeakMap<Request, Readonly<Record<string, unknown>>>();
  private failedRuntimeSessions = new WeakSet<FarmPluginRuntimeSession>();

  constructor(context: Omit<FarmPluginContext, "requestContext" | "lifecycle">) {
    this.context = {
      ...context,
      lifecycle: {
        onShutdown: (dispose) => {
          if (typeof dispose !== "function") {
            throw new TypeError("Farm lifecycle.onShutdown requires a cleanup function");
          }
          if (this.runtimeClosePromise || this.runtimeClosed) {
            throw new Error("Farm runtime cleanup cannot be registered after shutdown begins");
          }

          this.runtimeDisposers.push(dispose);
          let registered = true;
          return () => {
            if (!registered) return;
            registered = false;
            const index = this.runtimeDisposers.indexOf(dispose);
            if (index >= 0) this.runtimeDisposers.splice(index, 1);
          };
        },
      },
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

  private createPluginHookContext(
    plugin: FarmPlugin,
    context: FarmPluginContext = this.context,
  ): FarmPluginContext {
    const integration = getFarmPluginIntegrationContext(plugin);
    return integration ? { ...context, integration } : context;
  }

  private createRequestHookContext(
    target: FarmRequest | Request,
    plugin: FarmPlugin,
  ): FarmRequestPluginContext {
    const requestContext = this.context.requestContext;

    return {
      ...this.createPluginHookContext(plugin),
      req: {
        set(key, value, options) {
          requestContext.set(target, key, value, options);
        },
        get(key) {
          return requestContext.get(target, key);
        },
        has(key) {
          return requestContext.has(target, key);
        },
        delete(key) {
          return requestContext.delete(target, key);
        },
        clear() {
          requestContext.clear(target);
        },
        snapshot(options) {
          return requestContext.getAll(target, options);
        },
      },
    };
  }

  private copyRequestStore(source: FarmRequest | Request, target: FarmRequest | Request): void {
    const requestContext = this.context.requestContext;
    const values = requestContext.getAll(source);
    const exposed = requestContext.getAll(source, { exposedOnly: true });

    for (const [key, value] of values) {
      requestContext.set(target, key, value, {
        exposeToPage: exposed.has(key),
      });
    }
  }

  private copyRuntimeRequestContext(source: Request, target: Request): void {
    const runtimeContext = this.runtimeRequestContexts.get(source);
    if (runtimeContext) {
      this.runtimeRequestContexts.set(target, runtimeContext);
    }
  }

  private createRuntimeBaseEvent(
    plugin: FarmPlugin,
    request: Request,
    options: FarmPluginRuntimeRequestOptions,
    waitUntil: (promise: Promise<unknown>) => void,
  ): FarmPluginRuntimeBaseEvent {
    return {
      ...this.createStateHookContext(plugin),
      request,
      req: this.createRequestHookContext(request, plugin).req,
      kind: options.kind ?? "request",
      route: options.route,
      signal: request.signal,
      waitUntil,
    };
  }

  private async createRuntimeRequestContext(
    request: Request,
    options: FarmPluginRuntimeRequestOptions,
    waitUntil: (promise: Promise<unknown>) => void,
  ): Promise<Readonly<Record<string, unknown>>> {
    const values: Record<string, unknown> = {};
    const owners = new Map<string, string>();

    for (const plugin of this.getSortedPlugins()) {
      const createContext = plugin.runtime?.context;
      if (!createContext) continue;

      const result = await createContext(
        this.createRuntimeBaseEvent(plugin, request, options, waitUntil),
      );
      if (result === undefined) continue;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError(`Farm plugin "${plugin.name}" runtime.context must return an object`);
      }

      for (const [key, value] of Object.entries(result)) {
        const owner = owners.get(key);
        if (owner) {
          throw new Error(
            `Farm plugin context key "${key}" from "${plugin.name}" conflicts with "${owner}"`,
          );
        }
        owners.set(key, plugin.name);
        values[key] = value;
      }
    }

    const runtimeContext = Object.freeze(values);
    this.runtimeRequestContexts.set(request, runtimeContext);
    return runtimeContext;
  }

  private async runRuntimeErrorHooks(
    request: Request,
    error: unknown,
    ctx: Readonly<Record<string, unknown>>,
    durationMs: number,
    options: FarmPluginRuntimeRequestOptions,
    waitUntil: (promise: Promise<unknown>) => void,
  ): Promise<void> {
    for (const plugin of this.getSortedPlugins()) {
      const onError = plugin.runtime?.error;
      if (!onError) continue;

      try {
        await onError({
          ...this.createRuntimeBaseEvent(plugin, request, options, waitUntil),
          ctx,
          error,
          durationMs,
        });
      } catch (hookError) {
        console.error(`Farm plugin "${plugin.name}" runtime.error failed:`, hookError);
      }
    }

    try {
      await this.runHookParallel("onError", {
        phase: "runtime",
        error,
        meta: {
          kind: options.kind ?? "request",
          pathname: new URL(request.url).pathname,
          durationMs,
        },
      });
    } catch (hookError) {
      console.error("Farm plugin onError hook failed:", hookError);
    }
  }

  private createStateHookContext(
    plugin: FarmPlugin,
    context: FarmPluginContext = this.context,
  ): FarmPluginStateContext {
    return {
      ...this.createPluginHookContext(plugin, context),
      state: this.pluginStates.get(plugin),
    };
  }

  private getPluginHooks(
    plugin: FarmPlugin,
    hookName: keyof FarmPlugin,
  ): Array<(...args: any[]) => any> {
    const hooks: Array<(...args: any[]) => any> = [];
    const legacyHook = plugin[hookName];
    if (typeof legacyHook === "function") {
      hooks.push(legacyHook);
    }

    const withState = (context: FarmPluginContext) => this.createStateHookContext(plugin, context);

    switch (hookName) {
      case "config":
        if (plugin.configure) {
          hooks.push((config: FarmConfig, context: FarmPluginContext) =>
            plugin.configure?.(config, context),
          );
        }
        break;
      case "ready":
        if (plugin.runtime?.start) {
          hooks.push((context: FarmPluginContext) => plugin.runtime?.start?.(withState(context)));
        }
        break;
      case "shutdown":
        if (plugin.runtime?.close) {
          hooks.push((payload: ShutdownPayload, context: FarmPluginContext) =>
            plugin.runtime?.close?.({
              ...withState(context),
              reason: payload.reason,
            }),
          );
        }
        break;
      case "routeDiscovered":
        if (plugin.router?.discovered) {
          hooks.push((route: RouteDiscoveredPayload, context: FarmPluginContext) =>
            plugin.router?.discovered?.(route, withState(context)),
          );
        }
        break;
      case "middlewareDiscovered":
        if (plugin.router?.discovered) {
          hooks.push((route: MiddlewareDiscoveredPayload, context: FarmPluginContext) =>
            plugin.router?.discovered?.({ kind: "middleware", ...route }, withState(context)),
          );
        }
        break;
      case "apiRouteDiscovered":
        if (plugin.router?.discovered) {
          hooks.push((route: APIRouteDiscoveredPayload, context: FarmPluginContext) =>
            plugin.router?.discovered?.({ kind: "api", ...route }, withState(context)),
          );
        }
        break;
      case "routesGenerated":
        if (plugin.router?.generated) {
          hooks.push((routes: RoutesGeneratedPayload, context: FarmPluginContext) =>
            plugin.router?.generated?.(routes, withState(context)),
          );
        }
        break;
      case "beforeRouteMatch":
        if (plugin.router?.before) {
          hooks.push((route: RouteMatchPayload, context: FarmPluginContext) =>
            plugin.router?.before?.(route, withState(context)),
          );
        }
        break;
      case "afterRouteMatch":
        if (plugin.router?.after) {
          hooks.push((result: RouteMatchResultPayload, context: FarmPluginContext) =>
            plugin.router?.after?.(result, withState(context)),
          );
        }
        break;
      case "beforeRender":
        if (plugin.render?.before) {
          hooks.push((render: RenderLifecyclePayload, context: FarmPluginContext) =>
            plugin.render?.before?.(render, withState(context)),
          );
        }
        break;
      case "afterRender":
        if (plugin.render?.html) {
          hooks.push((html: string, render: RenderLifecyclePayload, context: FarmPluginContext) =>
            plugin.render?.html?.(html, render, withState(context)),
          );
        }
        break;
      case "beforeBundle":
        if (plugin.build?.before) {
          hooks.push((bundle: BundleLifecyclePayload, context: FarmPluginContext) =>
            plugin.build?.before?.(bundle, withState(context)),
          );
        }
        break;
      case "beforeNitroBuild":
        if (plugin.build?.configure) {
          hooks.push((buildConfig: any, context: FarmPluginContext) =>
            plugin.build?.configure?.(buildConfig, withState(context)),
          );
        }
        break;
      case "afterBundle":
        if (plugin.build?.after) {
          hooks.push((result: BundleResultPayload, context: FarmPluginContext) =>
            plugin.build?.after?.(result, withState(context)),
          );
        }
        break;
      case "devServerCreated":
        if (plugin.dev?.server) {
          hooks.push((server: ViteDevServer, context: FarmPluginContext) =>
            plugin.dev?.server?.(server, withState(context)),
          );
        }
        break;
      case "hmrUpdate":
        if (plugin.dev?.update) {
          hooks.push((update: HMRUpdatePayload, context: FarmPluginContext) =>
            plugin.dev?.update?.(update, withState(context)),
          );
        }
        break;
    }

    return hooks;
  }

  private getHookContext(
    plugin: FarmPlugin,
    hookName: keyof FarmPlugin,
    args: any[],
  ): FarmPluginContext {
    if (
      hookName === "beforeRequest" ||
      hookName === "afterResponse" ||
      hookName === "beforeApiHandler"
    ) {
      const target = args[0];
      if (target && typeof target === "object") {
        return this.createRequestHookContext(target, plugin);
      }
    }

    return this.createPluginHookContext(plugin);
  }

  addPlugin(plugin: FarmPlugin) {
    this.plugins.push(plugin);
    this.hookPresence.clear();
    this.runtimeHookPresence.clear();
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

  hasHook(hookName: keyof FarmPlugin): boolean {
    const cached = this.hookPresence.get(hookName);
    if (cached !== undefined) return cached;

    const present = this.plugins.some((plugin) => this.getPluginHooks(plugin, hookName).length > 0);
    this.hookPresence.set(hookName, present);
    return present;
  }

  hasRuntimeHook(hookName: "context" | "before" | "after" | "error"): boolean {
    const cached = this.runtimeHookPresence.get(hookName);
    if (cached !== undefined) return cached;

    const present = this.plugins.some((plugin) => typeof plugin.runtime?.[hookName] === "function");
    this.runtimeHookPresence.set(hookName, present);
    return present;
  }

  hasRuntimeRequestHooks(): boolean {
    return (
      this.hasRuntimeHook("context") ||
      this.hasRuntimeHook("before") ||
      this.hasRuntimeHook("after") ||
      this.hasRuntimeHook("error")
    );
  }

  copyRequestContext(source: FarmRequest | Request, target: FarmRequest | Request): void {
    this.copyRequestStore(source, target);
    if (source instanceof Request && target instanceof Request) {
      this.copyRuntimeRequestContext(source, target);
    }
  }

  async setupPlugins(): Promise<void> {
    if (this.setupComplete) return;

    for (const plugin of this.getSortedPlugins()) {
      if (!plugin.setup) continue;
      const state = await plugin.setup({
        ...this.createPluginHookContext(plugin),
        env: getResolvedEnv(),
      });
      this.pluginStates.set(plugin, state);
    }

    this.setupComplete = true;
  }

  async startRuntime(): Promise<void> {
    if (this.runtimeReady) return;
    if (this.runtimeStartPromise) return this.runtimeStartPromise;

    this.runtimeStartPromise = (async () => {
      if (!this.initialized) {
        await this.runHookParallel("init");
      }
      await this.setupPlugins();
      if (!this.runtimeReady) {
        await this.runHookParallel("ready");
      }
    })();

    try {
      await this.runtimeStartPromise;
    } catch (error) {
      this.runtimeStartPromise = undefined;
      throw error;
    }
  }

  async closeRuntime(reason = "runtime-closed"): Promise<void> {
    if (this.runtimeClosePromise) return this.runtimeClosePromise;
    if (this.runtimeClosed) return;

    this.runtimeClosePromise = (async () => {
      const errors: unknown[] = [];
      this.runtimeShutdownHooksRunning = true;
      try {
        await this.runHookParallel("shutdown", { reason });
      } catch (error) {
        if (error instanceof FarmRuntimeShutdownError) errors.push(...error.errors);
        else errors.push(error);
      } finally {
        this.runtimeShutdownHooksRunning = false;
      }

      const disposers = this.runtimeDisposers.splice(0).reverse();
      for (const dispose of disposers) {
        try {
          await dispose();
        } catch (error) {
          errors.push(error);
        }
      }

      this.runtimeClosed = true;
      if (errors.length > 0) {
        throw new FarmRuntimeShutdownError("Farm runtime shutdown failed", errors);
      }
    })();
    return this.runtimeClosePromise;
  }

  async beginRuntimeRequest(
    request: Request,
    options: FarmPluginRuntimeRequestOptions = {},
  ): Promise<FarmPluginRuntimeSession> {
    await this.startRuntime();

    const startedAt = Date.now();
    const waitUntil = options.waitUntil
      ? (promise: Promise<unknown>) => options.waitUntil?.(Promise.resolve(promise))
      : (promise: Promise<unknown>) => {
          void Promise.resolve(promise).catch(() => {});
        };
    let activeRequest = request;
    let runtimeContext: Readonly<Record<string, unknown>> = Object.freeze({});

    try {
      runtimeContext = await this.createRuntimeRequestContext(activeRequest, options, waitUntil);

      let response: Response | undefined;
      for (const plugin of this.getSortedPlugins()) {
        const before = plugin.runtime?.before;
        if (!before) continue;

        const result = await before({
          ...this.createRuntimeBaseEvent(plugin, activeRequest, options, waitUntil),
          ctx: runtimeContext,
        });

        if (result instanceof Request) {
          this.copyRequestStore(activeRequest, result);
          this.copyRuntimeRequestContext(activeRequest, result);
          activeRequest = result;
          continue;
        }
        if (result instanceof Response) {
          response = result;
          break;
        }
        if (result !== undefined) {
          throw new TypeError(
            `Farm plugin "${plugin.name}" runtime.before must return a Request, Response, or undefined`,
          );
        }
      }

      return {
        request: activeRequest,
        response,
        ctx: runtimeContext,
        startedAt,
        options,
        waitUntil,
      };
    } catch (error) {
      await this.runRuntimeErrorHooks(
        activeRequest,
        error,
        runtimeContext,
        Date.now() - startedAt,
        options,
        waitUntil,
      );
      throw error;
    }
  }

  async endRuntimeRequest(
    session: FarmPluginRuntimeSession,
    initialResponse: Response,
  ): Promise<Response> {
    let response = initialResponse;

    try {
      for (const plugin of this.getSortedPlugins()) {
        const after = plugin.runtime?.after;
        if (!after) continue;

        const result = await after({
          ...this.createRuntimeBaseEvent(
            plugin,
            session.request,
            session.options,
            session.waitUntil,
          ),
          ctx: session.ctx,
          response,
          durationMs: Date.now() - session.startedAt,
        });
        if (result !== undefined) {
          if (!(result instanceof Response)) {
            throw new TypeError(
              `Farm plugin "${plugin.name}" runtime.after must return a Response or undefined`,
            );
          }
          response = result;
        }
      }

      return response;
    } catch (error) {
      await this.failRuntimeRequest(session, error);
      throw error;
    }
  }

  async failRuntimeRequest(session: FarmPluginRuntimeSession, error: unknown): Promise<void> {
    if (this.failedRuntimeSessions.has(session)) return;
    this.failedRuntimeSessions.add(session);
    await this.runRuntimeErrorHooks(
      session.request,
      error,
      session.ctx,
      Date.now() - session.startedAt,
      session.options,
      session.waitUntil,
    );
  }

  async runRuntimeRequest(
    request: Request,
    handler: FarmPluginRuntimeRequestHandler,
    options: FarmPluginRuntimeRequestOptions = {},
  ): Promise<Response> {
    const session = await this.beginRuntimeRequest(request, options);
    try {
      const response = session.response ?? (await handler(session.request));
      if (!(response instanceof Response)) {
        throw new TypeError("Farm plugin runtime handlers must return a Response");
      }
      return await this.endRuntimeRequest(session, response);
    } catch (error) {
      await this.failRuntimeRequest(session, error);
      throw error;
    }
  }

  async runHook<K extends keyof FarmPlugin>(hookName: K, ...args: any[]): Promise<any> {
    const plugins = this.getSortedPlugins();

    for (const plugin of plugins) {
      for (const hook of this.getPluginHooks(plugin, hookName)) {
        const hookContext = this.getHookContext(plugin, hookName, args);
        const result = await (hook as any).apply(plugin, [...args, hookContext]);
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
      for (const hook of this.getPluginHooks(plugin, hookName)) {
        const hookArgs = [value, ...args];
        const hookContext = this.getHookContext(plugin, hookName, hookArgs);
        const result = await (hook as any).apply(plugin, [...hookArgs, hookContext]);
        if (result !== undefined) {
          if (
            hookName === "beforeApiHandler" &&
            result !== value &&
            value &&
            result &&
            typeof value === "object" &&
            typeof result === "object"
          ) {
            this.copyRequestStore(value as FarmRequest | Request, result as FarmRequest | Request);
          }
          value = result;
        }
      }
    }

    return value;
  }

  async runHookParallel<K extends keyof FarmPlugin>(hookName: K, ...args: any[]): Promise<boolean> {
    return this.runHookParallelFiltered(hookName, () => true, ...args);
  }

  /** @internal Runs hooks for only the plugins selected by the runtime adapter. */
  async runHookParallelFiltered<K extends keyof FarmPlugin>(
    hookName: K,
    include: (plugin: FarmPlugin) => boolean,
    ...args: any[]
  ): Promise<boolean> {
    if (hookName === "shutdown" && !this.runtimeShutdownHooksRunning) {
      await this.closeRuntime(args[0]?.reason);
      return false;
    }

    const plugins = this.getSortedPlugins().filter(include);

    // Run selected hooks sequentially for deterministic execution and short-circuiting.
    const sequentialHooks = new Set<keyof FarmPlugin>([
      "ready",
      "shutdown",
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
      const shutdownErrors: unknown[] = [];
      for (const plugin of plugins) {
        for (const hook of this.getPluginHooks(plugin, hookName)) {
          // Check if response is already sent (only for beforeRequest)
          if (hookName === "beforeRequest") {
            const res = args[1];
            if (res && res.writableEnded) {
              return true;
            }
          }

          const hookContext = this.getHookContext(plugin, hookName, args);
          try {
            await (hook as any).apply(plugin, [...args, hookContext]);
          } catch (error) {
            if (hookName !== "shutdown") throw error;
            shutdownErrors.push(error);
          }

          // Check again after plugin execution (only for beforeRequest)
          if (hookName === "beforeRequest") {
            const res = args[1];
            if (res && res.writableEnded) {
              return true;
            }
          }
        }
      }
      if (hookName === "shutdown" && shutdownErrors.length > 0) {
        throw new FarmRuntimeShutdownError("Farm plugin shutdown hooks failed", shutdownErrors);
      }
    } else {
      // Run other hooks in parallel
      const promises: Promise<any>[] = [];
      for (const plugin of plugins) {
        for (const hook of this.getPluginHooks(plugin, hookName)) {
          const hookContext = this.getHookContext(plugin, hookName, args);
          promises.push((hook as any).apply(plugin, [...args, hookContext]));
        }
      }
      await Promise.all(promises);
    }

    if (hookName === "init") this.initialized = true;
    if (hookName === "ready") this.runtimeReady = true;

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

export function definePlugin<
  TState = undefined,
  TRequestContext extends object = Record<string, never>,
  TClientState = unknown,
  TClientPublic = undefined,
>(
  plugin: FarmPlugin<TState, TRequestContext, TClientState, TClientPublic>,
): FarmPlugin<TState, TRequestContext, TClientState, TClientPublic> {
  return plugin;
}
export { farmPlugin } from "./vite";
