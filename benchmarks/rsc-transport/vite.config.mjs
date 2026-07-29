import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        index: resolve("index.html"),
        renderer: resolve("src/render-js.mjs"),
      },
      output: {
        entryFileNames(chunk) {
          return chunk.name === "renderer" ? "assets/renderer.js" : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
