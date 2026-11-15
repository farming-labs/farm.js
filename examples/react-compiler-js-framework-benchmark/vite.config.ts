import { createFarmRendererPlugin } from "@farm.js/react/vite";
import { defineConfig } from "vite";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";
const reactivity = process.env.FARM_REACTIVITY === "static" ? "static" : "hybrid";
// The compiler mounts this app's createRoot root without React DOM by default;
// FARM_REACT_ROOT=react-dom keeps React DOM for comparison.
const compiledRoot = process.env.FARM_REACT_ROOT !== "react-dom";

export default defineConfig({
  base: "./",
  // Workspace renderer dependencies must use the fixture's pinned React copy too.
  resolve: { dedupe: ["react", "react-dom"] },
  css: {
    postcss: { plugins: [] },
  },
  plugins: createFarmRendererPlugin({
    rendererOptions: {
      compiler: compilerEnabled
        ? {
            mode: "infer",
            onUnsupported: "error",
            reactivity,
            report: true,
            compiledRoot,
          }
        : false,
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
