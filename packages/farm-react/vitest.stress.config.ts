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
    environment: "jsdom",
    fileParallelism: false,
    globals: true,
    include: [
      "src/__tests__/compiler-runtime-recursive-host-blocks.test.tsx",
      "src/__tests__/compiler-runtime-keyed-array-reorder-hints.test.tsx",
      "src/__tests__/compiler-runtime-keyed-array-sort-hints.test.tsx",
    ],
    setupFiles: ["src/__tests__/stress.setup.ts"],
    testNamePattern: /3,000 deterministic recursive updates|4,096 rows/,
    testTimeout: 30_000,
  },
});
