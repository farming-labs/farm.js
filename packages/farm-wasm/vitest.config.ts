import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "farm-wasm-test-core",
      resolveId(id) {
        if (id === "@farm.js/core/plugin") return "\0farm-wasm-test-core";
      },
      load(id) {
        if (id === "\0farm-wasm-test-core")
          return "export const definePlugin = (plugin) => plugin;";
      },
    },
  ],
  css: { postcss: { plugins: [] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
