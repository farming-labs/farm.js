/**
 * Post-build step: run Nitro after Vite build.
 * Use when the Nitro plugin's buildEnd doesn't run (e.g. single buildEnd after step 1).
 * Supports both .nitro/vite/dist (pipeline) and dist/ (legacy) output locations.
 *
 * Usage: vite build && node scripts/nitro-post.mjs
 * Or: pnpm build (if build script includes this)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { buildRscNitro } from "@farm.js/plugin/rsc";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(__dirname, "..");

const nitroDist = path.join(root, ".nitro", "vite", "dist");
const legacyDist = path.join(root, "dist");

const useNitroPipeline = existsSync(path.join(nitroDist, "rsc", "index.js"));
const baseDir = useNitroPipeline ? nitroDist : legacyDist;

await buildRscNitro({
  root,
  rendererPath: path.join(baseDir, "rsc", "index.js"),
  publicDir: path.join(baseDir, "client"),
  ssrPath: path.join(baseDir, "ssr", "index.js"),
  preset: process.env.NITRO_PRESET || "vercel",
});
