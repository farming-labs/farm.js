import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // Each runtime here runs better-auth migrations against SQLite, which takes a few
    // seconds and can pass the 5s default once the whole suite competes for the machine.
    testTimeout: process.env.CI ? 60_000 : 30_000,
    hookTimeout: process.env.CI ? 60_000 : 30_000,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
