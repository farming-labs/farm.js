import { defineConfig } from "vitest/config";
import { farmTestDefaults } from "../../vitest.shared";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    ...farmTestDefaults,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
