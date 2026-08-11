import {
  _runWithFarmRequestSpan,
  configureFarmTracing,
  getFarmTraceContext,
  normalizeFarmTracingConfig,
  recordFarmEventTrace,
  resetFarmTracing,
  runWithFarmSpan,
  type FarmRequestSpanOptions,
  type FarmResolvedTracingConfig,
  type FarmSpanOptions,
  type FarmTraceContext,
  type FarmTraceSpanKind,
  type FarmTracingConfig,
  type FarmTracingUserConfig,
} from "./tracing";

export type FarmEventLevel = "debug" | "info" | "warn" | "error";

export interface FarmEventBase {
  type: string;
  timestamp: number;
  level: FarmEventLevel;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  traceSampled?: boolean;
  route?: string;
  pathname?: string;
}

export type FarmRequestEvent =
  | (FarmEventBase & { type: "request.start"; method: string; pathname: string })
  | (FarmEventBase & {
      type: "request.complete";
      method: string;
      pathname: string;
      status: number;
      durationMs: number;
    })
  | (FarmEventBase & {
      type: "request.error";
      method: string;
      pathname: string;
      durationMs: number;
      error: unknown;
    });

export type FarmServerEvent =
  | (FarmEventBase & {
      type: "server.start";
      mode: "dev" | "preview" | "production";
      port?: number;
    })
  | (FarmEventBase & { type: "server.ready"; url?: string })
  | (FarmEventBase & { type: "server.shutdown"; reason?: string });

export type FarmRouteEvent =
  | (FarmEventBase & { type: "route.discovered"; route: string; filePath: string })
  | (FarmEventBase & {
      type: "route.matched";
      pathname: string;
      route: string;
      params?: Record<string, string>;
    })
  | (FarmEventBase & { type: "route.notFound"; pathname: string })
  | (FarmEventBase & { type: "route.redirect"; from: string; to: string; status?: number })
  | (FarmEventBase & { type: "route.rewrite"; from: string; to: string });

export type FarmRenderEvent =
  | (FarmEventBase & { type: "render.start"; route: string; pathname?: string })
  | (FarmEventBase & {
      type: "render.complete";
      route: string;
      durationMs: number;
      status?: number;
    })
  | (FarmEventBase & { type: "render.error"; route?: string; error: unknown })
  | (FarmEventBase & { type: "render.stream.start"; route: string })
  | (FarmEventBase & { type: "render.stream.shellReady"; route: string; durationMs: number })
  | (FarmEventBase & { type: "render.stream.complete"; route: string; durationMs: number });

export type FarmCacheEvent =
  | (FarmEventBase & {
      type: "cache.hit";
      key: string;
      route?: string;
      tags?: readonly string[];
      revalidate?: number | false;
      stale?: boolean;
    })
  | (FarmEventBase & { type: "cache.miss"; key: string; route?: string; reason?: string })
  | (FarmEventBase & {
      type: "cache.set";
      key: string;
      route?: string;
      tags?: readonly string[];
      revalidate?: number | false;
    })
  | (FarmEventBase & { type: "cache.dedupe"; key: string })
  | (FarmEventBase & { type: "cache.bypass"; key?: string; route?: string; reason: string })
  | (FarmEventBase & {
      type: "cache.stale";
      key: string;
      route?: string;
      tags?: readonly string[];
      revalidate?: number | false;
    })
  | (FarmEventBase & { type: "cache.revalidatePath"; path: string; count: number })
  | (FarmEventBase & {
      type: "cache.revalidateTag";
      tag: string;
      profile?: unknown;
      count: number;
    })
  | (FarmEventBase & { type: "cache.updateTag"; tag: string; count: number })
  | (FarmEventBase & {
      type: "cache.invalidated";
      key?: string;
      route?: string;
      tag?: string;
      reason?: string;
      count?: number;
    })
  | (FarmEventBase & { type: "cache.delete"; key: string; deleted: boolean })
  | (FarmEventBase & { type: "cache.clear"; count: number })
  | (FarmEventBase & {
      type: "cache.error";
      key?: string;
      operation: "get" | "set" | "delete" | "revalidate";
      error: unknown;
    });

export type FarmPPREvent =
  | (FarmEventBase & { type: "ppr.shell.hit"; route: string; key: string })
  | (FarmEventBase & { type: "ppr.shell.miss"; route: string; key: string })
  | (FarmEventBase & {
      type: "ppr.shell.cached";
      route: string;
      key: string;
      revalidate?: number;
    })
  | (FarmEventBase & { type: "ppr.shell.bypass"; route: string; reason: string })
  | (FarmEventBase & {
      type: "ppr.shell.invalidated";
      route: string;
      reason?: string;
      count?: number;
    })
  | (FarmEventBase & { type: "ppr.suspense.holeDetected"; route: string })
  | (FarmEventBase & { type: "ppr.refresh.start"; route: string })
  | (FarmEventBase & { type: "ppr.refresh.complete"; route: string; durationMs: number })
  | (FarmEventBase & { type: "ppr.refresh.error"; route: string; error: unknown });

export type FarmAPIEvent =
  | (FarmEventBase & { type: "api.request.start"; route: string; method: string })
  | (FarmEventBase & {
      type: "api.request.complete";
      route: string;
      method: string;
      status: number;
      durationMs: number;
    })
  | (FarmEventBase & {
      type: "api.validation.failed";
      route: string;
      method: string;
      issues?: unknown;
    })
  | (FarmEventBase & {
      type: "api.error";
      route: string;
      method: string;
      durationMs: number;
      error: unknown;
    });

export type FarmIntegrationEvent =
  | (FarmEventBase & { type: "integration.registered"; name: string })
  | (FarmEventBase & { type: "integration.config.validated"; name: string })
  | (FarmEventBase & { type: "integration.ready"; name: string })
  | (FarmEventBase & { type: "integration.disposed"; name: string })
  | (FarmEventBase & {
      type: "integration.api.call.start";
      integration: string;
      operation: string;
    })
  | (FarmEventBase & {
      type: "integration.api.call.complete";
      integration: string;
      operation: string;
      durationMs: number;
    })
  | (FarmEventBase & {
      type: "integration.api.call.error";
      integration: string;
      operation: string;
      error: unknown;
    })
  | (FarmEventBase & { type: "integration.webhook.received"; integration: string; event?: string })
  | (FarmEventBase & { type: "integration.webhook.verified"; integration: string; event?: string })
  | (FarmEventBase & { type: "integration.webhook.failed"; integration: string; reason: string });

export type FarmMiddlewareEvent =
  | (FarmEventBase & { type: "middleware.start"; route?: string; name?: string })
  | (FarmEventBase & {
      type: "middleware.complete";
      route?: string;
      name?: string;
      durationMs: number;
    })
  | (FarmEventBase & {
      type: "middleware.shortCircuit";
      route?: string;
      name?: string;
      status?: number;
    })
  | (FarmEventBase & { type: "middleware.error"; route?: string; name?: string; error: unknown });

export type FarmStorageEvent =
  | (FarmEventBase & { type: "storage.query.start"; integration?: string; operation: string })
  | (FarmEventBase & {
      type: "storage.query.complete";
      integration?: string;
      operation: string;
      durationMs: number;
    })
  | (FarmEventBase & {
      type: "storage.query.error";
      integration?: string;
      operation: string;
      error: unknown;
    })
  | (FarmEventBase & { type: "storage.schema.ready"; integration?: string })
  | (FarmEventBase & { type: "storage.schema.error"; integration?: string; error: unknown });

export type FarmBuildEvent =
  | (FarmEventBase & { type: "build.start"; target?: string })
  | (FarmEventBase & { type: "build.complete"; target?: string; durationMs: number })
  | (FarmEventBase & { type: "build.error"; target?: string; error: unknown })
  | (FarmEventBase & { type: "routes.generated"; pageCount: number; apiCount?: number })
  | (FarmEventBase & { type: "types.generated"; filePath: string })
  | (FarmEventBase & { type: "manifest.generated"; routeCount: number });

export type FarmPluginEvent =
  | (FarmEventBase & { type: "plugin.hook.start"; plugin: string; hook: string })
  | (FarmEventBase & {
      type: "plugin.hook.complete";
      plugin: string;
      hook: string;
      durationMs: number;
    })
  | (FarmEventBase & { type: "plugin.hook.error"; plugin: string; hook: string; error: unknown });

export type FarmErrorEvent = FarmEventBase & {
  type: "error";
  source: string;
  error: unknown;
  route?: string;
};

export type FarmEvent =
  | FarmRequestEvent
  | FarmServerEvent
  | FarmRouteEvent
  | FarmRenderEvent
  | FarmCacheEvent
  | FarmPPREvent
  | FarmAPIEvent
  | FarmIntegrationEvent
  | FarmMiddlewareEvent
  | FarmStorageEvent
  | FarmBuildEvent
  | FarmPluginEvent
  | FarmErrorEvent;

export type FarmEventType = FarmEvent["type"];
export type FarmEventHandler = (event: FarmEvent) => void | Promise<void>;

export type FarmEventInput = FarmEvent extends infer T
  ? T extends FarmEvent
    ? Omit<T, "timestamp" | "level"> & Partial<Pick<T, "timestamp" | "level">>
    : never
  : never;

export type FarmObservabilityUserConfig =
  | boolean
  | {
      logs?: boolean;
      onEvent?: FarmEventHandler | readonly FarmEventHandler[];
      events?: readonly FarmEventType[];
      tracing?: FarmTracingUserConfig;
    };

export interface FarmResolvedObservabilityConfig {
  logs: boolean;
  handlers: FarmEventHandler[];
  events?: Set<FarmEventType>;
  tracing: FarmResolvedTracingConfig;
}

const runtimeHandlers = new Set<FarmEventHandler>();
let observabilityState: FarmResolvedObservabilityConfig = {
  logs: false,
  handlers: [],
  tracing: normalizeFarmTracingConfig(false),
};

export function configureFarmObservability(config: FarmObservabilityUserConfig | undefined): void {
  observabilityState = normalizeFarmObservabilityConfig(config);
  configureFarmTracing(observabilityState.tracing);
}

export function normalizeFarmObservabilityConfig(
  config: FarmObservabilityUserConfig | undefined,
): FarmResolvedObservabilityConfig {
  if (config === undefined || config === false) {
    return { logs: false, handlers: [], tracing: normalizeFarmTracingConfig(false) };
  }

  if (config === true) {
    return { logs: true, handlers: [], tracing: normalizeFarmTracingConfig(false) };
  }

  const handlers = config.onEvent
    ? Array.isArray(config.onEvent)
      ? [...config.onEvent]
      : [config.onEvent]
    : [];

  return {
    logs: config.logs ?? false,
    handlers,
    events: config.events ? new Set(config.events) : undefined,
    tracing: normalizeFarmTracingConfig(config.tracing),
  };
}

export function onFarmEvent(handler: FarmEventHandler): () => void {
  runtimeHandlers.add(handler);
  return () => {
    runtimeHandlers.delete(handler);
  };
}

export function resetFarmObservability(): void {
  runtimeHandlers.clear();
  observabilityState = {
    logs: false,
    handlers: [],
    tracing: normalizeFarmTracingConfig(false),
  };
  resetFarmTracing();
}

export function emitFarmEvent(input: FarmEventInput): FarmEvent {
  const event = {
    timestamp: Date.now(),
    level: inferFarmEventLevel(input.type),
    ...input,
  } as FarmEvent;

  const traceContext = recordFarmEventTrace(event);
  if (traceContext) {
    event.traceId = traceContext.traceId;
    event.spanId = traceContext.spanId;
    event.traceSampled = traceContext.traceSampled;
  }

  if (!shouldEmitFarmEvent(event)) {
    return event;
  }

  if (observabilityState.logs) {
    logFarmEvent(event);
  }

  for (const handler of [...observabilityState.handlers, ...runtimeHandlers]) {
    try {
      Promise.resolve(handler(event)).catch((error) => {
        console.warn(`[farm:observability] event handler failed: ${formatError(error)}`);
      });
    } catch (error) {
      console.warn(`[farm:observability] event handler failed: ${formatError(error)}`);
    }
  }

  return event;
}

export async function runWithFarmRequestSpan<T>(
  request: Request,
  handler: () => T | Promise<T>,
  options: FarmRequestSpanOptions = {},
): Promise<T> {
  const url = new URL(request.url);
  const method = request.method || "GET";
  return await _runWithFarmRequestSpan(request, handler, {
    ...options,
    onStart() {
      emitFarmEvent({ type: "request.start", method, pathname: url.pathname });
      options.onStart?.();
    },
    onComplete(status, durationMs) {
      emitFarmEvent({
        type: "request.complete",
        method,
        pathname: url.pathname,
        status,
        durationMs,
      });
      options.onComplete?.(status, durationMs);
    },
    onError(error, durationMs) {
      emitFarmEvent({
        type: "request.error",
        method,
        pathname: url.pathname,
        durationMs,
        error,
      });
      options.onError?.(error, durationMs);
    },
  });
}

export { configureFarmTracing, getFarmTraceContext, normalizeFarmTracingConfig, runWithFarmSpan };
export type {
  FarmRequestSpanOptions,
  FarmResolvedTracingConfig,
  FarmSpanOptions,
  FarmTraceContext,
  FarmTraceSpanKind,
  FarmTracingConfig,
  FarmTracingUserConfig,
};

function shouldEmitFarmEvent(event: FarmEvent): boolean {
  if (
    !observabilityState.logs &&
    observabilityState.handlers.length === 0 &&
    runtimeHandlers.size === 0
  ) {
    return false;
  }

  if (observabilityState.events && !observabilityState.events.has(event.type)) {
    return false;
  }

  return true;
}

function inferFarmEventLevel(type: FarmEventType): FarmEventLevel {
  if (type === "error" || type.endsWith(".error") || type.endsWith(".failed")) {
    return "error";
  }
  if (
    type.endsWith(".bypass") ||
    type.endsWith(".invalidated") ||
    type.endsWith(".stale") ||
    type.endsWith(".notFound")
  ) {
    return "warn";
  }
  if (
    type.endsWith(".hit") ||
    type.endsWith(".miss") ||
    type.endsWith(".start") ||
    type.endsWith(".shellReady")
  ) {
    return "debug";
  }
  return "info";
}

function logFarmEvent(event: FarmEvent): void {
  const message = `[farm:${event.level}] ${event.type}${formatFarmEventDetails(event)}`;
  switch (event.level) {
    case "error":
      console.error(message);
      break;
    case "warn":
      console.warn(message);
      break;
    default:
      console.log(message);
      break;
  }
}

function formatFarmEventDetails(event: FarmEvent): string {
  const details: string[] = [];
  const record = event as unknown as Record<string, unknown>;

  for (const key of [
    "route",
    "pathname",
    "method",
    "status",
    "key",
    "tag",
    "path",
    "reason",
    "durationMs",
    "integration",
    "operation",
    "plugin",
    "hook",
    "target",
    "count",
  ]) {
    const value = record[key];
    if (value !== undefined) {
      details.push(`${key}=${formatDetailValue(value)}`);
    }
  }

  return details.length > 0 ? ` ${details.join(" ")}` : "";
}

function formatDetailValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
