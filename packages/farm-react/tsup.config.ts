import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    client: "src/client.ts",
    "compiler-runtime": "src/compiler-runtime.tsx",
    vite: "src/vite.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "@babel/core",
    "@farm.js/core",
    "@farm.js/core/renderer/react/client",
    "@farm.js/core/renderer/react/server",
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "vite",
  ],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
