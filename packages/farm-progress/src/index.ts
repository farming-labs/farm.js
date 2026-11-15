import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolveProgressOptions } from "./config.js";
import type { ProgressOptions, ProgressRuntime, ResolvedProgressOptions } from "./types.js";

export type { ProgressOptions, ProgressRuntime, ResolvedProgressOptions } from "./types.js";

/** Show a top progress bar for client navigations. */
export function progress(options: ProgressOptions = {}) {
  const resolved = resolveProgressOptions(options);
  const publicConfig: ResolvedProgressOptions = { ...resolved };
  let plugin: FarmPlugin<
    unknown,
    Record<string, unknown>,
    ProgressRuntime,
    ResolvedProgressOptions
  >;

  plugin = definePlugin<unknown, Record<string, unknown>, ProgressRuntime, ResolvedProgressOptions>(
    {
      name: "farm:progress",
      configure(config) {
        if (
          (config.plugins ?? []).filter((candidate) => candidate.name === "farm:progress").length >
          1
        ) {
          throw new Error(
            "[farm:progress] Configure navigation progress in one progress() instance",
          );
        }
      },
      client: {
        public: publicConfig,
        async setup({ public: config }) {
          const runtime = await import("@farm.js/progress/client");
          return runtime.startProgressRuntime(config, window);
        },
        navigation: {
          before({ state, signal }) {
            state.show();
            // Core aborts a navigation without `rendered` or `error` when a hash
            // link or a link to the current page cancels it.
            signal.addEventListener("abort", () => state.cancel(), { once: true });
          },
          rendered({ state }) {
            state.hide();
          },
          error({ state }) {
            state.fail();
          },
        },
        close({ state }) {
          state.close();
        },
      },
    },
  );

  return plugin;
}
