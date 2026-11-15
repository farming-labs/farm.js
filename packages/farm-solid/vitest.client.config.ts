import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  // Hydratable DOM output, as production builds use (see src/vite.ts).
  // Fast Refresh is browser-only; its virtual module is not a Windows file URL
  // for Vitest's module runner. These tests exercise hydration and route state.
  plugins: [solidPlugin({ ssr: true, hot: false })],
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: [
      { find: /^solid-js\/web$/, replacement: "solid-js/web/dist/web.js" },
      { find: /^solid-js$/, replacement: "solid-js/dist/solid.js" },
    ],
  },
  ssr: {
    noExternal: ["solid-js"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/client.test.ts", "src/**/client-*.test.tsx"],
    server: {
      deps: {
        inline: ["solid-js"],
      },
    },
  },
});
