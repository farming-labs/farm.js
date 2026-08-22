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
    // Windows: the threads pool segfaults during teardown, and one process per file
    // exhausts the socket budget for the fixtures that bind real servers.
    ...(process.platform === "win32"
      ? { pool: "forks" as const, poolOptions: { forks: { minForks: 1, maxForks: 1 } } }
      : {}),
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.*", "**/*.spec.*"],
    },
  },
});
