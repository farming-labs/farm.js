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
 * The parts of a Sentry client this plugin uses. Declared structurally so the
 * plugin can be unit tested and so an application can pass a client it already
 * initialized, the way `@farm.js/cache-redis` accepts any Redis client.
 */
export interface SentryClientLike {
  init?(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: { captureContext?: unknown }): string;
  withScope?<T>(callback: (scope: SentryScopeLike) => T): T;
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
  /** A client to use instead of importing `@sentry/node`. */
  client?: SentryClientLike;
  /**
   * Flush after every response. Required on hosts that can terminate a process
   * without a shutdown signal, where `runtime.close` may never run.
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
   * Emit source maps in the production build so stack traces are readable.
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
  startedAt: number;
  ended: boolean;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;

/** Sentry status codes: 1 is ok, 2 is error. */
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

export async function resolveSentryClient(
  options: SentryPluginOptions,
): Promise<SentryClientLike | undefined> {
  if (options.client) return options.client;

  // Indirect specifier so the optional dependency is resolved at runtime only.
  const specifier = "@sentry/node";
  try {
    return (await import(specifier)) as SentryClientLike;
  } catch {
    return undefined;
  }
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

    const client = await resolveSentryClient(options);
    if (!client) return;

    client.init?.(buildSentryInitOptions(options, context));

    return async () => {
      await client.flush?.(options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS);
    };
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
        client: options.client,
        // Errors can reach us from both the event stream and `runtime.error`.
        // Track what has been sent so the same failure is reported once.
        reported: new WeakSet<object>(),
        unsubscribe: undefined as (() => void) | undefined,
      };
    },

    runtime: {
      async start({ state }) {
        if (!state.enabled) return;

        if (!state.client) {
          state.client = await resolveSentryClient(state.options);
          // `registerSentry` normally initializes first. Only initialize here
          // if nothing has, which is the case when the plugin is used alone.
          if (state.options.dsn) state.client?.init?.(buildSentryInitOptions(state.options));
        }

        if (state.unsubscribe || !state.client) return;
        state.unsubscribe = onFarmEvent((event) => {
          if (!isErrorEvent(event)) return;
          if (typeof event.error === "object" && event.error !== null) {
            if (state.reported.has(event.error)) return;
            state.reported.add(event.error);
          }

          const route = errorEventRoute(event);
          const capture = () => state.client?.captureException(event.error);

          if (state.client?.withScope) {
            state.client.withScope((scope) => {
              scope.setTag("farm.event", event.type);
              if (route) scope.setTag("farm.route", route);
              capture();
            });
            return;
          }

          capture();
        });
      },

      context({ request, route, state }) {
        const url = new URL(request.url);
        const span = state.enabled
          ? state.client?.startInactiveSpan?.({
              name: spanNameFor(request.method, route, url.pathname),
              op: "http.server",
              // Without this the span is an orphan and is never sent, so
              // nothing shows up under Performance.
              forceTransaction: true,
              attributes: {
                "http.request.method": request.method,
                "url.path": url.pathname,
                ...(route?.pattern ? { "farm.route": route.pattern } : {}),
              },
            })
          : undefined;

        // Namespaced, because duplicate top level context keys fail the request.
        return { sentry: { span, startedAt: Date.now(), ended: false } as SentryRequestContext };
      },

      after({ ctx, response, state, waitUntil }) {
        const sentry = ctx.sentry;
        if (sentry && !sentry.ended) {
          sentry.ended = true;
          sentry.span?.setStatus?.({
            code: response.status >= 500 ? SPAN_STATUS_ERROR : SPAN_STATUS_OK,
          });
          sentry.span?.end();
        }

        if (state.enabled && state.options.flushOnResponse && state.client?.flush) {
          // Serverless hosts can terminate without a shutdown signal, so the
          // flush has to finish inside the request's own lifetime.
          waitUntil(state.client.flush(state.flushTimeoutMs).then(() => undefined));
        }
      },

      error({ ctx, error, request, route, kind, state }) {
        const sentry = ctx.sentry;
        if (sentry && !sentry.ended) {
          sentry.ended = true;
          sentry.span?.setStatus?.({ code: SPAN_STATUS_ERROR });
          sentry.span?.end();
        }

        if (!state.enabled || !state.client) return;

        // The event stream may already have reported this one.
        if (typeof error === "object" && error !== null) {
          if (state.reported.has(error)) return;
          state.reported.add(error);
        }

        const url = new URL(request.url);
        const capture = () => state.client?.captureException(error);

        if (state.client.withScope) {
          state.client.withScope((scope) => {
            scope.setTag("farm.kind", String(kind));
            if (route?.pattern) scope.setTag("farm.route", route.pattern);
            scope.setContext("request", {
              method: request.method,
              path: url.pathname,
            });
            capture();
          });
          return;
        }

        capture();
      },

      async close({ state }) {
        state.unsubscribe?.();
        state.unsubscribe = undefined;
        if (!state.enabled) return;
        await state.client?.flush?.(state.flushTimeoutMs);
      },
    },

    build: {
      configure(buildConfig: Record<string, unknown>, { state }) {
        if (!state.options.sourceMaps) return;
        // Readable stack traces need source maps in the production bundle.
        // This moves minification from Farm's esbuild pass to Nitro's terser,
        // so the application needs `@rollup/plugin-terser` installed.
        return { ...buildConfig, sourceMap: true };
      },
    },
  });
}
