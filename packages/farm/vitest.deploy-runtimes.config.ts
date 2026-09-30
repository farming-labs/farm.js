import path from "node:path";
import { defineConfig } from "vitest/config";
import { farmTestDefaults } from "../../vitest.shared";

export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  test: {
    ...farmTestDefaults,
    environment: "node",
    globals: true,
    include: ["tests/deploy-runtimes/**/*.test.ts"],
    fileParallelism: false,
  },
});
