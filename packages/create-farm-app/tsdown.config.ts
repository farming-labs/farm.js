import { defineConfig } from "tsdown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));

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
  alias: {
    "@farm.js/cli/add-integration": path.resolve(
      packageDirectory,
      "../farm-cli/src/add-integration.ts",
    ),
  },
  noExternal: [/^@farm\.js\/cli(?:\/.*)?$/],
  splitting: false,
  sourcemap: true,
});
