import { definePlugin, type FarmPlugin } from "@farm.js/core/plugin";
import type { Plugin, PluginOption, UserConfig } from "vite";
import wasmPlugin from "vite-plugin-wasm";
import { DEFAULT_WASM_TARGET, resolveWasmOptions, type WasmOptions } from "./config.js";

export type { WasmOptions };

/** Configure WebAssembly ESM imports in Farm's browser and browser-worker builds. */
export function wasm(options: WasmOptions = {}): FarmPlugin {
  const resolved = resolveWasmOptions(options);

  function plugins(): PluginOption[] {
    const upstream = wasmPlugin();
    // The upstream helper uses a root URL. Farm handles page requests before
    // Vite, so give this virtual module Vite's standard null-prefixed identity.
    const helper = "/__vite-plugin-wasm-helper";
    const virtualHelper = `\0${helper}`;
    return [
      {
        ...upstream,
        resolveId(id, ...args) {
          if (id === helper) return virtualHelper;
          return upstream.resolveId.call(this, id, ...args);
        },
        load(id, ...args) {
          return upstream.load.call(this, id === virtualHelper ? helper : id, ...args);
        },
      } satisfies Plugin,
    ];
  }

  return definePlugin({
    name: "farm:wasm",
    enforce: "pre",
    configure(config) {
      if ((config.plugins ?? []).filter((plugin) => plugin.name === "farm:wasm").length > 1) {
        throw new Error("[farm:wasm] Configure one wasm() plugin instance");
      }
      // Install worker handling through a Vite config hook as well as the public
      // config. Farm constructs separate production Vite configs for each build.
      const workerPlugin: Plugin = {
        name: "farm:wasm-workers",
        config(viteConfig, environment) {
          const worker = { ...config.vite?.worker, ...viteConfig.worker };
          const existing = worker.plugins;
          if (worker.format === "iife") {
            throw new Error(
              '[farm:wasm] WebAssembly imports require worker.format: "es". Remove the iife override.',
            );
          }
          if (environment.command === "build" && !viteConfig.build?.ssr) {
            // Vite concatenates arrays returned from config hooks. Replace the
            // target so Farm's older default cannot remain in the target list.
            viteConfig.build = {
              ...viteConfig.build,
              target: resolved.target ?? config.vite?.build?.target ?? [...DEFAULT_WASM_TARGET],
            };
          }
          return {
            worker: {
              ...worker,
              format: "es" as const,
              plugins: (...args: unknown[]) => [
                ...plugins(),
                ...(typeof existing === "function" ? existing(...args) : (existing ?? [])),
              ],
            },
          } satisfies UserConfig;
        },
      };
      return {
        ...config,
        vite: {
          ...config.vite,
          plugins: [workerPlugin, ...plugins(), ...(config.vite?.plugins ?? [])],
        },
      };
    },
  });
}
