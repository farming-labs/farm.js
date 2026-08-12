import type { FarmRenderer } from "@farm.js/core/renderer";

const SVELTE_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "svelte",
  vite: "@farm.js/svelte/vite",
  server: "@farm.js/svelte/server",
  client: "@farm.js/svelte/client",
  componentExtensions: [".svelte"],
  dedupe: ["svelte"],
  optimizeDeps: ["svelte", "@farm.js/svelte/client"],
  capabilities: {
    streaming: { node: false, web: false },
  },
});

/** Select Svelte for component compilation, server rendering, and browser hydration. */
export function svelte(): FarmRenderer {
  return {
    ...SVELTE_RENDERER,
    componentExtensions: [...(SVELTE_RENDERER.componentExtensions || [])],
    dedupe: [...(SVELTE_RENDERER.dedupe || [])],
    optimizeDeps: [...(SVELTE_RENDERER.optimizeDeps || [])],
    capabilities: {
      streaming: { ...SVELTE_RENDERER.capabilities?.streaming },
    },
  };
}

export { SVELTE_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
