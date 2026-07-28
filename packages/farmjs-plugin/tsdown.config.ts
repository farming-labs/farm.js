import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    outDir: "dist",
  },
  {
    entry: ["src/rsc/index.ts", "src/rsc/optimized-boundary.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    outDir: "dist/rsc",
    external: [
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/server.edge",
      "react-dom/client",
      "vite",
      "@vitejs/plugin-rsc",
      "@vitejs/plugin-rsc/rsc",
      "@vitejs/plugin-rsc/ssr",
      "@vitejs/plugin-rsc/browser",
      "rsc-html-stream",
      "rsc-html-stream/server",
      "rsc-html-stream/client",
      "@farming-labs/strata",
      "@farming-labs/strata/react-server",
    ],
  },
]);
