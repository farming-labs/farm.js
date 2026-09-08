import { definePlugin } from "@farm.js/core/plugin";

export type { FarmWebMCPRuntime } from "./types.js";
export type { WebMCPUnsupportedBehavior } from "./client.js";

export interface WebMCPPluginOptions {
  /** Set false to keep the plugin configured without starting its browser runtime. */
  enabled?: boolean;
  /** Behavior when `document.modelContext` is unavailable. Defaults to warn in development. */
  unsupported?: "ignore" | "warn" | "error";
  /** Expose `window.__FARM_WEBMCP__` for inspection. Defaults to true in development. */
  debug?: boolean;
}

/** Register Farm's explicit browser tools with the experimental WebMCP API. */
export function webmcp(options: WebMCPPluginOptions = {}) {
  assertOptions(options);

  return definePlugin({
    name: "farm:webmcp",
    client: {
      public: {
        enabled: options.enabled ?? true,
        unsupported: options.unsupported ?? null,
        debug: options.debug ?? null,
      },
      async setup({ public: config, isDev }) {
        if (!config.enabled) return undefined;
        const runtime = await import("@farm.js/webmcp/client");
        return runtime.startWebMCPRuntime({
          unsupported: config.unsupported ?? (isDev ? "warn" : "ignore"),
          debug: config.debug ?? isDev,
        });
      },
      navigation: {
        async rendered({ state }) {
          await state?.sync();
        },
      },
      close({ state }) {
        state?.close();
      },
    },
  });
}

function assertOptions(options: WebMCPPluginOptions): void {
  if (options.enabled !== undefined && typeof options.enabled !== "boolean") {
    throw new TypeError("webmcp enabled must be boolean");
  }
  if (options.debug !== undefined && typeof options.debug !== "boolean") {
    throw new TypeError("webmcp debug must be boolean");
  }
  if (
    options.unsupported !== undefined &&
    options.unsupported !== "ignore" &&
    options.unsupported !== "warn" &&
    options.unsupported !== "error"
  ) {
    throw new TypeError('webmcp unsupported must be "ignore", "warn", or "error"');
  }
}
