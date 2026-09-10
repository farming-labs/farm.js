import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-search-test-core",
      resolveId(id) {
        return id === "@farm.js/core/plugin" ? "\0farm-search-test-core" : undefined;
      },
      load(id) {
        if (id === "\0farm-search-test-core") {
          return "export const definePlugin = (plugin) => plugin;";
        }
      },
    },
  ],
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
