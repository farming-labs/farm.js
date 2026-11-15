import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolvePrefetchOptions } from "./config.js";
import type { PrefetchOptions, PrefetchRuntime, ResolvedPrefetchOptions } from "./types.js";

export type {
  PrefetchMode,
  PrefetchOptions,
  PrefetchRuntime,
  ResolvedPrefetchOptions,
} from "./types.js";

/**
 * Prefetch plain same-origin links app-wide. Core `Link` prefetches its own
 * anchors; this plugin gives the anchors core never sees (rendered HTML,
 * Markdown, CMS content) the same modes, through the same router primitives,
 * so fetching, caching, dedupe and the viewport queue stay in core.
 *
 * - `mode: "intent" | "viewport" | "render" | "none"` (default `"intent"`),
 *   overridden per link with `data-farm-prefetch`.
 * - `intentDelayMs` (default 50) before a hover, focus or touch prefetch.
 * - `allow` / `deny` route patterns (`/posts/[id]`, `/docs/[...slug]`);
 *   `deny` wins, an empty `allow` allows every path.
 * - `Save-Data` and `prefers-reduced-data` keep the runtime off, as does a
 *   router without `prefetch`.
 */
export function prefetch(options: PrefetchOptions = {}) {
  const resolved = resolvePrefetchOptions(options);
  let plugin: FarmPlugin<
    unknown,
    Record<string, unknown>,
    PrefetchRuntime,
    ResolvedPrefetchOptions
  >;

  plugin = definePlugin<unknown, Record<string, unknown>, PrefetchRuntime, ResolvedPrefetchOptions>(
    {
      name: "farm:prefetch",
      configure(config) {
        if (
          (config.plugins ?? []).filter((candidate) => candidate.name === "farm:prefetch").length >
          1
        ) {
          throw new Error(
            "[farm:prefetch] prefetch() is registered more than once. Keep one prefetch() in `plugins` and merge the options into it.",
          );
        }
      },
      client: {
        public: resolved,
        async setup({ public: config, router }) {
          const runtime = await import("@farm.js/prefetch/client");
          return runtime.startPrefetchRuntime(config, window, router);
        },
        close({ state }) {
          state.close();
        },
      },
    },
  );

  return plugin;
}
