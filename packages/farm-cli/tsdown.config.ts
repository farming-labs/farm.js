import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  external: ["@farmjs/core", "commander"],
  splitting: false,
  sourcemap: true,
});
