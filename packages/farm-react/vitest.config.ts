import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(__dirname),
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // Windows: the threads pool segfaults during teardown, so the run exits
    // non-zero with every test passing.
    ...(process.platform === "win32"
      ? { pool: "forks" as const, poolOptions: { forks: { minForks: 1, maxForks: 1 } } }
      : {}),
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
