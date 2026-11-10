# @farm.js/otel

OpenTelemetry setup for Farm.js applications on Node. `registerOTel()` starts the Node SDK with an
OTLP HTTP trace exporter and Node auto-instrumentation, and records Farm's own cache, PPR,
streaming, and middleware events as metrics and span events.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/otel
```

The OpenTelemetry SDK, exporter, and instrumentation packages are dependencies and install with it.
Keep `@farm.js/otel` in `dependencies` so the deployed server can load it. It needs Node.js 22.13
or newer.

## Usage

Start the SDK from the app's instrumentation file, `src/instrumentation.ts` or `instrumentation.ts`.
Farm calls `register` once before the development server or production runtime starts:

```ts
// src/instrumentation.ts
import type { FarmInstrumentationContext } from "@farm.js/core/instrumentation";

export async function register(context: FarmInstrumentationContext) {
  if (context.runtime !== "nodejs") return;

  const { registerOTel } = await import("@farm.js/otel");
  return registerOTel({
    serviceName: "storefront",
    serviceVersion: process.env.APP_VERSION,
  });
}
```

Returning the controller lets Farm shut the SDK down after active requests drain, so batched spans
are flushed. Keep the import inside the `nodejs` branch; edge and Bun runtimes need their own SDK.

The SDK only exports spans. Turn on Farm's request, render, middleware, and API spans as well:

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  observability: {
    tracing: true,
  },
});
```

## Environment

| Variable                              | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `OTEL_SERVICE_NAME`                   | Used when `serviceName` is not passed. Default `farm-app`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | Collector endpoint.                                        |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | A separate traces endpoint.                                |
| `OTEL_EXPORTER_OTLP_HEADERS`          | Exporter headers, such as an authorization token.          |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | A separate metrics endpoint.                               |
| `OTEL_METRICS_EXPORTER`               | Metrics exporter: `otlp`, `console`, or `none`.            |

## Farm metrics

| Instrument                          | Kind            | Attributes                                       |
| ----------------------------------- | --------------- | ------------------------------------------------ |
| `farm.cache.lookups`                | Counter         | `farm.cache.result`, `farm.cache.stale`          |
| `farm.cache.invalidations`          | Counter         | `farm.cache.operation`                           |
| `farm.cache.invalidated_entries`    | Counter         | `farm.cache.operation`                           |
| `farm.ppr.shell.lookups`            | Counter         | `farm.ppr.result`                                |
| `farm.ppr.refresh.duration`         | Histogram, `ms` |                                                  |
| `farm.render.stream.shell.duration` | Histogram, `ms` |                                                  |
| `farm.middleware.short_circuits`    | Counter         | `farm.route` (matcher), `farm.http.status_class` |

Metric attributes stay bounded; cache keys, tags, and request paths go on events on the active
span instead, and are not added twice when `observability.tracing` already writes them.

A metrics pipeline is registered only when `metricReaders` is passed or `OTEL_METRICS_EXPORTER`,
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, or `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so an app that only
asked for traces never waits on an unreachable metrics endpoint at shutdown. Without one the
instruments are no-ops. `OTEL_METRICS_EXPORTER=none` turns metrics off.

## Options

| Option                  | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `serviceName`           | `service.name` resource attribute.                         |
| `serviceVersion`        | `service.version` resource attribute.                      |
| `resourceAttributes`    | Extra resource attributes.                                 |
| `resource`              | A resource merged over the default one.                    |
| `exporter`              | Options for the default OTLP HTTP trace exporter.          |
| `traceExporter`         | A span exporter used instead of the OTLP one.              |
| `spanProcessors`        | Used instead of the default batch span processor.          |
| `sampler`               | Trace sampler.                                             |
| `autoInstrumentations`  | `false` turns off Node auto-instrumentation.               |
| `instrumentationConfig` | Configuration for the auto-instrumentations.               |
| `instrumentations`      | Used instead of the auto-instrumentations.                 |
| `metricReaders`         | Metric readers. Setting this enables metrics.              |
| `farmEvents`            | `false`, or `{ metrics, spanEvents }`. Both on by default. |

## Flushing and your own SDK

`registerOTel()` starts the SDK once per process and returns the same controller on later calls:
`{ sdk, forceFlush(), shutdown() }`. `forceFlushOTel()` and `shutdownOTel()` reach it from
anywhere. On hosts that freeze the process between requests, flush after the response:

```ts
import { after } from "@farm.js/core";
import { forceFlushOTel } from "@farm.js/otel";

after(() => forceFlushOTel());
```

An app that starts its own SDK can still record Farm's events. Call `recordFarmEvents()` after the
SDK has started, and call the dispose function it returns on shutdown. Its instruments use the meter
name exported as `FARM_EVENTS_METER_NAME`.

```ts
import { recordFarmEvents } from "@farm.js/otel";

const disposeFarmEvents = await recordFarmEvents({ spanEvents: false });
```

## Documentation

- [Observability and tracing](https://farmjs.dev/docs/observability)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
