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
      "@farm.js/web-vitals/client": fileURLToPath(new URL("./src/client.ts", import.meta.url)),
    },
  },
  plugins: [
    {
      name: "farm-web-vitals-test-core",
      resolveId(id) {
        if (id === "@farm.js/core/plugin") return "\0farm-web-vitals-test-core";
        if (id === "@farm.js/core/client/plugin") return "\0farm-web-vitals-test-client-plugin";
        return undefined;
      },
      load(id) {
        if (id === "\0farm-web-vitals-test-core") {
          return "export const definePlugin = (plugin) => plugin;";
        }
        if (id === "\0farm-web-vitals-test-client-plugin") {
          return "export {};";
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
