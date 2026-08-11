---
title: "Observability and tracing"
description: "Export OpenTelemetry traces and listen to correlated Farm runtime events in development and production."
section: "Runtime"
---

# Observability and tracing

Farm has two complementary observability layers:

- OpenTelemetry traces show the request timeline and export to any OTLP-compatible backend.
- Farm events expose detailed framework lifecycle data for logs, alerts, and custom integrations.

The same lifecycle events are attached to the active OpenTelemetry span, and delivered events include `traceId`, `spanId`, and `traceSampled` for correlation.

## OpenTelemetry quick start

Install Farm's optional Node SDK setup package:

```bash
pnpm add @farm.js/otel
```

Create one instrumentation file at `src/instrumentation.ts` or `instrumentation.ts`:

```ts
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

Enable Farm spans in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  observability: {
    tracing: {
      attributes: {
        "deployment.environment": process.env.NODE_ENV ?? "development",
      },
    },
  },
});
```

`@farm.js/otel` uses the OTLP HTTP trace exporter by default. Configure the destination with standard OpenTelemetry environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer%20TOKEN"
```

Use `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` when traces need a different endpoint. You can also pass a custom `traceExporter`, `spanProcessors`, sampler, resource, or instrumentation list to `registerOTel`.

Both pieces are intentional: `instrumentation.ts` starts an SDK/exporter, while `observability.tracing` tells Farm to create framework spans. Without an SDK, the OpenTelemetry API remains a no-op.

## What Farm traces

| Span                                      | Meaning                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /products/:id`                       | Server request span with method, route, path, status, and propagated context. |
| `farm.render /products/:id`               | Completed page render.                                                        |
| `farm.middleware auth`                    | Completed middleware execution.                                               |
| `farm.api POST /api/products`             | Completed API route execution.                                                |
| `farm.integration stripe.checkout.create` | Completed integration operation when that event is emitted.                   |
| `farm.storage query`                      | Completed integration database operation when that event is emitted.          |
| `farm.ppr.refresh /dashboard`             | Completed PPR refresh.                                                        |
| `farm.plugin plugin.hook`                 | Completed plugin hook when that event is emitted.                             |

Incoming W3C `traceparent` headers are extracted automatically. A matched Farm route renames the request span from the raw pathname to the route pattern and sets `http.route`. Status codes of 500 or higher and thrown errors mark spans as errors.

To wrap application work in a typed Farm-aware child span:

```ts
import { runWithFarmSpan } from "@farm.js/core/observability";

const result = await runWithFarmSpan(
  "catalog.recommendations",
  () => loadRecommendations(productId),
  {
    kind: "integration",
    attributes: { "product.id": productId },
  },
);
```

Use `getFarmTraceContext()` when a log or provider call needs the current trace and span IDs.

## Instrumentation lifecycle

Farm calls `register(context)` once before the development server or production request runtime starts. The context contains:

- `mode`: `development`, `production`, or `test`
- `runtime`: `nodejs`, `edge`, or `bun`
- `root`: the runtime working directory

`register` may return a cleanup function or an object with `shutdown()`. An exported `shutdown()` function is also supported. Farm runs cleanup during development server close and production graceful shutdown, after active requests drain, so batched spans are flushed before the process exits.

Keep Node-only SDK imports inside the `runtime === "nodejs"` branch. Edge and Bun deployments can initialize a runtime-compatible OpenTelemetry SDK in their own branch without changing Farm's tracing API.

## Subscribe to events

**farm.config.ts**

```ts
import { onFarmEvent } from "@farm.js/core/observability";

onFarmEvent((event) => {
  if (event.level === "error") {
    console.error("[farm]", event.type, event);
  }
});
```

## Event families

| Family               | Examples                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| Request              | request.start, request.complete, request.error                                   |
| Server               | server.start, server.ready, server.shutdown                                      |
| Routing              | route.discovered, route.matched, route.notFound, route.redirect                  |
| Rendering            | render.start, render.complete, render.stream.shellReady, render.error            |
| Cache                | cache.hit, cache.miss, cache.set, cache.revalidateTag                            |
| PPR                  | ppr.shell.hit, ppr.shell.cached, ppr.shell.invalidated                           |
| Middleware           | middleware.start, middleware.complete, middleware.shortCircuit, middleware.error |
| Integrations         | integration.ready, integration.api.call.start, integration.webhook.verified      |
| Integration database | storage.query.start, storage.schema.ready                                        |
| Build                | build.start, routes.generated, types.generated, manifest.generated               |

The `storage.query.*` and `storage.schema.*` event names are compatibility identifiers for integration database activity. They do not describe `getStorage()` KV operations.

## Configure in farm.config.ts

Use config-level observability when an app should log or forward events from startup.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  observability: {
    logs: true,
    tracing: true,
    events: ["cache.hit", "cache.miss", "ppr.shell.cached"],
    onEvent(event) {
      if (event.type === "cache.miss") {
        console.log("Cache miss", event.key, event.reason);
      }
    },
  },
});
```

`events` is optional. Leave it out to receive every emitted event. Filtering event delivery does not disable span creation or the events recorded on active spans.

## Runtime subscription

Use `onFarmEvent` for tests, local debugging, or integration packages that want to register listeners without owning app config.

```ts
import { onFarmEvent } from "@farm.js/core/observability";

const unsubscribe = onFarmEvent((event) => {
  if (event.type === "integration.webhook.failed") {
    console.error(event.integration, event.reason);
  }
});

unsubscribe();
```

## Useful event types

| Area                 | Events                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache                | `cache.hit`, `cache.miss`, `cache.set`, `cache.stale`, `cache.bypass`, `cache.invalidated`, `cache.revalidatePath`, `cache.revalidateTag`, `cache.updateTag`, `cache.error`                                                        |
| PPR                  | `ppr.shell.hit`, `ppr.shell.miss`, `ppr.shell.cached`, `ppr.shell.bypass`, `ppr.shell.invalidated`, `ppr.suspense.holeDetected`, `ppr.refresh.start`, `ppr.refresh.complete`, `ppr.refresh.error`                                  |
| API                  | `api.request.start`, `api.request.complete`, `api.validation.failed`, `api.error`                                                                                                                                                  |
| Integrations         | `integration.registered`, `integration.config.validated`, `integration.ready`, `integration.disposed`, `integration.api.call.start`, `integration.api.call.complete`, `integration.webhook.verified`, `integration.webhook.failed` |
| Middleware           | `middleware.start`, `middleware.complete`, `middleware.shortCircuit`, `middleware.error`                                                                                                                                           |
| Integration database | `storage.query.start`, `storage.query.complete`, `storage.query.error`, `storage.schema.ready`, `storage.schema.error`                                                                                                             |

Middleware events include the matched middleware route, request pathname, middleware file/config name, duration for completes, status for short circuits, and the thrown error for failures.

## Middleware event payloads

Middleware events are emitted for both `farm.config.ts` middleware entries and `src/app/**/middleware.ts` files in development and production.

| Event                     | Payload                                   |
| ------------------------- | ----------------------------------------- |
| `middleware.start`        | `route`, `pathname`, `name`               |
| `middleware.complete`     | `route`, `pathname`, `name`, `durationMs` |
| `middleware.shortCircuit` | `route`, `pathname`, `name`, `status`     |
| `middleware.error`        | `route`, `pathname`, `name`, `error`      |

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  observability: {
    onEvent(event) {
      if (event.type === "middleware.shortCircuit") {
        console.log(event.pathname, event.status);
      }
    },
  },
});
```

## Production notes

- Keep `@farm.js/otel` in `dependencies`, not `devDependencies`, so it is available in the deployed server bundle.
- Set `OTEL_SERVICE_NAME` or pass `serviceName` explicitly; use deployment/version resource attributes for release comparisons.
- Farm's production lifecycle waits for active requests and then shuts down instrumentation, allowing the batch processor to flush.
- Filter high-volume events before shipping them to a log drain.
- Use the emitted trace and span IDs to correlate Farm events with application logs.
- Treat event payloads as operational metadata; do not put secrets in event fields.
- Watch `api.validation.failed`, `integration.webhook.failed`, `cache.error`, and `ppr.refresh.error` in production.
