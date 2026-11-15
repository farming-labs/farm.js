import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    // Mirror @preact/preset-vite so React-shaped core components run on preact/compat.
    alias: [
      { find: /^react\/jsx-(dev-)?runtime$/, replacement: "preact/jsx-runtime" },
      { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
      { find: /^react(-dom)?$/, replacement: "preact/compat" },
    ],
    // Resolve those from this package, which also keeps a single Preact instance.
    dedupe: ["preact"],
  },
  test: {
    environment: "node",
  },
});
