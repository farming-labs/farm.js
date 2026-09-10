import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-federation-test-core",
      resolveId(id) {
        return id === "@farm.js/core/plugin" ? "\0farm-federation-test-core" : undefined;
      },
      load(id) {
        if (id === "\0farm-federation-test-core") {
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
