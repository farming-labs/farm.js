import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // The Vercel output test spawns the Eve adapter, which can pass the 5s default
    // when the whole suite competes for the machine.
    testTimeout: process.env.CI ? 60_000 : 30_000,
    hookTimeout: process.env.CI ? 60_000 : 30_000,
    environment: "node",
  },
});
