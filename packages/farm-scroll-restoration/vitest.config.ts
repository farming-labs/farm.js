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
      "@farm.js/scroll-restoration/client": fileURLToPath(
        new URL("./src/client.ts", import.meta.url),
      ),
    },
  },
  plugins: [
    {
      name: "farm-scroll-restoration-test-core",
      resolveId(id) {
        if (id === "@farm.js/core/plugin") return "\0farm-scroll-restoration-test-core";
        return undefined;
      },
      load(id) {
        if (id === "\0farm-scroll-restoration-test-core") {
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
