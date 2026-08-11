import type { FarmRenderer } from "@farm.js/core/renderer";

const PREACT_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "preact",
  vite: "@farm.js/preact/vite",
  server: "@farm.js/preact/server",
  client: "@farm.js/preact/client",
  jsxImportSource: "preact",
  dedupe: ["preact", "preact/compat", "preact/hooks", "preact/jsx-runtime"],
  optimizeDeps: [
    "preact",
    "preact/compat",
    "preact/hooks",
    "preact/jsx-runtime",
    "@farm.js/preact/client",
  ],
});

/** Select Preact for JSX compilation, server rendering, streaming, and browser hydration. */
export function preact(): FarmRenderer {
  return {
    ...PREACT_RENDERER,
    dedupe: [...(PREACT_RENDERER.dedupe || [])],
    optimizeDeps: [...(PREACT_RENDERER.optimizeDeps || [])],
  };
}

export { PREACT_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
