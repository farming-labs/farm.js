import { copyFile } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    client: "src/client.ts",
    bindings: "src/bindings.ts",
    vite: "src/vite.ts",
  },
  format: ["cjs", "esm"],
  dts: {
    entry: {
      index: "src/index.ts",
      server: "src/server.ts",
      client: "src/client.ts",
      bindings: "src/bindings.ts",
      vite: "src/vite.ts",
      // Types only: the component itself is Link.svelte, copied below.
      link: "src/link.ts",
    },
  },
  splitting: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "@farm.js/core",
    "@farm.js/core/renderer-client",
    "svelte",
    "svelte/server",
    "svelte/internal/client",
    "svelte/internal/server",
    "vite",
    "@sveltejs/vite-plugin-svelte",
  ],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
  // `@farm.js/svelte/link` ships Link.svelte as source, which the app's Svelte plugin compiles.
  async onSuccess() {
    await copyFile("src/Link.svelte", "dist/Link.svelte");
  },
});
