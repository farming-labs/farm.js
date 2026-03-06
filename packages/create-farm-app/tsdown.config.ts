import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    utils: "src/utils.ts",
  },
  format: ["cjs", "esm"],
  // DTS generation is disabled here due a rolldown dts runtime-symbol failure.
  // This package currently does not publish a `types` entry.
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
});
