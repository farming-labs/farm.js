import type { WebVitalsClientOptions, WebVitalsCollector, WebVitalsReport } from "./types.js";

export interface WebVitalsCollectorOptions extends WebVitalsClientOptions {
  /** Test seam for `navigator.sendBeacon`. Defaults to the global
   * `navigator.sendBeacon` when available. */
  beacon?: (url: string, data: string) => boolean;
  /** Test seam for the `collectedAt` timestamp. Defaults to `Date.now`. */
  now?: () => number;
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface NavigationEntry extends PerformanceEntry {
  responseStart: number;
}

interface EventEntry extends PerformanceEntry {
  interactionId?: number;
}

/**
 * Collect web vitals from the entries the core client plugin manager already
 * observes (`navigation`, `paint`, `largest-contentful-paint`, `layout-shift`,
 * `event` — see `FarmClientPluginManager.installPerformanceObservers`) and
 * batch them per route. Creates zero observers of its own.
 *
 * A batch flushes when the route changes (the next `record()` for a different
 * pathname), when `flush()` is called (navigation / page close), or on
 * `close()`. The sink is `onReport` when given, else `navigator.sendBeacon`
 * to `endpoint` when both are set; with neither configured the batch is
 * dropped silently — telemetry must never break the app.
 */
export function createWebVitalsCollector(
  options: WebVitalsCollectorOptions = {},
): WebVitalsCollector {
  const { endpoint, onReport } = options;
  const beacon =
    options.beacon ??
    (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? navigator.sendBeacon.bind(navigator)
      : undefined);
  const now = options.now ?? Date.now;

  let route: string | null = null;
  let lcp: number | undefined;
  let cls: number | undefined;
  let inp: number | undefined;
  let ttfb: number | undefined;
  let hasData = false;

  function reset(): void {
    lcp = undefined;
    cls = undefined;
    inp = undefined;
    ttfb = undefined;
    hasData = false;
  }

  function flush(): void {
    if (!hasData || route === null) return;
    const report: WebVitalsReport = {
      route,
      ...(lcp !== undefined ? { lcp } : {}),
      ...(cls !== undefined ? { cls } : {}),
      ...(inp !== undefined ? { inp } : {}),
      ...(ttfb !== undefined ? { ttfb } : {}),
      collectedAt: now(),
    };
    reset();
    if (onReport) {
      onReport(report);
      return;
    }
    if (endpoint && beacon) {
      try {
        beacon(endpoint, JSON.stringify(report));
      } catch {
        // A failed beacon must never surface to the app.
      }
    }
  }

  function record(entry: PerformanceEntry, location: { pathname: string }): void {
    if (route !== location.pathname) {
      flush();
      route = location.pathname;
    }
    switch (entry.entryType) {
      case "largest-contentful-paint": {
        // The latest LCP entry is the current value until the page settles.
        lcp = entry.startTime;
        hasData = true;
        break;
      }
      case "layout-shift": {
        const shift = entry as LayoutShiftEntry;
        // Shifts right after user input are excluded from CLS by definition.
        if (!shift.hadRecentInput) {
          cls = (cls ?? 0) + shift.value;
          hasData = true;
        }
        break;
      }
      case "event": {
        const event = entry as EventEntry;
        if (event.interactionId) {
          // Per the Event Timing spec, duration runs from startTime to
          // processingEnd; the longest interaction is the INP approximation.
          inp = Math.max(inp ?? 0, event.duration);
          hasData = true;
        }
        break;
      }
      case "navigation": {
        const navigation = entry as NavigationEntry;
        if (navigation.responseStart > 0) {
          ttfb = navigation.responseStart - navigation.startTime;
          hasData = true;
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    record,
    flush,
    close(): void {
      flush();
    },
  };
}
