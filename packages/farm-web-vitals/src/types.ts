/** Options for the `webVitals()` server plugin. Only JSON-safe values travel
 * to the browser (see `packages/farm/src/client-plugin-build.ts`), so the
 * server plugin carries the beacon endpoint only. For an `onReport` callback,
 * register the collector from the app client entry instead — see
 * `webVitalsClient()` in `@farm.js/web-vitals/client`. */
export interface WebVitalsOptions {
  /** Endpoint receiving batched reports via `navigator.sendBeacon`. Omit it
   * (and `onReport`) to collect nothing — the plugin still subscribes to the
   * hook but drops every batch. */
  endpoint?: string;
}

/** Options for the client-side collector (see `@farm.js/web-vitals/client`).
 * This runs in the app's own client bundle, so a callback is fine here. */
export interface WebVitalsClientOptions {
  endpoint?: string;
  /** Called with each flushed per-route batch. Takes precedence over the
   * beacon endpoint when both are given. */
  onReport?: (report: WebVitalsReport) => void;
}

/** The JSON-safe subset of the options that crosses into the browser. */
export interface ResolvedWebVitalsOptions {
  endpoint?: string;
}

/** One flushed batch of web vitals for a single route. Values are
 * milliseconds except `cls`, which is the unitless layout-shift sum.
 * A metric is absent when no entry for it arrived before the flush. */
export interface WebVitalsReport {
  /** The route pathname the batch was collected for. */
  route: string;
  /** Latest largest-contentful-paint `startTime`. */
  lcp?: number;
  /** Summed `layout-shift` values with `hadRecentInput === false`. */
  cls?: number;
  /** Longest `event`-entry duration among entries with an `interactionId`. */
  inp?: number;
  /** `responseStart - startTime` of the navigation entry. */
  ttfb?: number;
  /** `Date.now()` at flush time. */
  collectedAt: number;
}

/** The browser runtime created by `createWebVitalsCollector`. */
export interface WebVitalsCollector {
  record(entry: PerformanceEntry, location: { pathname: string }): void;
  flush(): void;
  close(): void;
}
