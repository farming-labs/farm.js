import path from "path";
import { defineConfig } from "vitest/config";
import { farmTestDefaults } from "../../vitest.shared";

export default defineConfig({
  root: path.resolve(__dirname),
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    ...farmTestDefaults,
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.*", "**/*.spec.*"],
    },
  },
});
