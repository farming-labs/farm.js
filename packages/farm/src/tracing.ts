import {
  context,
  createContextKey,
  isSpanContextValid,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import type { FarmEvent } from "./observability";

export const FARM_TRACER_NAME = "@farm.js/core";

export type FarmTraceSpanKind =
  | "request"
  | "render"
  | "middleware"
  | "api"
  | "integration"
  | "storage"
  | "ppr"
  | "build"
  | "plugin";

export interface FarmTracingConfig {
  /** Enable Farm's OpenTelemetry spans. */
  enabled?: boolean;
  /** Span families to record. All families are enabled by default. */
  spans?: readonly FarmTraceSpanKind[];
  /** Add Farm lifecycle events to the active span. Defaults to true. */
  recordEvents?: boolean;
  /** Static attributes added to every Farm-created span. */
  attributes?: Attributes;
  /** Path prefixes that should not create request spans. */
  ignorePaths?: readonly string[];
}

export type FarmTracingUserConfig = boolean | FarmTracingConfig;

export interface FarmResolvedTracingConfig {
  enabled: boolean;
  spans: ReadonlySet<FarmTraceSpanKind>;
  recordEvents: boolean;
  attributes: Attributes;
  ignorePaths: readonly string[];
}

export interface FarmTraceContext {
  traceId: string;
  spanId: string;
  traceSampled: boolean;
}

export interface FarmRequestSpanOptions {
  getStatusCode?: () => number | undefined;
  onStart?: () => void;
  onComplete?: (status: number, durationMs: number) => void;
  onError?: (error: unknown, durationMs: number) => void;
}

export interface FarmSpanOptions {
  kind?: FarmTraceSpanKind;
  attributes?: Attributes;
  spanKind?: SpanKind;
}

const ALL_SPAN_KINDS: readonly FarmTraceSpanKind[] = [
  "request",
  "render",
  "middleware",
  "api",
  "integration",
  "storage",
  "ppr",
  "build",
  "plugin",
];

const DEFAULT_IGNORED_PATHS = [
  "/@vite/",
  "/@fs/",
  "/@id/",
  "/@react-refresh",
  "/node_modules/",
  "/__vite",
  "/.well-known/appspecific/",
];
const FARM_REQUEST_METHOD_CONTEXT_KEY = createContextKey("@farm.js/core/request-method");

let tracingState: FarmResolvedTracingConfig = normalizeFarmTracingConfig(false);

export function normalizeFarmTracingConfig(
  config: FarmTracingUserConfig | undefined,
): FarmResolvedTracingConfig {
  if (!config) {
    return {
      enabled: false,
      spans: new Set(ALL_SPAN_KINDS),
      recordEvents: true,
      attributes: {},
      ignorePaths: DEFAULT_IGNORED_PATHS,
    };
  }

  if (config === true) {
    return {
      enabled: true,
      spans: new Set(ALL_SPAN_KINDS),
      recordEvents: true,
      attributes: {},
      ignorePaths: DEFAULT_IGNORED_PATHS,
    };
  }

  return {
    enabled: config.enabled ?? true,
    spans: new Set(config.spans ?? ALL_SPAN_KINDS),
    recordEvents: config.recordEvents ?? true,
    attributes: { ...config.attributes },
    ignorePaths: [...DEFAULT_IGNORED_PATHS, ...(config.ignorePaths ?? [])],
  };
}

export function configureFarmTracing(
  config: FarmTracingUserConfig | FarmResolvedTracingConfig | undefined,
): void {
  if (isResolvedFarmTracingConfig(config)) {
    tracingState = {
      ...config,
      spans: new Set(config.spans),
      attributes: { ...config.attributes },
      ignorePaths: [...config.ignorePaths],
    };
    return;
  }
  tracingState = normalizeFarmTracingConfig(config as FarmTracingUserConfig | undefined);
}

function isResolvedFarmTracingConfig(
  config: FarmTracingUserConfig | FarmResolvedTracingConfig | undefined,
): config is FarmResolvedTracingConfig {
  return (
    !!config &&
    typeof config === "object" &&
    typeof config.enabled === "boolean" &&
    config.spans instanceof Set &&
    typeof config.recordEvents === "boolean" &&
    Array.isArray(config.ignorePaths)
  );
}

export function getFarmTracingConfig(): FarmResolvedTracingConfig {
  return tracingState;
}

export function resetFarmTracing(): void {
  tracingState = normalizeFarmTracingConfig(false);
}

export function getFarmTraceContext(): FarmTraceContext | undefined {
  return getSpanTraceContext(trace.getSpan(context.active()));
}

export async function runWithFarmSpan<T>(
  name: string,
  handler: () => T | Promise<T>,
  options: FarmSpanOptions = {},
): Promise<T> {
  const spanFamily = options.kind;
  if (!tracingState.enabled || (spanFamily !== undefined && !tracingState.spans.has(spanFamily))) {
    return await handler();
  }

  const tracer = trace.getTracer(FARM_TRACER_NAME);
  return await tracer.startActiveSpan(
    name,
    {
      kind: options.spanKind ?? SpanKind.INTERNAL,
      attributes: {
        ...tracingState.attributes,
        ...options.attributes,
      },
    },
    async (span) => {
      try {
        return await handler();
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export async function _runWithFarmRequestSpan<T>(
  request: Request,
  handler: () => T | Promise<T>,
  options: FarmRequestSpanOptions = {},
): Promise<T> {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const shouldTrace =
    tracingState.enabled &&
    tracingState.spans.has("request") &&
    !tracingState.ignorePaths.some((prefix) => url.pathname.startsWith(prefix));

  if (!shouldTrace) {
    options.onStart?.();
    try {
      const result = await handler();
      options.onComplete?.(resolveResultStatus(result, options), Date.now() - startedAt);
      return result;
    } catch (error) {
      options.onError?.(error, Date.now() - startedAt);
      throw error;
    }
  }

  const extractedContext = propagation.extract(context.active(), request.headers, {
    keys(carrier) {
      return Array.from(carrier.keys());
    },
    get(carrier, key) {
      return carrier.get(key) ?? undefined;
    },
  });
  const requestContext = extractedContext.setValue(FARM_REQUEST_METHOD_CONTEXT_KEY, request.method);
  const tracer = trace.getTracer(FARM_TRACER_NAME);
  const attributes: Attributes = {
    ...tracingState.attributes,
    "http.request.method": request.method,
    "url.path": url.pathname,
    "url.scheme": url.protocol.replace(/:$/, ""),
    "server.address": url.hostname,
  };
  if (url.port) attributes["server.port"] = Number(url.port);

  return await tracer.startActiveSpan(
    `${request.method} ${url.pathname}`,
    { kind: SpanKind.SERVER, attributes },
    requestContext,
    async (span) => {
      options.onStart?.();
      try {
        const result = await handler();
        const status = resolveResultStatus(result, options);
        setResponseStatus(span, status);
        options.onComplete?.(status, Date.now() - startedAt);
        return result;
      } catch (error) {
        recordSpanError(span, error);
        options.onError?.(error, Date.now() - startedAt);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function recordFarmEventTrace(event: FarmEvent): FarmTraceContext | undefined {
  if (!tracingState.enabled) return undefined;

  const activeContext = context.active();
  const activeSpan = trace.getSpan(activeContext);
  const traceContext = getSpanTraceContext(activeSpan);
  if (activeSpan && traceContext) {
    if (event.type === "route.matched") {
      const method =
        (activeContext.getValue(FARM_REQUEST_METHOD_CONTEXT_KEY) as string | undefined) ?? "HTTP";
      activeSpan.updateName(`${method} ${event.route}`);
      activeSpan.setAttribute("http.route", event.route);
      activeSpan.setAttribute("farm.route", event.route);
    }

    if (tracingState.recordEvents) {
      activeSpan.addEvent(event.type, toEventAttributes(event), event.timestamp);
    }

    const error = event.type === "request.error" ? undefined : getEventError(event);
    if (error !== undefined) recordSpanError(activeSpan, error);
  }

  const completedTraceContext = recordCompletedEventSpan(event, activeContext);
  return traceContext ?? completedTraceContext;
}

function recordCompletedEventSpan(
  event: FarmEvent,
  parentContext: Context,
): FarmTraceContext | undefined {
  const descriptor = getCompletedSpanDescriptor(event);
  if (!descriptor || !tracingState.spans.has(descriptor.kind)) return undefined;

  const tracer = trace.getTracer(FARM_TRACER_NAME);
  const span = tracer.startSpan(
    descriptor.name,
    {
      kind: SpanKind.INTERNAL,
      startTime: event.timestamp - descriptor.durationMs,
      attributes: {
        ...tracingState.attributes,
        ...toEventAttributes(event),
        "farm.event.type": event.type,
      },
    },
    parentContext,
  );

  const status = "status" in event && typeof event.status === "number" ? event.status : undefined;
  if (status !== undefined) setResponseStatus(span, status);
  const error = getEventError(event);
  if (error !== undefined) recordSpanError(span, error);
  const traceContext = getSpanTraceContext(span);
  span.end(event.timestamp);
  return traceContext;
}

function getCompletedSpanDescriptor(
  event: FarmEvent,
): { kind: FarmTraceSpanKind; name: string; durationMs: number } | undefined {
  if (!("durationMs" in event) || typeof event.durationMs !== "number") return undefined;

  switch (event.type) {
    case "render.complete":
      return { kind: "render", name: `farm.render ${event.route}`, durationMs: event.durationMs };
    case "render.stream.shellReady":
      return {
        kind: "render",
        name: `farm.render.shell ${event.route}`,
        durationMs: event.durationMs,
      };
    case "render.stream.complete":
      return {
        kind: "render",
        name: `farm.render.stream ${event.route}`,
        durationMs: event.durationMs,
      };
    case "middleware.complete":
      return {
        kind: "middleware",
        name: `farm.middleware ${event.name ?? event.route ?? "anonymous"}`,
        durationMs: event.durationMs,
      };
    case "api.request.complete":
    case "api.error":
      return {
        kind: "api",
        name: `farm.api ${event.method} ${event.route}`,
        durationMs: event.durationMs,
      };
    case "integration.api.call.complete":
      return {
        kind: "integration",
        name: `farm.integration ${event.integration}.${event.operation}`,
        durationMs: event.durationMs,
      };
    case "storage.query.complete":
      return {
        kind: "storage",
        name: `farm.storage ${event.operation}`,
        durationMs: event.durationMs,
      };
    case "ppr.refresh.complete":
      return {
        kind: "ppr",
        name: `farm.ppr.refresh ${event.route}`,
        durationMs: event.durationMs,
      };
    case "build.complete":
      return {
        kind: "build",
        name: `farm.build${event.target ? ` ${event.target}` : ""}`,
        durationMs: event.durationMs,
      };
    case "plugin.hook.complete":
      return {
        kind: "plugin",
        name: `farm.plugin ${event.plugin}.${event.hook}`,
        durationMs: event.durationMs,
      };
    default:
      return undefined;
  }
}

function toEventAttributes(event: FarmEvent): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(event)) {
    if (
      key === "timestamp" ||
      key === "level" ||
      key === "error" ||
      key === "traceId" ||
      key === "spanId" ||
      key === "traceSampled" ||
      value === undefined
    ) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[`farm.${key}`] = value;
    } else if (Array.isArray(value)) {
      if (value.every((entry) => typeof entry === "string")) {
        attributes[`farm.${key}`] = value as string[];
      } else if (value.every((entry) => typeof entry === "number")) {
        attributes[`farm.${key}`] = value as number[];
      } else if (value.every((entry) => typeof entry === "boolean")) {
        attributes[`farm.${key}`] = value as boolean[];
      }
    }
  }
  return attributes;
}

function getEventError(event: FarmEvent): unknown {
  return "error" in event ? event.error : undefined;
}

function recordSpanError(span: Span, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  span.recordException(normalized);
  span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
}

function setResponseStatus(span: Span, status: number): void {
  span.setAttribute("http.response.status_code", status);
  if (status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
}

function resolveResultStatus<T>(result: T, options: FarmRequestSpanOptions): number {
  if (result instanceof Response) return result.status;
  return options.getStatusCode?.() ?? 200;
}

function getSpanTraceContext(span: Span | undefined): FarmTraceContext | undefined {
  if (!span) return undefined;
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return undefined;
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceSampled: (spanContext.traceFlags & 0x01) === 0x01,
  };
}
