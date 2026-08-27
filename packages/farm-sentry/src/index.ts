import type {
  FarmInstrumentationCleanup,
  FarmInstrumentationContext,
} from "@farm.js/core/instrumentation";
import { onFarmEvent, type FarmEvent } from "@farm.js/core/observability";
import { definePlugin } from "@farm.js/core/plugin";

/** Minimal span surface used by the plugin, satisfied by `@sentry/node`. */
export interface SentrySpanLike {
  end(): void;
  setStatus?(status: { code: number; message?: string }): void;
  setAttribute?(key: string, value: unknown): void;
}

/** Minimal scope surface used by the plugin, satisfied by `@sentry/node`. */
export interface SentryScopeLike {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown> | null): void;
}

/**
 * The parts of the Sentry SDK this plugin uses. Declared structurally so the
 * plugin can be unit tested and so an application can pass an SDK it already
 * initialized, the way `@farm.js/cache-redis` accepts any Redis client.
 */
export interface SentrySdkLike {
  init?(options: Record<string, unknown>): void;
  /** Returns the active client, or undefined before `init`. */
  getClient?(): unknown;
  captureException(error: unknown, hint?: { captureContext?: unknown }): string;
  withScope?<T>(callback: (scope: SentryScopeLike) => T): T;
  /** The span the SDK's own instrumentation opened for this request. */
  getActiveSpan?(): SentrySpanLike | undefined;
  getRootSpan?(span: SentrySpanLike): SentrySpanLike | undefined;
  updateSpanName?(span: SentrySpanLike, name: string): void;
  startInactiveSpan?(options: {
    name: string;
    op?: string;
    /** Send the span as a transaction root rather than a child. */
    forceTransaction?: boolean;
    attributes?: Record<string, unknown>;
  }): SentrySpanLike | undefined;
  flush?(timeout?: number): Promise<boolean>;
}

export interface SentryPluginOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  /**
   * Error events can carry request headers and user data, so this stays off
   * unless the application opts in.
   */
  sendDefaultPii?: boolean;
  /** Set false to register the hooks but do no reporting. */
  enabled?: boolean;
  /** An SDK module to use instead of importing `@sentry/node`. */
  sdk?: SentrySdkLike;
  /**
   * Flush after every response and after a failed request. Required on hosts
   * that can terminate a process without a shutdown signal, where
   * `runtime.close` never runs.
   */
  flushOnResponse?: boolean;
  flushTimeoutMs?: number;
  /**
   * Extra options merged into `Sentry.init`, for anything this plugin does not
   * model directly such as `debug`, `beforeSend`, `ignoreErrors` or
   * `integrations`. Explicit options above win over keys repeated here.
   */
  sentryOptions?: Record<string, unknown>;
  /**
   * Emit source maps in the production build. This only generates them, it does
   * not upload anything to Sentry, so stack traces stay minified until the maps
   * are uploaded separately.
   *
   * Farm only uses its fast esbuild minifier while `sourceMap` is false, so
   * turning this on moves minification to Nitro's terser. Install
   * `@rollup/plugin-terser` alongside it, otherwise the build fails with
   * `Cannot find module '@rollup/plugin-terser'`.
   */
  sourceMaps?: boolean;
}

/** Per-request state stored under the `sentry` context key. */
export interface SentryRequestContext {
  span?: SentrySpanLike;
  /** True when the plugin created the span and therefore has to end it. */
  ownsSpan: boolean;
  startedAt: number;
  ended: boolean;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;

/** Sentry status codes: 1 is ok, 2 is error. */
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

/** Errors reported during the current event-loop turn. */
const recentlyReportedErrors = new WeakSet<object>();

/**
 * Thrown primitives reported during the current event-loop turn.
 *
 * A WeakSet cannot hold a string or a number, so these are tracked separately.
 * The claim is by value rather than identity, so two requests throwing the
 * identical primitive within one turn report once. That is the better trade
 * against reporting every primitive twice, since a value carries no stack and
 * Sentry groups the events together regardless.
 */
const recentlyReportedValues = new Set<unknown>();

/**
 * Returns false when the same error is already being delivered through another
 * Farm error path. The claim expires so reusing an error in a later request is
 * still reported.
 */
export function claimError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    if (recentlyReportedErrors.has(error)) return false;
    recentlyReportedErrors.add(error);
    setTimeout(() => recentlyReportedErrors.delete(error), 0);
    return true;
  }

  if (recentlyReportedValues.has(error)) return false;
  recentlyReportedValues.add(error);
  setTimeout(() => recentlyReportedValues.delete(error), 0);
  return true;
}

const MISSING_SDK_MESSAGE =
  "@farm.js/sentry needs @sentry/node. Install it with `pnpm add @sentry/node`, " +
  "or pass an SDK through the `sdk` option.";

export async function resolveSentrySdk(
  options: SentryPluginOptions,
): Promise<SentrySdkLike | undefined> {
  if (options.sdk) return options.sdk;

  try {
    // The specifier has to be a literal. A variable is invisible to bundlers,
    // so the dependency is never traced into serverless output and the import
    // fails at runtime. That is what happened on Vercel, where the plugin
    // reported a missing SDK even though the package was installed.
    return (await import("@sentry/node")) as unknown as SentrySdkLike;
  } catch {
    return undefined;
  }
}

/**
 * Report loudly when a DSN was configured but no SDK resolved. Silently doing
 * nothing hides a missing or broken install until errors are already lost.
 *
 * This logs rather than throws. It runs during instrumentation, before the
 * application loads, so throwing takes the whole process down. Monitoring must
 * never do that to the application it observes.
 */
export function assertSentrySdk(
  sdk: SentrySdkLike | undefined,
  options: SentryPluginOptions,
): SentrySdkLike | undefined {
  if (sdk) return sdk;
  if (options.dsn) console.error(`[farm:sentry] ${MISSING_SDK_MESSAGE}`);
  return undefined;
}

export async function requireSentrySdk(
  options: SentryPluginOptions,
): Promise<SentrySdkLike | undefined> {
  return assertSentrySdk(await resolveSentrySdk(options), options);
}

export function buildSentryInitOptions(
  options: SentryPluginOptions,
  context?: Pick<FarmInstrumentationContext, "mode">,
): Record<string, unknown> {
  const explicit: Record<string, unknown> = {
    dsn: options.dsn,
    environment: options.environment ?? context?.mode,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    sendDefaultPii: options.sendDefaultPii ?? false,
  };

  // Drop undefined so a passthrough key is not overwritten by an unset option.
  for (const key of Object.keys(explicit)) {
    if (explicit[key] === undefined) delete explicit[key];
  }

  return { ...options.sentryOptions, ...explicit };
}

/** Initialize once. A second `init` would replace a working client. */
export function initSentryOnce(
  sdk: SentrySdkLike,
  options: SentryPluginOptions,
  context?: Pick<FarmInstrumentationContext, "mode">,
): boolean {
  if (!options.dsn) return false;
  if (sdk.getClient?.()) return false;
  sdk.init?.(buildSentryInitOptions(options, context));
  return true;
}

/**
 * True for observability events that carry a reportable error.
 *
 * Farm handles many failures internally rather than letting them reach the
 * plugin's `runtime.error` hook. A page that throws during render becomes a
 * `render.error` event and a 500 response, and the request pipeline never
 * throws, so the event stream is the only place those are visible.
 */
export function isErrorEvent(event: FarmEvent): event is FarmEvent & { error: unknown } {
  if (!("error" in event) || event.error === undefined) return false;
  return event.type === "error" || event.type.endsWith(".error");
}

/** Route hint carried by the error-bearing events, where one is present. */
export function errorEventRoute(event: FarmEvent): string | undefined {
  const route = (event as { route?: unknown }).route;
  return typeof route === "string" ? route : undefined;
}

/**
 * Name spans by route pattern rather than pathname. `/users/[id]` keeps one
 * span name, where `/users/1` and `/users/2` would create one per user.
 */
export function spanNameFor(
  method: string,
  route: { pathname: string; pattern?: string | null } | undefined,
  fallbackPathname: string,
): string {
  return `${method} ${route?.pattern || route?.pathname || fallbackPathname}`;
}

/**
 * Early Sentry initialization for `src/instrumentation.ts`.
 *
 * The Node SDK patches other modules as they load, so it has to run before the
 * rest of the application. A plugin `setup` cannot guarantee that ordering.
 *
 * ```ts
 * // src/instrumentation.ts
 * export const register = registerSentry({ dsn: process.env.SENTRY_DSN });
 * ```
 */
export function registerSentry(
  options: SentryPluginOptions = {},
): (context: FarmInstrumentationContext) => Promise<FarmInstrumentationCleanup> {
  return async function register(context) {
    if (options.enabled === false) return;
    // Node only for now. `@sentry/node` does not run on Workers, which need
    // `@sentry/cloudflare` instead.
    if (context.runtime !== "nodejs") return;

    // Instrumentation runs before the application loads, so anything thrown
    // here stops the process from booting. Losing telemetry is acceptable,
    // taking the application down with it is not.
    try {
      const sdk = await requireSentrySdk(options);
      if (!sdk) return;

      initSentryOnce(sdk, options, context);

      return async () => {
        await sdk.flush?.(options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS);
      };
    } catch (error) {
      console.error("[farm:sentry] failed to initialize, continuing without it:", error);
      return;
    }
  };
}

/**
 * Maps Farm's request, render and build lifecycles onto Sentry.
 *
 * Pair with `registerSentry` in `src/instrumentation.ts` when using the Node
 * SDK, so initialization happens before the application loads.
 */
export function sentryPlugin(options: SentryPluginOptions = {}) {
  const enabled = options.enabled !== false;
  const flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;

  return definePlugin({
    name: "farm:sentry",
    // Wrap as much of the request as possible.
    enforce: "pre" as const,

    setup() {
      // No SDK work here. `setup` can run in a build manager and again in a
      // deployed runtime, so it has to stay deterministic.
      return {
        enabled,
        options,
        flushTimeoutMs,
        sdk: options.sdk,
        unsubscribe: undefined as (() => void) | undefined,
      };
    },

    runtime: {
      async start({ state }) {
        if (!state.enabled) return;

        try {
          state.sdk ??= await requireSentrySdk(state.options);
          // `registerSentry` usually initialized already, and `initSentryOnce`
          // checks for a live client so this does not replace it.
          if (state.sdk) initSentryOnce(state.sdk, state.options);
        } catch (error) {
          // Server startup must not fail because reporting could not start.
          console.error("[farm:sentry] failed to initialize, continuing without it:", error);
          return;
        }

        if (state.unsubscribe || !state.sdk) return;
        state.unsubscribe = onFarmEvent(
          (event) => {
            if (!isErrorEvent(event)) return;
            if (!claimError(event.error)) return;

            const route = errorEventRoute(event);
            const capture = () => state.sdk?.captureException(event.error);

            if (state.sdk?.withScope) {
              state.sdk.withScope((scope) => {
                scope.setTag("farm.event", event.type);
                if (route) scope.setTag("farm.route", route);
                capture();
              });
              return;
            }

            capture();
          },
          { unfiltered: true },
        );
      },

      context({ request, route, state }) {
        const empty: SentryRequestContext = { ownsSpan: false, startedAt: Date.now(), ended: true };
        if (!state.enabled || !state.sdk) return { sentry: empty };

        const url = new URL(request.url);
        const name = spanNameFor(request.method, route, url.pathname);

        // Prefer the span the SDK's own HTTP instrumentation already opened.
        // It is the active span, so automatic HTTP and database spans nest
        // under it. Creating our own would leave those siblings of the request.
        const active = state.sdk.getActiveSpan?.();
        if (active) {
          const root = state.sdk.getRootSpan?.(active) ?? active;
          state.sdk.updateSpanName?.(root, name);
          if (route?.pattern) root.setAttribute?.("farm.route", route.pattern);
          return { sentry: { span: root, ownsSpan: false, startedAt: Date.now(), ended: false } };
        }

        // No automatic instrumentation attached, so record the request itself.
        // `forceTransaction` is required, an orphan span is never sent.
        const span = state.sdk.startInactiveSpan?.({
          name,
          op: "http.server",
          forceTransaction: true,
          attributes: {
            "http.request.method": request.method,
            "url.path": url.pathname,
            ...(route?.pattern ? { "farm.route": route.pattern } : {}),
          },
        });

        return { sentry: { span, ownsSpan: true, startedAt: Date.now(), ended: false } };
      },

      after({ ctx, response, state, waitUntil }) {
        const sentry = ctx.sentry;
        if (sentry && !sentry.ended) {
          sentry.span?.setStatus?.({
            code: response.status >= 500 ? SPAN_STATUS_ERROR : SPAN_STATUS_OK,
          });
          // Only end a span this plugin created. The SDK owns the lifecycle of
          // its own request span.
          if (sentry.ownsSpan) sentry.span?.end();
          sentry.ended = true;
        }

        flushWithinRequest(state, waitUntil);
      },

      error({ ctx, error, request, route, kind, state, waitUntil }) {
        const sentry = ctx.sentry;
        if (sentry && !sentry.ended) {
          sentry.span?.setStatus?.({ code: SPAN_STATUS_ERROR });
          if (sentry.ownsSpan) sentry.span?.end();
          sentry.ended = true;
        }

        if (!state.enabled || !state.sdk) return;

        // The event stream may already have reported this one.
        if (!claimError(error)) {
          flushWithinRequest(state, waitUntil);
          return;
        }

        const url = new URL(request.url);
        const capture = () => state.sdk?.captureException(error);

        if (state.sdk.withScope) {
          state.sdk.withScope((scope) => {
            scope.setTag("farm.kind", String(kind));
            if (route?.pattern) scope.setTag("farm.route", route.pattern);
            scope.setContext("request", {
              method: request.method,
              path: url.pathname,
            });
            capture();
          });
        } else {
          capture();
        }

        // A failing request never reaches `runtime.after`, so without this the
        // exception is lost on hosts that stop the process straight after.
        flushWithinRequest(state, waitUntil);
      },

      async close({ state }) {
        state.unsubscribe?.();
        state.unsubscribe = undefined;
        if (!state.enabled) return;
        try {
          await state.sdk?.flush?.(state.flushTimeoutMs);
        } catch (error) {
          // Losing the last events is not a reason to fail the shutdown.
          console.error("[farm:sentry] flush on shutdown failed:", error);
        }
      },
    },

    build: {
      configure(buildConfig: Record<string, unknown>, { state }) {
        if (!state.options.sourceMaps) return;
        // Generating maps moves minification from Farm's esbuild pass to
        // Nitro's terser, so the application needs `@rollup/plugin-terser`.
        return { ...buildConfig, sourceMap: true };
      },
    },
  });
}

/** Flush inside the request for hosts that may not run `runtime.close`. */
function flushWithinRequest(
  state: {
    enabled: boolean;
    options: SentryPluginOptions;
    flushTimeoutMs: number;
    sdk?: SentrySdkLike;
  },
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  if (!state.enabled || !state.options.flushOnResponse) return;
  const flush = state.sdk?.flush;
  if (!flush) return;
  // The host owns this promise once handed over, and Farm passes it through
  // untouched when the host supplies waitUntil. An unhandled rejection there
  // can terminate the process, so a failed flush has to stay contained.
  waitUntil(
    flush.call(state.sdk, state.flushTimeoutMs).then(
      () => undefined,
      (error: unknown) => {
        console.error("[farm:sentry] flush failed:", error);
      },
    ),
  );
}
