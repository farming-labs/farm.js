import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["browser"],
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: "node",
  },
});
