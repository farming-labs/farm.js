import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolveViewTransitionsOptions } from "./config.js";
import type {
  ResolvedViewTransitionsOptions,
  ViewTransitionsOptions,
  ViewTransitionsRuntime,
} from "./types.js";

export type {
  ResolvedViewTransitionsOptions,
  ViewTransitionsNavigationEvent,
  ViewTransitionsOptions,
  ViewTransitionsRuntime,
} from "./types.js";

/**
 * Animate client navigations with the View Transitions API.
 *
 * Starts a transition on `navigation.before`, while the old page is
 * still on screen, and completes it on `navigation.resolved`, once the
 * new page is in place. Browsers without `document.startViewTransition`
 * navigate without animating, `prefers-reduced-motion` disables the
 * animation, and routes listed in `exclude` opt out per route.
 */
export function viewTransitions(options: ViewTransitionsOptions = {}) {
  const resolved = resolveViewTransitionsOptions(options);
  const publicConfig: ResolvedViewTransitionsOptions = { ...resolved };
  let plugin: FarmPlugin<
    unknown,
    Record<string, unknown>,
    ViewTransitionsRuntime,
    ResolvedViewTransitionsOptions
  >;

  plugin = definePlugin<
    unknown,
    Record<string, unknown>,
    ViewTransitionsRuntime,
    ResolvedViewTransitionsOptions
  >({
    name: "farm:view-transitions",
    configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:view-transitions")
          .length > 1
      ) {
        throw new Error(
          "[farm:view-transitions] Configure view transitions in one viewTransitions() instance",
        );
      }
    },
    client: {
      public: publicConfig,
      async setup({ public: config }) {
        const runtime = await import("@farm.js/view-transitions/client");
        return runtime.startViewTransitionsRuntime(config, window);
      },
      navigation: {
        before(event) {
          event.state.beginForNavigation(event);
        },
        resolved(event) {
          event.state.finishForNavigation(event);
        },
      },
      close({ state }) {
        state.close();
      },
    },
  });

  return plugin;
}
