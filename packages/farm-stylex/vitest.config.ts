import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-stylex-test-core",
      resolveId(id) {
        return id === "@farm.js/core/plugin" ? "\0farm-stylex-test-core" : undefined;
      },
      load(id) {
        if (id === "\0farm-stylex-test-core") {
          return "export const definePlugin = (plugin) => plugin;";
        }
      },
    },
  ],
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
