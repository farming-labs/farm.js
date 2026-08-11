import type { Attributes } from "@opentelemetry/api";
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

export async function registerOTel(options: FarmOTelOptions = {}): Promise<FarmOTelController> {
  const state = getGlobalState();
  if (state.controller) return state.controller;
  if (state.initializing) return state.initializing;

  state.initializing = Promise.resolve()
    .then(() => {
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
      const sdk = new NodeSDK({
        resource,
        sampler: options.sampler,
        spanProcessors,
        instrumentations,
      });
      sdk.start();

      let shutdownPromise: Promise<void> | undefined;
      const controller: FarmOTelController = {
        sdk,
        async forceFlush() {
          await Promise.all(spanProcessors.map((processor) => processor.forceFlush()));
        },
        shutdown() {
          if (!shutdownPromise) {
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
