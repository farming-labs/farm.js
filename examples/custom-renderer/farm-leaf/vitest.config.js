import { defineConfig } from "vitest/config";

export default defineConfig({
  // Keep the workspace's PostCSS config out of these tests.
  css: { postcss: { plugins: [] } },
  test: { environment: "node" },
});
