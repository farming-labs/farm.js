import type { FarmRenderer } from "@farm.js/core/renderer";

const SOLID_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "solid",
  vite: "@farm.js/solid/vite",
  server: "@farm.js/solid/server",
  client: "@farm.js/solid/client",
  jsxImportSource: "solid-js",
  dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
  optimizeDeps: ["solid-js", "solid-js/web", "solid-js/store", "@farm.js/solid/client"],
});

/** Select Solid for JSX compilation, server rendering, and browser hydration. */
export function solid(): FarmRenderer {
  return {
    ...SOLID_RENDERER,
    dedupe: [...(SOLID_RENDERER.dedupe || [])],
    optimizeDeps: [...(SOLID_RENDERER.optimizeDeps || [])],
  };
}

export { SOLID_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
