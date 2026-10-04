---
title: "Blyp"
description: "Add request-scoped logging, trace propagation, and Farm lifecycle and browser telemetry with the community-maintained Blyp plugin."
section: "Plugin Ecosystem"
---

# Blyp

[Blyp](https://www.blyp.dev) is a community-maintained logging and telemetry plugin. It connects Farm's request lifecycle to request-scoped logs, trace propagation, and server and browser telemetry. The plugin is maintained by Blyp outside the Farm project; see the [Blyp Farm.js guide](https://www.blyp.dev/docs/integrations/farmjs) for its full configuration reference.

## Install

Add Blyp to an existing Farm application:

```bash
pnpm add @blyp/core
```

The Farm adapter supports Node.js and Bun runtimes. Blyp's server logger and connector lifecycle require these runtimes; known edge-only presets fail during configuration.

## Register the plugin

Register `blypPlugin()` once in `farm.config.ts`. Append it to your existing plugins:

```ts
import { defineConfig } from "@farm.js/core";
import { blypPlugin } from "@blyp/core/farmjs";

export default defineConfig({
  plugins: [
    blypPlugin({
      level: "info",
      telemetry: {
        events: "curated",
        browser: {
          sampleRate: 0.1,
        },
      },
    }),
  ],
});
```

Blyp automatically logs successful requests, error responses, and thrown errors. It preserves the response body and existing headers and adds an `x-blyp-trace-id` response header.

## Log inside server routes

Use the request-aware `logger` from `@blyp/core/farmjs` in a server API route such as `src/app/api/health/route.ts`:

```ts
import { logger } from "@blyp/core/farmjs";

export async function GET() {
  logger.info("health check completed");

  return Response.json({ ok: true });
}
```

The logger uses the active request context in pages, API routes, middleware, and server actions. Outside a request, it falls back to the logger configured by the plugin. Keep this import in server code.

Child loggers and structured logs retain the request trace and authentication context. Emitting a structured log with `logger.createStructuredLog()` suppresses the automatic HTTP record for that request. See [Blyp's guide](https://www.blyp.dev/docs/integrations/farmjs) for structured logging examples.

## Request traces

Blyp selects the request trace ID from the incoming Blyp trace header, then an active Farm or OpenTelemetry trace ID, then a newly generated ID. The default propagation and response header is `x-blyp-trace-id`; use `traceHeader` to select another header:

```ts
blypPlugin({
  traceHeader: "x-request-trace",
});
```

Only the trace ID is exposed to Farm page props. The scoped logger and authentication data stay in Farm's private request store.

## Lifecycle telemetry

Use `telemetry.events` to choose which Farm observability events Blyp forwards:

| Value             | Behavior                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `"curated"`       | The default: server and build milestones, route generation summaries, validation failures, not-found events, warnings, and framework errors. |
| `"all"`           | Every non-request Farm event.                                                                                                                |
| `FarmEventType[]` | Only the specified Farm event types.                                                                                                         |
| `false`           | Disable Farm event forwarding.                                                                                                               |

Farm `request.*` events are excluded because Blyp's request hooks already emit HTTP records. Setting `telemetry.events: false` leaves browser telemetry enabled; set `telemetry: false` to disable both lifecycle and browser telemetry while retaining HTTP request logging.

## Browser telemetry

Browser telemetry is enabled by default. It captures completed hydration, rendered navigations, navigation failures, browser errors, unhandled rejections, and allowlisted performance entries.

Non-error events are sampled once per page session: development uses a 100% sample rate and production defaults to 10%. Errors and navigation failures are never sampled out.

To disable browser telemetry while retaining server lifecycle events:

```ts
blypPlugin({
  telemetry: {
    events: "curated",
    browser: false,
  },
});
```

The plugin handles the configured client-ingestion endpoint directly, so no separate Farm API route is required. Browser telemetry excludes request bodies, query values, URL hashes, page data, document titles, referrers, route parameters, and arbitrary performance resource URLs. See the [upstream guide](https://www.blyp.dev/docs/integrations/farmjs) for ingestion, connectors, and enrichment options.

## Verify the setup

Start your application and request `/api/health`. Confirm the response contains `x-blyp-trace-id`, your application log appears, and Blyp emits one automatic HTTP record with the request's method, status, duration, and trace ID.

If HTTP records appear twice, check that `blypPlugin()` is registered only once and that you are not also manually logging the request summary. An emitted structured request log replaces the automatic HTTP record.

To remove the plugin, remove its registration from `farm.config.ts` and any Blyp logger imports or custom client telemetry wiring.
