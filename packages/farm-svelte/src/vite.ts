import type { PluginOption } from "vite";

export async function createFarmRendererPlugin(): Promise<PluginOption> {
  // The official Svelte plugin is ESM-only. Load it lazily so FARMJS can
  // resolve this adapter through either its CommonJS or ESM export.
  const { svelte: sveltePlugin } = await import("@sveltejs/vite-plugin-svelte");
  // The adapter runtime is distributed as production-compiled Svelte code. Keep
  // application components on that same ABI in dev; HMR remains enabled by the
  // Vite plugin through Svelte's separate `hmr` compiler option.
  return sveltePlugin({ compilerOptions: { dev: false } });
}
