import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      "@farm.js/progress/client": fileURLToPath(new URL("./src/client.ts", import.meta.url)),
    },
  },
  plugins: [
    {
      name: "farm-progress-test-core",
      resolveId(id) {
        if (id === "@farm.js/core/plugin") return "\0farm-progress-test-core";
        return undefined;
      },
      load(id) {
        if (id === "\0farm-progress-test-core") {
          return "export const definePlugin = (plugin) => plugin;";
        }
        return undefined;
      },
    },
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    sequence: { concurrent: false },
  },
});
