import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    client: "src/client.ts",
    vite: "src/vite.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "@farm.js/core",
    "@preact/preset-vite",
    "preact",
    "preact/compat",
    "preact/hooks",
    "preact/jsx-runtime",
    "preact-render-to-string",
    "preact-render-to-string/stream",
    "preact-render-to-string/stream-node",
    "vite",
  ],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
