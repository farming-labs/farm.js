/**
 * Nitro-based production build for RSC (React Server Components).
 * Wraps the built RSC entry (fetch handler) in a Nitro server so it can be
 * deployed to Vercel and other platforms without custom post-build scripts.
 *
 * Based on the approach from:
 * - https://github.com/hi-ogawa/vite-plugins (packages/nitro)
 * - https://github.com/hi-ogawa/vite-plugin-rsc-deploy-example
 */

import path from "path";
import { pathToFileURL } from "url";
import { build, copyPublicAssets, createNitro, prepare } from "nitro";
import type { NitroConfig } from "nitro/config";
import type { Plugin } from "rollup";
import { logger } from "../utils";

const VIRTUAL_RENDERER_ENTRY = "virtual:rsc-renderer-entry";
const VIRTUAL_RENDERER_INNER = "virtual:rsc-renderer-inner";
const VIRTUAL_SSR_INNER = "virtual:rsc-ssr-inner";

/**
 * Rollup plugin: resolve virtual renderer/SSR ids and provide the virtual entry that wraps the RSC handler.
 */
function rscRendererResolvePlugin(rendererPath: string, ssrPath?: string): Plugin {
  const resolvedRenderer = path.resolve(rendererPath);
  const rendererUrl = pathToFileURL(resolvedRenderer).href;
  const ssrUrl = ssrPath ? pathToFileURL(path.resolve(ssrPath)).href : null;
  return {
    name: "rsc-renderer-resolve",
    resolveId(source: string) {
      if (source === VIRTUAL_RENDERER_ENTRY) return "\0" + VIRTUAL_RENDERER_ENTRY;
      if (source === VIRTUAL_RENDERER_INNER) return rendererUrl;
      if (source === VIRTUAL_SSR_INNER) return ssrUrl ?? null;
      return null;
    },
    load(id: string) {
      if (id !== "\0" + VIRTUAL_RENDERER_ENTRY) return null;
      const setSsLoader = ssrUrl
        ? `globalThis.__VITE_RSC_LOAD_SSR__ = () => import("${VIRTUAL_SSR_INNER}");`
        : "";
      return `
${setSsLoader}
import * as entryExports from "${VIRTUAL_RENDERER_INNER}";
import { defineEventHandler } from "h3";

function getFetchHandler(exports) {
  const def = exports?.default;
  if (def && typeof def === "object" && "fetch" in def && typeof def.fetch === "function") return def.fetch;
  if (typeof def === "function") return def;
  throw new Error("Invalid RSC server handler: expected default.fetch or default function");
}

const handler = getFetchHandler(entryExports);
export default defineEventHandler((event) => handler(event.req, {
  waitUntil: (promise) => event.waitUntil(promise),
}));
`.trim();
    },
  };
}

export type BuildRscNitroOptions = {
  /** Absolute path to the built RSC entry (e.g. dist/rsc/index.js). */
  rendererPath: string;
  /** Absolute path to the client build output (static assets). */
  publicDir: string;
  /** Optional path to the built SSR entry (e.g. dist/ssr/index.js) so the RSC handler can render HTML in production. */
  ssrPath?: string;
  /** Optional assets subdirectory (e.g. "assets") for cache headers. */
  assetsDir?: string;
  /** Project root (for Nitro buildDir). */
  root: string;
  /** Output directory (default: root/.output). */
  outputDir?: string;
  /** Nitro preset (default: "vercel" for serverless, or "node-server" for preview). */
  preset?: string;
};

/**
 * Build a Nitro server that runs the RSC fetch handler.
 * Call this after Vite has built the rsc, ssr, and client environments.
 */
export async function buildRscNitro(options: BuildRscNitroOptions): Promise<void> {
  const {
    rendererPath,
    publicDir,
    ssrPath,
    assetsDir,
    root,
    outputDir = path.join(root, ".output"),
    preset = "vercel",
  } = options;

  logger.info(`🚀 Building RSC server with Nitro (preset: ${preset})...`);

  const buildDir = path.join(root, ".nitro");
  const serverDir = path.join(outputDir, "server");
  const publicOutDir = path.join(outputDir, "public");

  const publicAssets: NitroConfig["publicAssets"] = [
    { dir: publicDir, baseURL: "/", maxAge: 31536000 },
  ];
  if (assetsDir) {
    publicAssets.push({
      dir: path.join(publicDir, assetsDir),
      baseURL: `/${assetsDir}`,
      maxAge: 31536000,
    });
  }

  const config: NitroConfig = {
    preset,
    rootDir: root,
    srcDir: root,
    buildDir,
    dev: false,
    output: {
      dir: outputDir,
      serverDir,
      publicDir: publicOutDir,
    },
    publicAssets,
    renderer: VIRTUAL_RENDERER_ENTRY,
    rollupConfig: {
      plugins: [rscRendererResolvePlugin(rendererPath, ssrPath) as any],
    },
    compatibilityDate: "2024-12-01",
    minify: true,
  };

  const nitro = await createNitro(config);
  await prepare(nitro);
  await copyPublicAssets(nitro);
  await build(nitro);
  await nitro.close();

  logger.success("✅ RSC Nitro build completed");
  logger.info(`📁 Output: ${outputDir}`);
}
