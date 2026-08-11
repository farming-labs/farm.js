import vuePlugin from "@vitejs/plugin-vue";
import type { PluginOption } from "vite";

export function createFarmRendererPlugin(): PluginOption {
  return vuePlugin();
}
