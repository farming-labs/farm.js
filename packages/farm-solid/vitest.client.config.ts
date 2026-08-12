import { defineConfig } from "vitest/config";

export default defineConfig({
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
    include: ["src/**/client.test.ts"],
    server: {
      deps: {
        inline: ["solid-js"],
      },
    },
  },
});
