import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolveHintsOptions, type HintsOptions } from "./config.js";
import type { FarmHintsRuntime } from "./types.js";

export type {
  AccessibilityHintsOptions,
  HintsAccessibilityLevel,
  HintsImpact,
  HintsOptions,
  HintsOverlayOpen,
  HintsOverlayOptions,
  HintsOverlayPosition,
  HintsReport,
  PerformanceHintsOptions,
  ThirdPartyHintsOptions,
} from "./config.js";
export type { FarmHintsRuntime, HintCategory, HintIssue, HintMetric } from "./types.js";

/** Add development-only accessibility, performance, HTML, and third-party hints. */
export function hints(options: HintsOptions = {}) {
  const resolved = resolveHintsOptions(options);
  let plugin: FarmPlugin<
    unknown,
    Record<string, unknown>,
    FarmHintsRuntime | undefined,
    typeof resolved
  >;

  plugin = definePlugin<
    unknown,
    Record<string, unknown>,
    FarmHintsRuntime | undefined,
    typeof resolved
  >({
    name: "farm:hints",
    enforce: "post",
    configure(config, context) {
      if (context.isProd) return withoutPlugin(config, plugin);
    },
    client: {
      public: resolved,
      async setup({ public: config, isDev }) {
        if (!isDev) return undefined;
        const runtime = await import("@farm.js/hints/client");
        return runtime.startHintsRuntime(config);
      },
      hydration: {
        after({ state, durationMs, location }) {
          state?.recordTiming("hydration", durationMs, location.pathname);
          void state?.scan("hydration", location.pathname);
        },
      },
      navigation: {
        rendered({ state, durationMs, to }) {
          state?.recordTiming("navigation", durationMs, to.pathname);
          void state?.scan("navigation", to.pathname);
        },
      },
      close({ state }) {
        state?.close();
      },
    },
  });

  return plugin;
}

function withoutPlugin(config: any, plugin: FarmPlugin<any, any, any, any>): any {
  if (!config.plugins?.includes(plugin)) return;
  return {
    ...config,
    plugins: config.plugins.filter(
      (candidate: FarmPlugin<any, any, any, any>) => candidate !== plugin,
    ),
  };
}
