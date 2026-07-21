"use client";

type MaybePromise<T> = T | Promise<T>;

export type FarmClientPluginEnforce = "pre" | "post";
export type FarmClientNavigationAction = "push" | "replace" | "pop";
export type FarmClientHydrationMode = "hydrate" | "render";

export interface FarmClientLocation {
  href: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface FarmClientPluginRouter {
  navigate(href: string, options?: Record<string, unknown>): MaybePromise<void>;
  prefetch?(href: string): MaybePromise<void>;
  getNavigationState?(): unknown;
}

export interface FarmClientPluginMetadata {
  name: string;
  version?: string;
}

export interface FarmClientPluginSetupEvent<TOptions = unknown> {
  plugin: FarmClientPluginMetadata;
  options: Readonly<TOptions>;
  router: FarmClientPluginRouter;
  isDev: boolean;
  isProd: boolean;
  deploymentId?: string;
}

export interface FarmClientPluginStateEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientPluginSetupEvent<TOptions> {
  state: TState;
}

export interface FarmClientHydrationSession {
  container: Element;
  location: FarmClientLocation;
  mode: FarmClientHydrationMode;
  startedAt: number;
}

export interface FarmClientHydrationEvent<TState = unknown, TOptions = unknown>
  extends FarmClientPluginStateEvent<TState, TOptions>, FarmClientHydrationSession {}

export interface FarmClientHydrationCompleteEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientHydrationEvent<TState, TOptions> {
  durationMs: number;
  recovered: boolean;
}

export interface FarmClientNavigationSession {
  id: string;
  from: FarmClientLocation | null;
  to: FarmClientLocation;
  action: FarmClientNavigationAction;
  signal: AbortSignal;
  startedAt: number;
  route?: {
    pattern?: string | null;
    params?: Record<string, string>;
  };
}

export interface FarmClientNavigationEvent<TState = unknown, TOptions = unknown>
  extends FarmClientPluginStateEvent<TState, TOptions>, FarmClientNavigationSession {}

export interface FarmClientNavigationLoadedEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientNavigationEvent<TState, TOptions> {
  durationMs: number;
  data?: unknown;
}

export interface FarmClientNavigationResolvedEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientNavigationEvent<TState, TOptions> {
  durationMs: number;
}

export interface FarmClientNavigationErrorEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientNavigationResolvedEvent<TState, TOptions> {
  error: unknown;
}

export type FarmClientPluginErrorPhase =
  | "setup"
  | "hydration"
  | "navigation"
  | "window"
  | "unhandled-rejection"
  | "performance"
  | `plugin:${string}`
  | (string & {});

export interface FarmClientPluginErrorEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientPluginStateEvent<TState, TOptions> {
  error: unknown;
  phase: FarmClientPluginErrorPhase;
  location: FarmClientLocation;
  navigation?: FarmClientNavigationSession;
}

export interface FarmClientPerformanceEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientPluginStateEvent<TState, TOptions> {
  entry: PerformanceEntry;
  location: FarmClientLocation;
}

export interface FarmClientPluginCloseEvent<
  TState = unknown,
  TOptions = unknown,
> extends FarmClientPluginStateEvent<TState, TOptions> {
  reason: "pagehide" | "hmr" | "manual" | (string & {});
}

export interface FarmClientPlugin<TState = unknown, TOptions = unknown> {
  setup?(event: FarmClientPluginSetupEvent<TOptions>): MaybePromise<TState>;
  hydration?: {
    before?(event: FarmClientHydrationEvent<TState, TOptions>): MaybePromise<void>;
    after?(event: FarmClientHydrationCompleteEvent<TState, TOptions>): MaybePromise<void>;
  };
  navigation?: {
    before?(event: FarmClientNavigationEvent<TState, TOptions>): MaybePromise<void>;
    loaded?(event: FarmClientNavigationLoadedEvent<TState, TOptions>): MaybePromise<void>;
    resolved?(event: FarmClientNavigationResolvedEvent<TState, TOptions>): MaybePromise<void>;
    rendered?(event: FarmClientNavigationResolvedEvent<TState, TOptions>): MaybePromise<void>;
    error?(event: FarmClientNavigationErrorEvent<TState, TOptions>): MaybePromise<void>;
  };
  error?(event: FarmClientPluginErrorEvent<TState, TOptions>): MaybePromise<void>;
  performance?(event: FarmClientPerformanceEvent<TState, TOptions>): MaybePromise<void>;
  close?(event: FarmClientPluginCloseEvent<TState, TOptions>): MaybePromise<void>;
}

export type FarmClientPluginFactory<TOptions = unknown> = (
  options: Readonly<TOptions>,
) => MaybePromise<FarmClientPlugin<any, TOptions>>;

export type FarmClientPluginDefinition<TOptions = unknown> =
  | FarmClientPlugin<any, TOptions>
  | FarmClientPluginFactory<TOptions>;

export interface FarmClientPluginRegistration<TOptions = unknown> {
  name: string;
  version?: string;
  enforce?: FarmClientPluginEnforce;
  definition: FarmClientPluginDefinition<TOptions>;
  options?: TOptions;
}

export interface FarmClientPluginManagerOptions {
  router: FarmClientPluginRouter;
  isDev?: boolean;
  isProd?: boolean;
  deploymentId?: string;
  window?: Window;
}

interface FarmClientPluginInstance {
  registration: FarmClientPluginRegistration<any>;
  plugin: FarmClientPlugin<any, any>;
  state: unknown;
}

const PERFORMANCE_ENTRY_TYPES = [
  "navigation",
  "paint",
  "largest-contentful-paint",
  "layout-shift",
  "event",
];

export class FarmClientPluginManager {
  private readonly registrations: FarmClientPluginRegistration[];
  private readonly options: FarmClientPluginManagerOptions;
  private readonly instances: FarmClientPluginInstance[] = [];
  private readonly performanceObservers: PerformanceObserver[] = [];
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private currentNavigation?: {
    controller: AbortController;
    session: FarmClientNavigationSession;
  };
  private navigationSequence = 0;
  private starting = false;
  private started = false;
  private closed = false;
  private readonly reportedErrors = new WeakSet<object>();

  private readonly handleWindowError = (event: ErrorEvent) => {
    const error = event.error ?? new Error(event.message || "Unknown browser error");
    void this.reportError(error, "window");
  };

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    void this.reportError(event.reason, "unhandled-rejection");
  };

  private readonly handlePageHide = () => {
    void this.close("pagehide");
  };

  constructor(
    registrations: readonly FarmClientPluginRegistration[],
    options: FarmClientPluginManagerOptions,
  ) {
    this.registrations = sortRegistrations(registrations);
    this.options = {
      ...options,
      isDev: options.isDev ?? false,
      isProd: options.isProd ?? !options.isDev,
      window: options.window ?? (typeof window !== "undefined" ? window : undefined),
    };
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = Promise.resolve().then(() => this.startInternal());
    return this.startPromise;
  }

  async beginHydration(input: {
    container: Element;
    mode: FarmClientHydrationMode;
  }): Promise<FarmClientHydrationSession> {
    await this.start();
    const session: FarmClientHydrationSession = {
      ...input,
      location: this.getLocation(),
      startedAt: now(),
    };

    await this.runHook("hydration.before", (instance) =>
      instance.plugin.hydration?.before?.({
        ...this.createStateEvent(instance),
        ...session,
      }),
    );

    return session;
  }

  async completeHydration(
    session: FarmClientHydrationSession,
    options: { recovered?: boolean } = {},
  ): Promise<void> {
    await this.runHook("hydration.after", (instance) =>
      instance.plugin.hydration?.after?.({
        ...this.createStateEvent(instance),
        ...session,
        durationMs: now() - session.startedAt,
        recovered: options.recovered ?? false,
      }),
    );
  }

  async failHydration(session: FarmClientHydrationSession, error: unknown): Promise<void> {
    await this.reportError(error, "hydration", undefined, session.location);
  }

  async beginNavigation(input: {
    from?: string | URL | FarmClientLocation | null;
    to: string | URL | FarmClientLocation;
    action: FarmClientNavigationAction;
    route?: FarmClientNavigationSession["route"];
  }): Promise<FarmClientNavigationSession> {
    await this.start();
    this.currentNavigation?.controller.abort("superseded");

    const controller = new AbortController();
    const session: FarmClientNavigationSession = {
      id: `navigation:${++this.navigationSequence}`,
      from:
        input.from === null
          ? null
          : toClientLocation(input.from ?? this.getLocation().href, this.getBaseUrl()),
      to: toClientLocation(input.to, this.getBaseUrl()),
      action: input.action,
      signal: controller.signal,
      startedAt: now(),
      route: input.route,
    };

    this.currentNavigation = { controller, session };
    await this.runHook("navigation.before", (instance) =>
      instance.plugin.navigation?.before?.({
        ...this.createStateEvent(instance),
        ...session,
      }),
    );

    return session;
  }

  async markNavigationLoaded(session: FarmClientNavigationSession, data?: unknown): Promise<void> {
    if (session.signal.aborted) return;
    await this.runHook("navigation.loaded", (instance) =>
      instance.plugin.navigation?.loaded?.({
        ...this.createStateEvent(instance),
        ...session,
        data,
        durationMs: now() - session.startedAt,
      }),
    );
  }

  async resolveNavigation(session: FarmClientNavigationSession): Promise<void> {
    if (session.signal.aborted) return;
    await this.runHook("navigation.resolved", (instance) =>
      instance.plugin.navigation?.resolved?.({
        ...this.createStateEvent(instance),
        ...session,
        durationMs: now() - session.startedAt,
      }),
    );
  }

  scheduleNavigationRendered(session: FarmClientNavigationSession): Promise<void> {
    if (session.signal.aborted) return Promise.resolve();
    const clientWindow = this.options.window;
    const schedule = clientWindow?.requestAnimationFrame
      ? (callback: () => void) =>
          clientWindow.requestAnimationFrame(() => clientWindow.requestAnimationFrame(callback))
      : (callback: () => void) => setTimeout(callback, 0);

    return new Promise((resolve) => {
      schedule(() => {
        if (session.signal.aborted || this.closed) {
          resolve();
          return;
        }
        void this.runHook("navigation.rendered", (instance) =>
          instance.plugin.navigation?.rendered?.({
            ...this.createStateEvent(instance),
            ...session,
            durationMs: now() - session.startedAt,
          }),
        ).finally(() => {
          if (this.currentNavigation?.session === session) {
            this.currentNavigation = undefined;
          }
          resolve();
        });
      });
    });
  }

  async failNavigation(session: FarmClientNavigationSession, error: unknown): Promise<void> {
    if (!session.signal.aborted) {
      await this.runHook("navigation.error", (instance) =>
        instance.plugin.navigation?.error?.({
          ...this.createStateEvent(instance),
          ...session,
          durationMs: now() - session.startedAt,
          error,
        }),
      );
      await this.reportError(error, "navigation", session, session.to);
    }

    if (this.currentNavigation?.session === session) {
      this.currentNavigation = undefined;
    }
  }

  async reportError(
    error: unknown,
    phase: FarmClientPluginErrorPhase,
    navigation?: FarmClientNavigationSession,
    location = this.getLocation(),
  ): Promise<void> {
    if (this.closed) return;
    if (isObject(error)) {
      if (this.reportedErrors.has(error)) return;
      this.reportedErrors.add(error);
    }

    if (!this.started && !this.starting) await this.start();
    await this.runErrorHooks({ error, phase, navigation, location });
  }

  close(reason: FarmClientPluginCloseEvent["reason"] = "manual"): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInternal(reason);
    return this.closePromise;
  }

  getPlugins(): readonly FarmClientPluginMetadata[] {
    return this.instances.map(({ registration }) => ({
      name: registration.name,
      version: registration.version,
    }));
  }

  private async startInternal(): Promise<void> {
    if (this.started || this.closed) return;
    this.starting = true;

    try {
      for (const registration of this.registrations) {
        try {
          const definition =
            typeof registration.definition === "function"
              ? await registration.definition(readonlyOptions(registration.options))
              : registration.definition;
          if (!definition || typeof definition !== "object") {
            throw new TypeError(
              `Client plugin "${registration.name}" did not return a plugin object`,
            );
          }

          const instance: FarmClientPluginInstance = {
            registration,
            plugin: definition,
            state: undefined,
          };
          instance.state = await definition.setup?.(this.createSetupEvent(instance));
          this.instances.push(instance);
        } catch (error) {
          this.logHookError(registration.name, "setup", error);
          await this.runErrorHooks({
            error,
            phase: "setup",
            location: this.getLocation(),
          });
        }
      }

      this.started = true;
      this.installBrowserListeners();
      this.installPerformanceObservers();
    } finally {
      this.starting = false;
    }
  }

  private installBrowserListeners(): void {
    const clientWindow = this.options.window;
    if (!clientWindow) return;

    if (this.instances.some(({ plugin }) => plugin.error)) {
      clientWindow.addEventListener("error", this.handleWindowError);
      clientWindow.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    }
    clientWindow.addEventListener("pagehide", this.handlePageHide, {
      once: true,
    });
  }

  private installPerformanceObservers(): void {
    if (!this.instances.some(({ plugin }) => plugin.performance)) return;
    const Observer = typeof PerformanceObserver !== "undefined" ? PerformanceObserver : undefined;
    if (!Observer) return;

    const supported = new Set(Observer.supportedEntryTypes || []);
    for (const type of PERFORMANCE_ENTRY_TYPES) {
      if (!supported.has(type)) continue;
      try {
        const observer = new Observer((list: PerformanceObserverEntryList) => {
          for (const entry of list.getEntries()) {
            void this.runHook("performance", (instance) =>
              instance.plugin.performance?.({
                ...this.createStateEvent(instance),
                entry,
                location: this.getLocation(),
              }),
            );
          }
        });
        observer.observe({ type, buffered: true });
        this.performanceObservers.push(observer);
      } catch (error) {
        void this.reportError(error, "performance");
      }
    }
  }

  private async closeInternal(reason: FarmClientPluginCloseEvent["reason"]): Promise<void> {
    if (this.closed) return;
    if (this.startPromise) await this.startPromise;
    this.closed = true;
    this.currentNavigation?.controller.abort(reason);
    this.currentNavigation = undefined;

    const clientWindow = this.options.window;
    clientWindow?.removeEventListener("error", this.handleWindowError);
    clientWindow?.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    clientWindow?.removeEventListener("pagehide", this.handlePageHide);
    for (const observer of this.performanceObservers) observer.disconnect();
    this.performanceObservers.length = 0;

    for (const instance of [...this.instances].reverse()) {
      try {
        await instance.plugin.close?.({
          ...this.createStateEvent(instance),
          reason,
        });
      } catch (error) {
        this.logHookError(instance.registration.name, "close", error);
      }
    }
  }

  private async runHook(
    hook: string,
    invoke: (instance: FarmClientPluginInstance) => MaybePromise<void> | undefined,
  ): Promise<void> {
    for (const instance of this.instances) {
      try {
        await invoke(instance);
      } catch (error) {
        this.logHookError(instance.registration.name, hook, error);
        await this.runErrorHooks(
          {
            error,
            phase: `plugin:${hook}`,
            location: this.getLocation(),
          },
          instance,
        );
      }
    }
  }

  private async runErrorHooks(
    event: Pick<FarmClientPluginErrorEvent, "error" | "phase" | "location" | "navigation">,
    excluded?: FarmClientPluginInstance,
  ): Promise<void> {
    for (const instance of this.instances) {
      if (instance === excluded || !instance.plugin.error) continue;
      try {
        await instance.plugin.error({
          ...this.createStateEvent(instance),
          ...event,
        });
      } catch (error) {
        this.logHookError(instance.registration.name, "error", error);
      }
    }
  }

  private createSetupEvent(
    instance: Pick<FarmClientPluginInstance, "registration">,
  ): FarmClientPluginSetupEvent {
    return {
      plugin: {
        name: instance.registration.name,
        version: instance.registration.version,
      },
      options: readonlyOptions(instance.registration.options),
      router: this.options.router,
      isDev: Boolean(this.options.isDev),
      isProd: Boolean(this.options.isProd),
      deploymentId: this.options.deploymentId,
    };
  }

  private createStateEvent(instance: FarmClientPluginInstance): FarmClientPluginStateEvent {
    return {
      ...this.createSetupEvent(instance),
      state: instance.state,
    };
  }

  private getLocation(): FarmClientLocation {
    const href = this.options.window?.location.href ?? "http://localhost/";
    return toClientLocation(href, href);
  }

  private getBaseUrl(): string {
    return this.options.window?.location.href ?? "http://localhost/";
  }

  private logHookError(name: string, hook: string, error: unknown): void {
    console.error(`[Farm.js] Client plugin "${name}" failed in ${hook}:`, error);
  }
}

export function createClientPluginManager(
  registrations: readonly FarmClientPluginRegistration[],
  options: FarmClientPluginManagerOptions,
): FarmClientPluginManager {
  return new FarmClientPluginManager(registrations, options);
}

export function defineClientPlugin<TState = undefined, TOptions = unknown>(
  plugin: FarmClientPlugin<TState, TOptions>,
): FarmClientPlugin<TState, TOptions> {
  return plugin;
}

function sortRegistrations(
  registrations: readonly FarmClientPluginRegistration[],
): FarmClientPluginRegistration[] {
  const rank = (enforce?: FarmClientPluginEnforce) =>
    enforce === "pre" ? 0 : enforce === "post" ? 2 : 1;
  return registrations
    .map((registration, index) => ({ registration, index }))
    .sort(
      (left, right) =>
        rank(left.registration.enforce) - rank(right.registration.enforce) ||
        left.index - right.index,
    )
    .map(({ registration }) => registration);
}

function toClientLocation(
  input: string | URL | FarmClientLocation,
  base: string,
): FarmClientLocation {
  if (typeof input === "object" && "href" in input && "pathname" in input) {
    return {
      href: input.href,
      pathname: input.pathname,
      search: input.search,
      hash: input.hash,
    };
  }

  const url = new URL(input, base);
  return {
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

function readonlyOptions<T>(options: T | undefined): Readonly<T> {
  if (options && typeof options === "object") {
    return Object.freeze(options);
  }
  return options as Readonly<T>;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
