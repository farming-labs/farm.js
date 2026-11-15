import { defineConfig } from "vitest/config";

// Tests render components to static HTML with react-dom/server, so no DOM
// environment is needed. esbuild handles the JSX in .tsx test files.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
