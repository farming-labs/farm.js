import { definePlugin, type FarmPlugin, resolveFarmDevtoolsConfig } from "@farm.js/core/plugin";
import type { Plugin } from "vite";
import type { DevtoolsOptions } from "./types.js";

export type { DevtoolsOptions } from "./types.js";

/** Add the development-only workspace inspector. No production runtime is registered. */
export function devtools(options: DevtoolsOptions = {}): FarmPlugin {
  for (const name of ["launcher", "inspect"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "boolean") {
      throw new TypeError(`[farm:devtools] ${name} must be a boolean`);
    }
  }
  if (
    options.shortcut !== undefined &&
    options.shortcut !== false &&
    (typeof options.shortcut !== "string" ||
      !options.shortcut.trim() ||
      !/^[a-z0-9+.,/ -]+$/i.test(options.shortcut))
  ) {
    throw new TypeError(
      "[farm:devtools] shortcut must be a keyboard shortcut such as mod+shift+d, or false",
    );
  }
  const inspect = options.inspect ?? true;
  const launcher = options.launcher ?? true;
  return definePlugin({
    name: "farm:devtools",
    enforce: "pre",
    configure(config, context) {
      if (context.isProd) {
        return {
          ...config,
          plugins: config.plugins?.filter((candidate) => candidate.name !== "farm:devtools"),
        };
      }
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:devtools").length > 1
      ) {
        throw new Error("[farm:devtools] Configure one devtools() plugin instance");
      }
      if (
        config.devtools === false ||
        (typeof config.devtools === "object" && config.devtools.enabled === false)
      ) {
        throw new Error(
          "[farm:devtools] Remove devtools: false (or enabled: false) when using the devtools() plugin",
        );
      }
      const devtoolsConfig = {
        ...(typeof config.devtools === "object" ? config.devtools : {}),
        enabled: true,
        ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
      };
      const { shortcut } = resolveFarmDevtoolsConfig(devtoolsConfig);
      const vitePlugin: Plugin = {
        name: "farm:devtools-ui",
        enforce: "pre",
        apply: "serve",
        async configureServer(server) {
          const { installDevtoolsServer } = await import("./server.js");
          installDevtoolsServer(server, { inspect, shortcut });
        },
      };
      return {
        ...config,
        devtools: devtoolsConfig,
        vite: {
          ...config.vite,
          plugins: [vitePlugin, ...(config.vite?.plugins ?? [])],
          ...(inspect
            ? {
                optimizeDeps: {
                  ...config.vite?.optimizeDeps,
                  // This tiny module must retain import.meta.hot instead of being prebundled.
                  exclude: [
                    ...new Set([
                      ...(config.vite?.optimizeDeps?.exclude ?? []),
                      "@farm.js/devtools/internal/hmr",
                    ]),
                  ],
                },
              }
            : {}),
        },
      };
    },
    client: {
      public: { launcher, inspect },
      async setup({ isDev, public: config }) {
        if (!isDev || (!config.launcher && !config.inspect)) return;
        const updates = config.inspect
          ? (await import("@farm.js/devtools/internal/hmr")).startDevtoolsUpdates()
          : undefined;
        try {
          const launcher = config.launcher
            ? (await import("@farm.js/devtools/client")).startDevtoolsLauncher()
            : undefined;
          return {
            dispose() {
              launcher?.dispose();
              updates?.dispose();
            },
          };
        } catch (error) {
          updates?.dispose();
          throw error;
        }
      },
      close({ state }) {
        state?.dispose();
      },
    },
  });
}
