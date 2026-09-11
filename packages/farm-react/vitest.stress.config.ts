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
      "src/__tests__/compiler-runtime-keyed-array-map-reorder-hints.test.tsx",
      "src/__tests__/compiler-runtime-keyed-array-structural-reorder-hints.test.tsx",
      "src/__tests__/compiler-runtime-keyed-array-append-hints.test.tsx",
      "src/__tests__/compiler-runtime-keyed-array-prepend-hints.test.tsx",
    ],
    setupFiles: ["src/__tests__/stress.setup.ts"],
    testNamePattern:
      /2,000 deterministic mapped reorder updates|2,000 deterministic mapped reversal parity updates|2,000 queued reverse, map, and reverse updates|2,000 reverse-or-sort then map updates|2,000 queued reorder then standalone map updates|2,000 queued map then reorder updates|2,000 queued map and consecutive reorder updates|2,000 mapped structural removals|2,000 randomized interleaved map and structural removals|2,000 randomized terminal structural-map row transitions|2,000 randomized mapped terminal-structural row transitions|2,000 randomized queued mapped structural transitions|2,000 randomized queued structural mapped transitions|2,000 randomized queued structural mapped reorders|2,000 randomized structural removals, appends, and maps|2,000 randomized removals, maps, and later appends|2,000 randomized structural prepend updates|2,000 randomized mapped structural prepends|3,000 deterministic recursive updates|4,096 rows/,
    testTimeout: 30_000,
  },
});
