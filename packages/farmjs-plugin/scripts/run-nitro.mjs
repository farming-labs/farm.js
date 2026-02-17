#!/usr/bin/env node
/**
 * Run Nitro after Vite build. Use in package.json: "build": "vite build && node node_modules/@farmjs/plugin/scripts/run-nitro.mjs"
 * Resolves from project root (cwd) so dist/ and .output are in the right place.
 */
import path from "node:path";
import { buildRscNitro } from "../dist/rsc/nitro-build.js";

const root = process.cwd();
const outDir = process.env.RSC_OUT_DIR || "dist";

await buildRscNitro({
  root,
  rendererPath: path.join(root, outDir, "rsc", "index.js"),
  publicDir: path.join(root, outDir, "client"),
  ssrPath: path.join(root, outDir, "ssr", "index.js"),
  preset: process.env.NITRO_PRESET || "vercel",
});
