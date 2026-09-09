import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-hints-test-core",
      resolveId(id) {
        if (id === "@farm.js/core/plugin") return "\0farm-hints-test-core";
        if (id === "@farm.js/hints/client") return "\0farm-hints-test-client";
        return undefined;
      },
      load(id) {
        if (id === "\0farm-hints-test-core")
          return "export const definePlugin = (plugin) => plugin;";
        if (id === "\0farm-hints-test-client") {
          return "export const startHintsRuntime = () => undefined;";
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
