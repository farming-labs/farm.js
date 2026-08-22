import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(__dirname),
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // Fixtures that bundle a config or run a real build finish in about two seconds
    // on their own, but can pass the 5s default when the whole suite competes for
    // the machine. Vite's own config scales this the same way.
    testTimeout: process.env.CI ? 60_000 : 30_000,
    hookTimeout: process.env.CI ? 60_000 : 30_000,
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.*", "**/*.spec.*"],
    },
  },
});
