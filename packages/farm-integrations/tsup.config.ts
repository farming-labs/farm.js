import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "better-auth": "src/better-auth.ts",
    authjs: "src/authjs.ts",
    clerk: "src/clerk.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react"],
  splitting: false,
  sourcemap: true,
});
