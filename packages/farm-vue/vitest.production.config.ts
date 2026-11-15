import { defineConfig } from "vitest/config";

// Vue picks its production or development build from NODE_ENV when Vitest starts, so the tests
// for behavior that only Vue's production build has run in their own Vitest process.
process.env.NODE_ENV = "production";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.production.test.ts"],
  },
});
