import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolveWebVitalsOptions } from "./config.js";
import type { ResolvedWebVitalsOptions, WebVitalsCollector, WebVitalsOptions } from "./types.js";

export type {
  ResolvedWebVitalsOptions,
  WebVitalsClientOptions,
  WebVitalsCollector,
  WebVitalsOptions,
  WebVitalsReport,
} from "./types.js";

/**
 * Report web vitals (LCP / CLS / INP / TTFB) per route, from the performance
 * entries the core client plugin manager already observes. Creates zero new
 * observers — it consumes the `performance` hook, it does not duplicate
 * farm-hints. Batches flush on route change and on page close, and are sent
 * with `navigator.sendBeacon` to `endpoint` when one is configured.
 *
 * For an `onReport` callback instead of (or beside) the beacon endpoint,
 * register the collector from the app client entry — see `webVitalsClient()`
 * in `@farm.js/web-vitals/client`. Callbacks cannot cross the server-plugin
 * boundary, so `webVitals()` rejects them.
 */
export function webVitals(options: WebVitalsOptions = {}) {
  const resolved = resolveWebVitalsOptions(options);
  const publicConfig: ResolvedWebVitalsOptions = { ...resolved };
  let plugin: FarmPlugin<
    unknown,
    Record<string, unknown>,
    WebVitalsCollector,
    ResolvedWebVitalsOptions
  >;

  plugin = definePlugin<
    unknown,
    Record<string, unknown>,
    WebVitalsCollector,
    ResolvedWebVitalsOptions
  >({
    name: "farm:web-vitals",
    configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:web-vitals").length >
        1
      ) {
        throw new Error("[farm:web-vitals] Configure web vitals in one webVitals() instance");
      }
    },
    client: {
      public: publicConfig,
      async setup({ public: config }) {
        const runtime = await import("@farm.js/web-vitals/client");
        return runtime.createWebVitalsCollector({ endpoint: config.endpoint });
      },
      performance({ state, entry, location }) {
        state.record(entry, location);
      },
      navigation: {
        before({ state }) {
          state.flush();
        },
      },
      close({ state }) {
        state.close();
      },
    },
  });

  return plugin;
}
