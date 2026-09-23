import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-partytown-test-core",
      resolveId(id) {
        return id === "@farm.js/core/plugin" ? "\0farm-partytown-test-core" : undefined;
      },
      load(id) {
        if (id === "\0farm-partytown-test-core") {
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
