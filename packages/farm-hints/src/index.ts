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

  // Stamped as an own property so it survives the descriptor copy an
  // integration performs when it takes ownership of a contributed plugin.
  Object.defineProperty(plugin, HINTS_PLUGIN_MARKER, { value: true });

  return plugin;
}

/**
 * Marks this plugin so production removal can find it by identity-independent
 * means. An integration that contributes the plugin re-creates it with
 * `Object.create(prototype, ownDescriptors)`, which produces a different object
 * with the same own properties, so a `!==` filter silently matched nothing and
 * left `farm:hints` in the production config.
 */
const HINTS_PLUGIN_MARKER = Symbol.for("farm.hints.plugin");

function withoutPlugin(config: any, plugin: FarmPlugin<any, any, any, any>): any {
  const plugins: FarmPlugin<any, any, any, any>[] = config.plugins ?? [];
  const remaining = plugins.filter(
    (candidate) => candidate !== plugin && !(candidate as any)?.[HINTS_PLUGIN_MARKER],
  );
  if (remaining.length === plugins.length) {
    // Failing loudly beats shipping a dev-only plugin: its vite plugin is not
    // registered in production, so the build either dies on an unresolvable
    // virtual module or ships the dev runtime to the browser.
    throw new Error(
      "farm:hints could not remove itself from the production config. " +
        "Report this with the integration that contributed it.",
    );
  }
  return { ...config, plugins: remaining };
}
