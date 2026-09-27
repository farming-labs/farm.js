import { metrics, type Attributes } from "@opentelemetry/api";
import {
  getNodeAutoInstrumentations,
  type InstrumentationConfigMap,
} from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  type Sampler,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { recordFarmEvents, type FarmEventMappingOptions } from "./farm-events.js";

export { FARM_EVENTS_METER_NAME, recordFarmEvents } from "./farm-events.js";
export type { FarmEventMappingOptions } from "./farm-events.js";

export interface FarmOTelOptions {
  serviceName?: string;
  serviceVersion?: string;
  resource?: Resource;
  resourceAttributes?: Attributes;
  traceExporter?: SpanExporter;
  exporter?: ConstructorParameters<typeof OTLPTraceExporter>[0];
  spanProcessors?: SpanProcessor[];
  sampler?: Sampler;
  autoInstrumentations?: boolean;
  instrumentationConfig?: InstrumentationConfigMap;
  instrumentations?: Array<Instrumentation | Instrumentation[]>;
  /**
   * Metric readers to export with. Farm registers a meter provider only when
   * this is set or `OTEL_METRICS_EXPORTER` names an exporter, so an app that
   * only asked for traces never gets a metrics pipeline it did not configure.
   */
  metricReaders?: NonNullable<ConstructorParameters<typeof NodeSDK>[0]>["metricReaders"];
  /**
   * Record Farm's own cache, PPR, streaming and middleware events as metrics
   * and span events. Enabled by default; auto-instrumentation only sees generic
   * HTTP, filesystem and database work, so without this everything the
   * framework knows about itself is dropped.
   *
   * Pass `false` to leave Farm's event bus unsubscribed, or an object to record
   * only metrics or only span events.
   */
  farmEvents?: boolean | FarmEventMappingOptions;
}

export interface FarmOTelController {
  sdk: NodeSDK;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface FarmOTelGlobalState {
  controller?: FarmOTelController;
  initializing?: Promise<FarmOTelController>;
}

const FARM_OTEL_STATE = Symbol.for("@farm.js/otel/state");

function getGlobalState(): FarmOTelGlobalState {
  const target = globalThis as typeof globalThis & {
    [FARM_OTEL_STATE]?: FarmOTelGlobalState;
  };
  return (target[FARM_OTEL_STATE] ??= {});
}

function resolveFarmEventOptions(
  option: FarmOTelOptions["farmEvents"],
): FarmEventMappingOptions | undefined {
  if (option === false) return undefined;
  if (option === undefined || option === true) return {};
  return option;
}

export async function registerOTel(options: FarmOTelOptions = {}): Promise<FarmOTelController> {
  const state = getGlobalState();
  if (state.controller) return state.controller;
  if (state.initializing) return state.initializing;

  state.initializing = Promise.resolve()
    .then(async () => {
      const defaultResource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? "farm-app",
        ...(options.serviceVersion ? { [ATTR_SERVICE_VERSION]: options.serviceVersion } : {}),
        ...options.resourceAttributes,
      });
      const resource = options.resource ? defaultResource.merge(options.resource) : defaultResource;
      const spanProcessors = options.spanProcessors ?? [
        new BatchSpanProcessor(options.traceExporter ?? new OTLPTraceExporter(options.exporter)),
      ];
      const instrumentations =
        options.instrumentations ??
        (options.autoInstrumentations === false
          ? []
          : [getNodeAutoInstrumentations(options.instrumentationConfig)]);
      // Left unset, the Node SDK falls back to a periodic OTLP metrics pipeline
      // pointed at localhost:4318. With nothing listening there, the first
      // recorded metric turns graceful shutdown into the exporter's retry window
      // (measured at ~8s), and farm's production lifecycle waits on
      // instrumentation shutdown, so that is a stalled deploy.
      //
      // An empty reader list keeps the meter provider unregistered, which turns
      // metrics off entirely, so it may only be the default when the app has
      // pointed nothing at a collector. `OTEL_METRICS_EXPORTER` alone is not that
      // signal: the spec already defaults it to `otlp`, so the ordinary
      // production posture is to set an endpoint and leave the exporter variable
      // alone. Treat any configured OTLP metrics destination as the opt-in, and
      // leave `OTEL_METRICS_EXPORTER=none` as the documented way to turn metrics
      // off.
      const metricsDestinationConfigured = Boolean(
        process.env.OTEL_METRICS_EXPORTER ||
        process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      );
      const metricReaders =
        options.metricReaders ?? (metricsDestinationConfigured ? undefined : []);
      const sdk = new NodeSDK({
        resource,
        sampler: options.sampler,
        spanProcessors,
        instrumentations,
        metricReaders,
      });
      sdk.start();

      // After `start`, because the metrics API has no proxy provider: an
      // instrument created before the SDK registers its meter provider stays a
      // no-op for the life of the process.
      const farmEventOptions = resolveFarmEventOptions(options.farmEvents);
      const disposeFarmEvents = farmEventOptions
        ? await recordFarmEvents(farmEventOptions)
        : undefined;

      let shutdownPromise: Promise<void> | undefined;
      const controller: FarmOTelController = {
        sdk,
        async forceFlush() {
          await Promise.all(spanProcessors.map((processor) => processor.forceFlush()));
          // Serverless runtimes freeze the process between requests, so the
          // periodic metric reader never gets to export on its own. The API type
          // has no `forceFlush`, so reach for the SDK's when it is there.
          const meterProvider = metrics.getMeterProvider() as {
            forceFlush?: () => Promise<void>;
          };
          try {
            await meterProvider.forceFlush?.();
          } catch (error) {
            // A metrics exporter must not fail the response it was flushed for.
            console.warn(
              `[farm:otel] metric flush failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        shutdown() {
          if (!shutdownPromise) {
            // Stop feeding instruments before the providers go away, and so a
            // development restart does not stack bus subscribers.
            disposeFarmEvents?.();
            shutdownPromise = sdk.shutdown().finally(() => {
              state.controller = undefined;
              state.initializing = undefined;
            });
          }
          return shutdownPromise;
        },
      };
      state.controller = controller;
      return controller;
    })
    .catch((error) => {
      state.initializing = undefined;
      throw error;
    });

  return state.initializing;
}

export async function forceFlushOTel(): Promise<void> {
  const state = getGlobalState();
  const controller = state.controller ?? (await state.initializing);
  await controller?.forceFlush();
}

export async function shutdownOTel(): Promise<void> {
  const state = getGlobalState();
  const controller = state.controller ?? (await state.initializing);
  await controller?.shutdown();
}
