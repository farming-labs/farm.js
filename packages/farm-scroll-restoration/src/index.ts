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
 * Restore the window scroll position on Back/Forward once the page has
 * rendered.
 *
 * Saves the position of the page being left on `navigation.before`, notes
 * the history entry entered on `navigation.resolved`, and restores its
 * saved position on `navigation.rendered`, for `pop` navigations only; new
 * pushes keep the top. Positions are saved per history entry and live in
 * `sessionStorage` for the tab's lifetime.
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
        },
        resolved(event) {
          event.state.enterForNavigation(event);
        },
        rendered(event) {
          event.state.restoreForNavigation(event);
        },
      },
      close({ state }) {
        state.close();
      },
    },
  });

  return plugin;
}
