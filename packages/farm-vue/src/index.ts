import type { FarmRenderer } from "@farm.js/core/renderer";

const VUE_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "vue",
  vite: "@farm.js/vue/vite",
  server: "@farm.js/vue/server",
  client: "@farm.js/vue/client",
  componentExtensions: [".vue"],
  dedupe: ["vue"],
  optimizeDeps: ["vue", "@farm.js/vue/client"],
  // @vitejs/plugin-vue keeps descriptor and script caches at module scope.
  // Serial graphs prevent one plugin instance from invalidating the other.
  buildConcurrency: "serial",
  capabilities: {
    streaming: { node: true, web: true },
  },
});

/** Select Vue for SFC compilation, server rendering, and browser hydration. */
export function vue(): FarmRenderer {
  return {
    ...VUE_RENDERER,
    componentExtensions: [...(VUE_RENDERER.componentExtensions || [])],
    dedupe: [...(VUE_RENDERER.dedupe || [])],
    optimizeDeps: [...(VUE_RENDERER.optimizeDeps || [])],
    buildConcurrency: VUE_RENDERER.buildConcurrency,
    capabilities: {
      streaming: { ...VUE_RENDERER.capabilities?.streaming },
    },
  };
}

export { VUE_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
