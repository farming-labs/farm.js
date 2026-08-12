import type { FarmRenderer } from "@farm.js/core/renderer";

const VUE_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "vue",
  vite: "@farm.js/vue/vite",
  server: "@farm.js/vue/server",
  client: "@farm.js/vue/client",
  componentExtensions: [".vue"],
  dedupe: ["vue"],
  optimizeDeps: ["vue", "@farm.js/vue/client"],
  capabilities: {
    streaming: { node: false, web: false },
  },
});

/** Select Vue for SFC compilation, server rendering, and browser hydration. */
export function vue(): FarmRenderer {
  return {
    ...VUE_RENDERER,
    componentExtensions: [...(VUE_RENDERER.componentExtensions || [])],
    dedupe: [...(VUE_RENDERER.dedupe || [])],
    optimizeDeps: [...(VUE_RENDERER.optimizeDeps || [])],
    capabilities: {
      streaming: { ...VUE_RENDERER.capabilities?.streaming },
    },
  };
}

export { VUE_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
