import vuePlugin from "@vitejs/plugin-vue";
import type { PluginOption } from "vite";

export function createFarmRendererPlugin(): PluginOption {
  const plugin = vuePlugin();
  const handleHotUpdate = plugin.handleHotUpdate;
  if (typeof handleHotUpdate === "function") {
    // plugin-vue resolves its compiler in buildStart, but Farm refreshes generated types
    // (src/farm.d.ts) while the dev server starts, before listen() runs buildStart. No browser
    // has loaded a module yet, so skip those early changes instead of crashing on a null compiler.
    plugin.handleHotUpdate = function (context) {
      if (!plugin.api?.options.compiler) return;
      return handleHotUpdate.call(this, context);
    };
  }
  return plugin;
}
