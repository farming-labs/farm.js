import type { PluginOption } from "vite";

export async function createFarmRendererPlugin(): Promise<PluginOption> {
  // The official Svelte plugin is ESM-only. Load it lazily so FARMJS can
  // resolve this adapter through either its CommonJS or ESM export.
  const { svelte: sveltePlugin } = await import("@sveltejs/vite-plugin-svelte");
  // The adapter runtime is distributed as production-compiled Svelte code. Keep
  // application components on that same ABI in dev; HMR remains enabled by the
  // Vite plugin through Svelte's separate `hmr` compiler option.
  return [
    svelteServerRuntime(),
    sveltePlugin({ compilerOptions: { dev: false } }),
    svelteBrowserConditions(),
  ];
}

/**
 * In development, vite-plugin-svelte pre-bundles `svelte` for the server environment unless the
 * app excludes it. Pages then import that bundled copy while this adapter's server renderer, which
 * Vite does not pre-bundle, imports Svelte's own modules: two runtimes, so a page's `getContext()`
 * read a component context the renderer had set in the other one and threw
 * `lifecycle_outside_component`. Excluding `svelte` keeps both on one runtime, as a production
 * build does.
 */
function svelteServerRuntime(): PluginOption {
  return {
    name: "farm:svelte-server-runtime",
    config: () => ({ ssr: { optimizeDeps: { exclude: ["svelte"] } } }),
  } as PluginOption;
}

/**
 * vite-plugin-svelte 4 sets `resolve.conditions: ["svelte"]`. Vite 5 merges
 * that with its defaults, but Vite 6 and later treat it as the full list, so a
 * client build loses `browser` and resolves `svelte` to its server runtime.
 * Adding the client defaults back for client environments keeps the browser
 * bundle on Svelte's client runtime. Vite 5 never calls `configEnvironment`.
 */
function svelteBrowserConditions(): PluginOption {
  return {
    name: "farm:svelte-browser-conditions",
    configEnvironment(
      name: string,
      options: { consumer?: string; resolve?: { conditions?: string[] } },
    ) {
      const consumer = options.consumer ?? (name === "client" ? "client" : "server");
      if (consumer !== "client") return;
      const conditions = options.resolve?.conditions ?? [];
      if (conditions.includes("browser")) return;
      return {
        resolve: {
          conditions: ["module", "browser", "development|production"].filter(
            (condition) => !conditions.includes(condition),
          ),
        },
      };
    },
  } as PluginOption;
}
