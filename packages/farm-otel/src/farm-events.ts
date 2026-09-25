import {
  metrics as metricsApi,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type MeterProvider,
  type Span,
} from "@opentelemetry/api";
import type { FarmEvent } from "@farm.js/core/observability";

/** Instrumentation scope shared by every instrument created here. */
export const FARM_EVENTS_METER_NAME = "@farm.js/otel";

export interface FarmEventMappingOptions {
  /** Record counters and histograms for mapped events. Defaults to `true`. */
  metrics?: boolean;
  /** Add mapped events to the active span. Defaults to `true`. */
  spanEvents?: boolean;
  /**
   * Meter provider the instruments are created from. Defaults to the globally
   * registered provider, which only becomes real once an SDK has started, so
   * instruments must be created after `sdk.start()`.
   */
  meterProvider?: MeterProvider;
}

interface FarmEventInstruments {
  cacheLookups: Counter;
  cacheInvalidations: Counter;
  cacheInvalidatedEntries: Counter;
  pprShellLookups: Counter;
  pprRefreshDuration: Histogram;
  shellDuration: Histogram;
  middlewareShortCircuits: Counter;
}

const CACHE_LOOKUP_RESULTS = {
  "cache.hit": "hit",
  "cache.miss": "miss",
  "cache.stale": "stale",
  "cache.dedupe": "dedupe",
  "cache.bypass": "bypass",
} as const;

const CACHE_INVALIDATION_OPERATIONS = {
  "cache.revalidateTag": "revalidateTag",
  "cache.updateTag": "updateTag",
  "cache.revalidatePath": "revalidatePath",
  "cache.invalidated": "invalidated",
} as const;

const PPR_SHELL_RESULTS = {
  "ppr.shell.hit": "hit",
  "ppr.shell.miss": "miss",
  "ppr.shell.cached": "cached",
  "ppr.shell.bypass": "bypass",
  "ppr.shell.invalidated": "invalidated",
} as const;

/**
 * Subscribes to Farm's observability bus and records the framework's own cache,
 * PPR, streaming and middleware signals as OpenTelemetry metrics plus events on
 * the active span.
 *
 * Metric attributes are deliberately limited to bounded values. A cache `key`
 * embeds the serialized arguments of the cached call and a `tag` is authored at
 * runtime, so neither is ever used as a metric attribute; per-request detail
 * stays on span events, where high cardinality is free.
 *
 * Returns a dispose function. Call it during shutdown so a development restart
 * does not stack subscribers.
 */
export async function recordFarmEvents(options: FarmEventMappingOptions = {}): Promise<() => void> {
  const recordMetrics = options.metrics !== false;
  const recordSpanEvents = options.spanEvents !== false;
  if (!recordMetrics && !recordSpanEvents) return () => {};

  let subscribe: typeof import("@farm.js/core/observability").onFarmEvent;
  try {
    // Imported lazily: `registerOTel` runs from `instrumentation.ts` before the
    // application loads, so the pre-start module graph stays limited to the SDK,
    // and a core that cannot be resolved costs telemetry rather than the server.
    ({ onFarmEvent: subscribe } = await import("@farm.js/core/observability"));
  } catch (error) {
    console.warn(
      `[farm:otel] farm events are unavailable, continuing without them: ${describe(error)}`,
    );
    return () => {};
  }

  let instruments: FarmEventInstruments | undefined;
  if (recordMetrics) {
    try {
      const provider = options.meterProvider ?? metricsApi.getMeterProvider();
      instruments = createFarmEventInstruments(provider.getMeter(FARM_EVENTS_METER_NAME));
    } catch (error) {
      // A meter provider that cannot hand out instruments must not stop the
      // server from starting.
      console.warn(
        `[farm:otel] failed to create farm metrics, continuing without them: ${describe(error)}`,
      );
    }
  }
  if (!instruments && !recordSpanEvents) return () => {};

  let warned = false;
  return subscribe(
    (event) => {
      try {
        handleFarmEvent(event, instruments, recordSpanEvents);
      } catch (error) {
        // Telemetry must never reach the emitting request. Warn once, because the
        // failing event families are emitted on hot paths.
        if (warned) return;
        warned = true;
        console.warn(`[farm:otel] failed to record farm events: ${describe(error)}`);
      }
    },
    // `observability.events` narrows which events reach application handlers and
    // logs. Instruments are not a log drain, and Farm already records span
    // events regardless of that filter, so the mapping stays consistent with it.
    { unfiltered: true },
  );
}

function createFarmEventInstruments(meter: Meter): FarmEventInstruments {
  return {
    cacheLookups: meter.createCounter("farm.cache.lookups", {
      description: "Farm cache lookups by outcome.",
      unit: "{lookup}",
    }),
    cacheInvalidations: meter.createCounter("farm.cache.invalidations", {
      description: "Farm cache invalidation operations by kind.",
      unit: "{invalidation}",
    }),
    cacheInvalidatedEntries: meter.createCounter("farm.cache.invalidated_entries", {
      description: "Cache entries removed by Farm cache invalidations.",
      unit: "{entry}",
    }),
    pprShellLookups: meter.createCounter("farm.ppr.shell.lookups", {
      description: "Partial prerender shell lookups by outcome.",
      unit: "{lookup}",
    }),
    pprRefreshDuration: meter.createHistogram("farm.ppr.refresh.duration", {
      description: "Duration of completed partial prerender shell refreshes.",
      unit: "ms",
    }),
    shellDuration: meter.createHistogram("farm.render.stream.shell.duration", {
      description: "Time from stream start to streaming shell ready.",
      unit: "ms",
    }),
    middlewareShortCircuits: meter.createCounter("farm.middleware.short_circuits", {
      description: "Requests answered by middleware before reaching a route.",
      unit: "{short_circuit}",
    }),
  };
}

function handleFarmEvent(
  event: FarmEvent,
  instruments: FarmEventInstruments | undefined,
  recordSpanEvents: boolean,
): void {
  const record = event as unknown as Record<string, unknown>;

  switch (event.type) {
    case "cache.hit":
    case "cache.miss":
    case "cache.stale":
    case "cache.dedupe":
    case "cache.bypass": {
      const result = CACHE_LOOKUP_RESULTS[event.type];
      const stale = event.type === "cache.hit" && event.stale === true;
      const attributes: Attributes = { "farm.cache.result": result };
      if (stale) attributes["farm.cache.stale"] = true;
      instruments?.cacheLookups.add(1, attributes);
      const span = spanForEvent(event, recordSpanEvents);
      if (!span) return;
      const spanAttributes: Attributes = { ...attributes };
      copyAttribute(spanAttributes, "farm.route", record.route);
      copyAttribute(spanAttributes, "farm.pathname", record.pathname);
      copyAttribute(spanAttributes, "farm.tags", record.tags);
      copyAttribute(spanAttributes, "farm.reason", record.reason);
      copyAttribute(spanAttributes, "farm.revalidate", record.revalidate);
      span.addEvent(event.type, spanAttributes, event.timestamp);
      return;
    }

    case "cache.revalidateTag":
    case "cache.updateTag":
    case "cache.revalidatePath":
    case "cache.invalidated": {
      const operation = CACHE_INVALIDATION_OPERATIONS[event.type];
      const attributes: Attributes = { "farm.cache.operation": operation };
      instruments?.cacheInvalidations.add(1, attributes);
      const count = record.count;
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        instruments?.cacheInvalidatedEntries.add(count, attributes);
      }
      const span = spanForEvent(event, recordSpanEvents);
      if (!span) return;
      const spanAttributes: Attributes = { ...attributes };
      copyAttribute(spanAttributes, "farm.route", record.route);
      copyAttribute(spanAttributes, "farm.tag", record.tag);
      copyAttribute(spanAttributes, "farm.path", record.path);
      copyAttribute(spanAttributes, "farm.reason", record.reason);
      copyAttribute(spanAttributes, "farm.count", count);
      span.addEvent(event.type, spanAttributes, event.timestamp);
      return;
    }

    case "ppr.shell.hit":
    case "ppr.shell.miss":
    case "ppr.shell.cached":
    case "ppr.shell.bypass":
    case "ppr.shell.invalidated": {
      const result = PPR_SHELL_RESULTS[event.type];
      const attributes: Attributes = { "farm.ppr.result": result };
      instruments?.pprShellLookups.add(1, attributes);
      const span = spanForEvent(event, recordSpanEvents);
      if (!span) return;
      const spanAttributes: Attributes = { ...attributes };
      copyAttribute(spanAttributes, "farm.route", record.route);
      copyAttribute(spanAttributes, "farm.reason", record.reason);
      copyAttribute(spanAttributes, "farm.revalidate", record.revalidate);
      copyAttribute(spanAttributes, "farm.count", record.count);
      span.addEvent(event.type, spanAttributes, event.timestamp);
      return;
    }

    case "ppr.refresh.complete": {
      instruments?.pprRefreshDuration.record(event.durationMs);
      const span = spanForEvent(event, recordSpanEvents);
      if (!span) return;
      const spanAttributes: Attributes = { "farm.durationMs": event.durationMs };
      copyAttribute(spanAttributes, "farm.route", record.route);
      span.addEvent(event.type, spanAttributes, event.timestamp);
      return;
    }

    case "render.stream.shellReady": {
      instruments?.shellDuration.record(event.durationMs);
      const span = spanForEvent(event, recordSpanEvents);
      if (!span) return;
      const spanAttributes: Attributes = { "farm.durationMs": event.durationMs };
      copyAttribute(spanAttributes, "farm.route", record.route);
      span.addEvent(event.type, spanAttributes, event.timestamp);
      return;
    }

    case "middleware.shortCircuit": {
      const attributes: Attributes = {};
      // A middleware `route` is the configured matcher, not the request path,
      // so unlike every other family here it is bounded by the application's
      // own middleware list and is safe to keep on the counter.
      copyAttribute(attributes, "farm.route", record.route);
      const statusClass = toStatusClass(event.status);
      if (statusClass) attributes["farm.http.status_class"] = statusClass;
      instruments?.middlewareShortCircuits.add(1, attributes);
      const span = spanForEvent(event, recordSpanEvents);
      if (!span) return;
      const spanAttributes: Attributes = { ...attributes };
      copyAttribute(spanAttributes, "farm.pathname", record.pathname);
      copyAttribute(spanAttributes, "farm.name", record.name);
      copyAttribute(spanAttributes, "farm.status", event.status);
      span.addEvent(event.type, spanAttributes, event.timestamp);
      return;
    }

    default:
      return;
  }
}

/**
 * The span a mapped event should be recorded on, if any. Resolved before the
 * attributes are collected so the common case, an event emitted with no
 * recording span active, costs nothing.
 */
function spanForEvent(event: FarmEvent, recordSpanEvents: boolean): Span | undefined {
  if (!recordSpanEvents) return undefined;
  // Farm's own tracing layer already writes every event onto the active span
  // when `observability.tracing` is enabled, and stamps the event with the span
  // it recorded against. Adding a second copy here would duplicate the trace.
  if (event.spanId) return undefined;
  const span = trace.getActiveSpan();
  return span?.isRecording() ? span : undefined;
}

function copyAttribute(target: Attributes, name: string, value: unknown): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    target[name] = value;
    return;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    target[name] = [...(value as string[])];
  }
}

function toStatusClass(status: number | undefined): string | undefined {
  if (typeof status !== "number" || !Number.isFinite(status)) return undefined;
  if (status < 100 || status > 599) return undefined;
  return `${Math.floor(status / 100)}xx`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
