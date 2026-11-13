"use client";

import type { FarmClientPlugin } from "@farm.js/core/client/plugin";
import { createWebVitalsCollector } from "./collector.js";
import type { WebVitalsClientOptions, WebVitalsCollector } from "./types.js";

export { createWebVitalsCollector } from "./collector.js";
export type { WebVitalsClientOptions, WebVitalsCollector, WebVitalsReport } from "./types.js";

/**
 * Register the web vitals collector from the app client entry
 * (`src/client.ts`), where a callback can travel because the module is
 * bundled with the app instead of crossing the server-plugin boundary:
 *
 * ```ts
 * // src/client.ts
 * import { defineClient } from "@farm.js/core/client";
 * import { webVitalsClient } from "@farm.js/web-vitals/client";
 *
 * export default defineClient(
 *   webVitalsClient({ onReport: (report) => console.info(report) }),
 * );
 * ```
 *
 * Prefer the `webVitals()` server plugin when only a beacon endpoint is
 * needed; use this only for the `onReport` callback (or when the app already
 * owns a client entry and wants the collector beside its own hooks).
 */
export function webVitalsClient(
  options: WebVitalsClientOptions = {},
): FarmClientPlugin<WebVitalsCollector> {
  return {
    async setup() {
      return createWebVitalsCollector(options);
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
  };
}
