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
    "@farm.js/core/client",
    "@farm.js/core/i18n/client",
    "@farm.js/core/server-fn/client",
    "@farm.js/core/server-query/client",
    "@farm.js/core/theme/client",
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
