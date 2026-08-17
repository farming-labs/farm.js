import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    dev: "src/dev.ts",
    build: "src/build.ts",
    "add-integration": "src/add-integration.ts",
    telemetry: "src/telemetry.ts",
  },
  format: ["cjs", "esm"],
  // DTS generation is disabled here due a rolldown dts runtime-symbol failure.
  // This package currently does not publish a `types` entry.
  dts: false,
  clean: true,
  external: ["@farm.js/core", "@farm.js/tunnel", "commander", "croner"],
  splitting: false,
  sourcemap: true,
});
