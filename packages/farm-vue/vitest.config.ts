import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: "node",
    // Run by vitest.production.config.ts, against Vue's production build.
    exclude: ["**/node_modules/**", "**/*.production.test.ts"],
  },
});
