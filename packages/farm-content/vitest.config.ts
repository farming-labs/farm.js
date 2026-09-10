import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-content-test-core",
      resolveId(id) {
        return id === "@farm.js/core/plugin" ? "\0farm-content-test-core" : undefined;
      },
      load(id) {
        if (id === "\0farm-content-test-core") {
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
