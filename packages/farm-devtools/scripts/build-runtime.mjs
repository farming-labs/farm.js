// Runtime-only build: transpile src to dist without typechecking.
//
// The docs deployment builds @farm.js/core with `build:runtime` (dts: false) to
// stay inside the Vercel build heap budget, so core ships no declarations there
// and `tsc` fails to resolve `@farm.js/core` at all. This mirrors core's own
// build/build:runtime split: the published `build` still runs tsc and emits
// declarations, while this path only has to produce loadable JS. Types stay
// covered by `pnpm type-check`, which runs against a full core build in CI.

import { build } from "esbuild";
import { readdir } from "node:fs/promises";

const entryPoints = (await readdir(new URL("../src/", import.meta.url)))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => `src/${name}`);

// bundle: false keeps the emitted module graph identical to the tsc output,
// so the relative "./types.js" style imports still resolve at runtime.
await build({
  entryPoints,
  outdir: "dist",
  bundle: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
});
