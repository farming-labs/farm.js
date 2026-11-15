import type { FarmRenderer } from "@farm.js/core/renderer";
import type { ReactCompilerOptions } from "@farm.js/react";

export interface PreactRendererOptions {
  /**
   * Experimental: compile eligible components with Farm's AOT compiler and run them on
   * Preact's React compatibility layer. Requires `@farm.js/react` to be installed. `true`
   * enables automatic inference; an object takes the same options as `react({ compiler })`.
   */
  compiler?: boolean | ReactCompilerOptions;
}

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
  capabilities: {
    reconcilesRerenders: true,
    functionComponents: true,
    streaming: { node: true, web: true },
  },
});

/** Select Preact for JSX compilation, server rendering, streaming, and browser hydration. */
export function preact(options: PreactRendererOptions = {}): FarmRenderer {
  const compiler = options.compiler ?? false;
  if (typeof compiler !== "boolean" && (typeof compiler !== "object" || compiler === null)) {
    throw new TypeError("preact({ compiler }) must be a boolean or a compiler options object.");
  }
  return {
    ...PREACT_RENDERER,
    dedupe: [...(PREACT_RENDERER.dedupe || [])],
    optimizeDeps: [
      ...(PREACT_RENDERER.optimizeDeps || []),
      ...(compiler ? ["@farm.js/react/compiler-runtime"] : []),
    ],
    capabilities: {
      reconcilesRerenders: true,
      functionComponents: true,
      streaming: { ...PREACT_RENDERER.capabilities?.streaming },
    },
    // The compiler's Vite plugin validates and normalizes these options, as it does for react().
    ...(compiler ? { options: { compiler } } : {}),
  };
}

export { PREACT_RENDERER };
export type { FarmRenderer } from "@farm.js/core/renderer";
