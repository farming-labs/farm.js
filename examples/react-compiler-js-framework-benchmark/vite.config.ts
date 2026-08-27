import { createFarmRendererPlugin } from "@farm.js/react/vite";
import { defineConfig } from "vite";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";
const reactivity = process.env.FARM_REACTIVITY === "static" ? "static" : "hybrid";

export default defineConfig({
  base: "./",
  css: {
    postcss: { plugins: [] },
  },
  plugins: createFarmRendererPlugin({
    rendererOptions: {
      experimental: {
        compiler: compilerEnabled
          ? {
              mode: "infer",
              onUnsupported: "error",
              reactivity,
              report: true,
            }
          : false,
      },
    },
  }),
  build: {
    assetsDir: "dist",
    emptyOutDir: true,
    outDir: "build",
    rollupOptions: {
      output: {
        entryFileNames: "dist/main.js",
      },
    },
  },
});
