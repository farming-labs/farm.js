import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import { resolveScriptsOptions } from "./config.js";
import { normalizeScriptBasePath } from "./shared.js";
import type { ResolvedScriptsOptions, ScriptRuntime, ScriptsOptions } from "./types.js";

export type {
  AnyScriptHandle,
  ResolvedScriptDefinition,
  ResolvedScriptLoadStrategy,
  ScriptConsentState,
  ScriptDefinition,
  ScriptDuration,
  ScriptHandle,
  ScriptLoadStrategy,
  ScriptPlacement,
  ScriptSnapshot,
  ScriptStatus,
  ScriptStatusListener,
  ScriptType,
  ScriptsOptions,
} from "./types.js";

/** Manage explicitly registered third-party browser scripts across Farm's client lifecycle. */
export function scripts(options: ScriptsOptions) {
  const resolved = resolveScriptsOptions(options);
  const publicConfig: ResolvedScriptsOptions = {
    scripts: resolved.scripts,
    basePath: resolved.basePath,
  };
  let plugin: FarmPlugin<unknown, Record<string, unknown>, ScriptRuntime, ResolvedScriptsOptions>;

  plugin = definePlugin<unknown, Record<string, unknown>, ScriptRuntime, ResolvedScriptsOptions>({
    name: "farm:scripts",
    enforce: "post",
    configure(config) {
      publicConfig.basePath = normalizeScriptBasePath(config.basePath);
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:scripts").length > 1
      ) {
        throw new Error("[farm:scripts] Configure all browser scripts in one scripts() instance");
      }
    },
    client: {
      public: publicConfig,
      async setup({ public: config }) {
        const runtime = await import("@farm.js/scripts/client");
        return runtime.startScriptRuntime(config.scripts, window, config.basePath);
      },
      hydration: {
        after({ state }) {
          state.afterHydration();
        },
      },
      navigation: {
        rendered({ state }) {
          state.refresh();
        },
      },
      close({ state }) {
        state.close();
      },
    },
  });

  return plugin;
}
