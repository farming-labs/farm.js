import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
