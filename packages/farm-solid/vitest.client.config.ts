import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin({ ssr: false })],
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
    include: ["src/**/client.test.ts", "src/**/client-route.test.tsx"],
    server: {
      deps: {
        inline: ["solid-js"],
      },
    },
  },
});
