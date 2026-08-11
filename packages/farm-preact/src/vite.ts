import preactPreset from "@preact/preset-vite";
import type { PluginOption } from "vite";

export function createFarmRendererPlugin(): PluginOption[] {
  return preactPreset();
}
