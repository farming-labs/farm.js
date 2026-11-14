import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolveScrollRestorationOptions } from "./config.js";
import type {
  ResolvedScrollRestorationOptions,
  ScrollRestorationOptions,
  ScrollRestorationRuntime,
} from "./types.js";

export type {
  ResolvedScrollRestorationOptions,
  ScrollRestorationNavigationEvent,
  ScrollRestorationOptions,
  ScrollRestorationRuntime,
} from "./types.js";

/**
 * Restore the scroll position per route on back/forward navigations.
 *
 * Core saves a position per path but restores it before the new route has
 * rendered, so back/forward visits often land at the top. This plugin
 * saves on `navigation.before` and restores on `navigation.rendered` —
 * after the layout is final — for `pop` navigations only; new pushes keep
 * the top. Positions are keyed by route pattern + params when the session
 * carries a route, and by pathname otherwise, and live in
 * `sessionStorage` for the tab's lifetime.
 *
 * A link opts its navigation out with
 * `data-farm-scroll-restore="off"`: the runtime skips both the save and
 * the restore for the navigation that click starts.
 */
export function scrollRestoration(options: ScrollRestorationOptions = {}) {
  const resolved = resolveScrollRestorationOptions(options);
  const publicConfig: ResolvedScrollRestorationOptions = { ...resolved };
  let plugin: FarmPlugin<
    unknown,
    Record<string, unknown>,
    ScrollRestorationRuntime,
    ResolvedScrollRestorationOptions
  >;

  plugin = definePlugin<
    unknown,
    Record<string, unknown>,
    ScrollRestorationRuntime,
    ResolvedScrollRestorationOptions
  >({
    name: "farm:scroll-restoration",
    configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:scroll-restoration")
          .length > 1
      ) {
        throw new Error(
          "[farm:scroll-restoration] Configure scroll restoration in one scrollRestoration() instance",
        );
      }
    },
    client: {
      public: publicConfig,
      async setup({ public: config }) {
        const runtime = await import("@farm.js/scroll-restoration/client");
        return runtime.startScrollRestorationRuntime(config, window);
      },
      navigation: {
        before(event) {
          event.state.saveForNavigation(event);
          // Core aborts a navigation without `rendered` or `error` when a
          // hash link or a link to the current page cancels it.
          event.signal.addEventListener("abort", () => event.state.discard(event.id), {
            once: true,
          });
        },
        rendered(event) {
          event.state.restoreForNavigation(event);
        },
        error(event) {
          event.state.discard(event.id);
        },
      },
      close({ state }) {
        state.close();
      },
    },
  });

  return plugin;
}
