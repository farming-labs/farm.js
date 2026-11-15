import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: [
      // Vitest resolves Solid's server build under Node, where `onMount` never runs.
      {
        find: /^solid-js$/,
        replacement: local("./node_modules/solid-js/dist/solid.js"),
      },
      {
        find: /^solid-js\/web$/,
        replacement: local("./node_modules/solid-js/web/dist/web.js"),
      },
    ],
  },
  plugins: [
    {
      // The browser hook only imports these once Farm has compiled it into a real client build.
      name: "farm-bot-test-hook-imports",
      enforce: "pre",
      resolveId(id) {
        return id === "@farm.js/bot/client" || id === "@farm.js/bot/provider-widget"
          ? { id, external: true }
          : undefined;
      },
    },
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    sequence: { concurrent: false },
    // Inlined so `solid-js/web` picks up the same browser build through the aliases above.
    server: { deps: { inline: [/solid-js/] } },
  },
});
