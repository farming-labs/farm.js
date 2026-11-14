import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolvePrefetchOptions } from "./config.js";
import type { PrefetchOptions, PrefetchRuntime, ResolvedPrefetchOptions } from "./types.js";

export type {
  PrefetchOptions,
  PrefetchRuntime,
  PrefetchStrategy,
  ResolvedPrefetchOptions,
} from "./types.js";

/**
 * Prefetch plain same-origin links app-wide, as the default policy layer
 * beside core `Link`. Core `Link` already prefetches its own links
 * (intent / viewport / render); this plugin covers the anchors core never
 * sees — plain `<a>` elements in rendered HTML, Markdown and CMS content —
 * through the same `router.prefetch` primitive, so fetching, caching and
 * dedupe stay in one place.
 *
 * - `strategy: "hover" | "viewport" | "both"` (default `"both"`) — hover
 *   prefetches after `hoverDelayMs` (default 50ms), viewport prefetches
 *   when the link enters view.
 * - `allow` / `deny` route patterns (`/posts/[id]`, `/docs/[...slug]`);
 *   `deny` wins, an empty `allow` allows everything.
 * - `maxConcurrent` (default 6) caps concurrent page-data fetches.
 * - `Save-Data` and `prefers-reduced-data` disable the runtime entirely.
 * - `Link`-managed, external, download, `_blank` and
 *   `data-farm-prefetch="off"` links are never prefetched.
 */
export function prefetch(options: PrefetchOptions = {}) {
  const resolved = resolvePrefetchOptions(options);
  const publicConfig: ResolvedPrefetchOptions = { ...resolved };
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
          throw new Error("[farm:prefetch] Configure prefetch in one prefetch() instance");
        }
      },
      client: {
        public: publicConfig,
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
