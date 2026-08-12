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
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "@farm.js/core",
    "@farm.js/core/renderer-client",
    "solid-js",
    "solid-js/web",
    "vite",
    "vite-plugin-solid",
  ],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
