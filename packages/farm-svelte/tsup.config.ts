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
  dts: true,
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
});
