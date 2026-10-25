import type { FarmRenderer } from "@farm.js/core/renderer";
import type { FarmVueAppSetup } from "./app-setup";

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
    reconcilesRerenders: true,
    functionComponents: true,
    streaming: { node: true, web: true },
  },
});

export interface FarmVueRendererOptions {
  /**
   * Module that configures every Vue app Farm creates, relative to the project root. It
   * default-exports a function, usually wrapped in `defineVueApp`, that receives the app:
   * install plugins such as Pinia with `app.use()` there.
   */
  app?: string;
}

/** Select Vue for SFC compilation, server rendering, and browser hydration. */
export function vue(options: FarmVueRendererOptions = {}): FarmRenderer {
  return {
    ...VUE_RENDERER,
    ...(options.app ? { appSetup: options.app } : {}),
    componentExtensions: [...(VUE_RENDERER.componentExtensions || [])],
    dedupe: [...(VUE_RENDERER.dedupe || [])],
    optimizeDeps: [...(VUE_RENDERER.optimizeDeps || [])],
    buildConcurrency: VUE_RENDERER.buildConcurrency,
    capabilities: {
      reconcilesRerenders: true,
      functionComponents: true,
      streaming: { ...VUE_RENDERER.capabilities?.streaming },
    },
  };
}

/** Type the default export of the module passed to `vue({ app })`. */
export function defineVueApp(setup: FarmVueAppSetup): FarmVueAppSetup {
  return setup;
}

export { VUE_RENDERER };
export type { FarmVueAppContext, FarmVueAppSetup } from "./app-setup";
export type { FarmRenderer } from "@farm.js/core/renderer";
