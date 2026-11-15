---
title: "Web Vitals"
description: "Report LCP, CLS, INP, and TTFB per route from the performance entries core already observes, batched and sent with navigator.sendBeacon."
section: "Plugin Ecosystem"
---

# Web Vitals

`@farm.js/web-vitals` reports web vitals (LCP / CLS / INP / TTFB) per route, batched
and sent with `navigator.sendBeacon`. Core already runs `PerformanceObserver`s for
navigation, paint, largest-contentful-paint, layout-shift, and event timing and feeds
the client plugin `performance` hook — this package consumes that hook. It creates
zero new observers and does not duplicate farm-hints (which runs its own `resource`
observer for third-party scans).

## Install

```bash
pnpm add @farm.js/web-vitals
```

## Complete example

Register the plugin once in Farm config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { webVitals } from "@farm.js/web-vitals";

export default defineConfig({
  plugins: [webVitals({ endpoint: "/__farm/vitals" })],
});
```

A batch holds one route's metrics and flushes when the route changes, when a
navigation starts, and when the page closes.

## Options

```ts
webVitals({
  endpoint: "/__farm/vitals",
});
```

| Option     | Default | Description                                                                           |
| ---------- | ------- | ------------------------------------------------------------------------------------- |
| `endpoint` | —       | Reports are sent with `navigator.sendBeacon` to this URL. Omit it to collect nothing. |

## Behavior

- **LCP** — the latest `largest-contentful-paint` `startTime`.
- **CLS** — summed `layout-shift` values with `hadRecentInput === false`.
- **INP** — the longest `event`-entry duration among entries with an
  `interactionId` (the standard max-duration approximation).
- **TTFB** — `responseStart - startTime` of the navigation entry.
- A metric is absent from a batch when no entry for it arrived before the flush.
- With no endpoint configured the batch is dropped silently — telemetry never
  breaks the app.

## `onReport` callback

Callbacks cannot cross the server-plugin boundary (client plugin `public`
data must be JSON-safe), so `webVitals()` rejects `onReport`. Register the
collector from the app client entry instead, where the module is bundled with
the app:

```ts
// src/client.ts
import { defineClient } from "@farm.js/core/client";
import { webVitalsClient } from "@farm.js/web-vitals/client";

export default defineClient(webVitalsClient({ onReport: (report) => console.info(report) }));
```

`onReport` takes precedence over the beacon endpoint when both are given.
