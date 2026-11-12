# `@farm.js/web-vitals`

Web vitals reporting (LCP / CLS / INP / TTFB) for Farm.js client navigations,
batched per route.

Core already runs `PerformanceObserver`s for navigation, paint,
largest-contentful-paint, layout-shift, and event timing and feeds the client
plugin `performance` hook — this package consumes that hook. It creates zero
new observers and does not duplicate farm-hints (which runs its own `resource`
observer for third-party scans).

```bash
pnpm add @farm.js/web-vitals
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { webVitals } from "@farm.js/web-vitals";

export default defineConfig({
  plugins: [webVitals({ endpoint: "/__farm/vitals" })],
});
```

## Options

| Option     | Default | Description                                                          |
| ---------- | ------- | -------------------------------------------------------------------- |
| `endpoint` | —       | Reports are sent with `navigator.sendBeacon` to this URL. Omit it to collect nothing. |

A batch holds one route's metrics and flushes when the route changes, when a
navigation starts, and when the page closes. A metric is absent from a batch
when no entry for it arrived before the flush. With no endpoint configured the
batch is dropped silently — telemetry never breaks the app.

- **LCP** — the latest `largest-contentful-paint` `startTime`.
- **CLS** — summed `layout-shift` values with `hadRecentInput === false`.
- **INP** — the longest `event`-entry duration among entries with an
  `interactionId` (the standard max-duration approximation).
- **TTFB** — `responseStart - startTime` of the navigation entry.

## `onReport` callback

Callbacks cannot cross the server-plugin boundary (client plugin `public`
data must be JSON-safe), so `webVitals()` rejects `onReport`. Register the
collector from the app client entry instead, where the module is bundled with
the app:

```ts
// src/client.ts
import { defineClient } from "@farm.js/core/client";
import { webVitalsClient } from "@farm.js/web-vitals/client";

export default defineClient(
  webVitalsClient({ onReport: (report) => console.info(report) }),
);
```

`onReport` takes precedence over the beacon endpoint when both are given.
