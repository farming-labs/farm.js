import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
