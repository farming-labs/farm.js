/**
 * Nitro-based production build for RSC (React Server Components).
 * Wraps the built RSC entry (fetch handler) in a Nitro server for Vercel etc.
 * Based on: https://github.com/hi-ogawa/vite-plugins (packages/nitro), vite-plugin-rsc-deploy-example.
 */

import path from "path";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "fs";
import type { NitroConfig } from "nitro/config";
import { resolveRscBuildOutputPath } from "./build-paths.js";

const MANIFEST_FILENAME = "__vite_rsc_assets_manifest.js";
const MIN_MANIFEST_BYTES = 100; // real manifest is ~500+, stub is 64
const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 15_000;

/**
 * Wait for the RSC plugin to write the assets manifest to dist/rsc (it may run after closeBundle(ssr)).
 * Polls until the file exists and size > MIN_MANIFEST_BYTES or timeout.
 */
export function waitForRscManifest(
  root: string,
  outDir: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const manifestPath = resolveRscBuildOutputPath(root, outDir, "rsc", MANIFEST_FILENAME);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        if (existsSync(manifestPath)) {
          const size = statSync(manifestPath).size;
          if (size >= MIN_MANIFEST_BYTES) {
            resolve();
            return;
          }
        }
      } catch {
        // ignore
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timeout waiting for RSC manifest at ${manifestPath}`));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/**
 * Wait until all RSC build outputs exist (rsc index, ssr index, manifest). Use in buildEnd(ssr) after a short delay.
 */
export function waitForRscOutputs(
  root: string,
  outDir: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const rendererPath = resolveRscBuildOutputPath(root, outDir, "rsc", "index.js");
  const ssrPath = resolveRscBuildOutputPath(root, outDir, "ssr", "index.js");
  const manifestInRsc = resolveRscBuildOutputPath(root, outDir, "rsc", MANIFEST_FILENAME);
  const manifestInSsr = resolveRscBuildOutputPath(root, outDir, "ssr", MANIFEST_FILENAME);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const manifestPath = existsSync(manifestInRsc) ? manifestInRsc : manifestInSsr;
        if (
          existsSync(rendererPath) &&
          existsSync(ssrPath) &&
          existsSync(manifestPath) &&
          statSync(manifestPath).size >= MIN_MANIFEST_BYTES
        ) {
          resolve();
          return;
        }
      } catch {
        // ignore
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timeout waiting for RSC outputs under ${path.join(root, outDir)}`));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/** Write a physical entry file. Use relative imports so we can externalize and copy dist into output. */
function writeRscEntryFile(buildDir: string, rendererPath: string, ssrPath?: string): string {
  const resolvedRenderer = path.resolve(rendererPath);
  const resolvedSsr = ssrPath ? path.resolve(ssrPath) : null;
  // Relative to buildDir (.nitro) -> e.g. ../dist/rsc/index.js
  const relRenderer = path.relative(buildDir, resolvedRenderer).replace(/\\/g, "/");
  const relSsr = resolvedSsr ? path.relative(buildDir, resolvedSsr).replace(/\\/g, "/") : null;
  const setSsLoader = relSsr
    ? `globalThis.__VITE_RSC_LOAD_SSR__ = () => import("./${relSsr}");`
    : "";
  const code = `
${setSsLoader}
import * as entryExports from "./${relRenderer}";
import { defineEventHandler } from "h3";

function getFetchHandler(exports) {
  const def = exports?.default;
  if (def && typeof def === "object" && "fetch" in def && typeof def.fetch === "function") return def.fetch;
  if (typeof def === "function") return def;
  throw new Error("Invalid RSC server handler: expected default.fetch or default function");
}

const handler = getFetchHandler(entryExports);

function createRscRequest(event) {
  const node = event.node;
  if (!node?.req || !node?.res) return event.req;

  const controller = new AbortController();
  const cleanup = () => {
    node.req.off("aborted", abort);
    node.res.off("close", close);
    node.res.off("finish", cleanup);
  };
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
    cleanup();
  };
  const close = () => {
    if (!node.res.writableEnded) abort();
    else cleanup();
  };

  node.req.once("aborted", abort);
  node.res.once("close", close);
  node.res.once("finish", cleanup);
  if (node.req.aborted) abort();

  return new Request(event.req, { signal: controller.signal });
}

export default defineEventHandler((event) => handler(createRscRequest(event), {
  waitUntil: (promise) => event.waitUntil(promise),
}));
`.trim();
  const entryPath = path.join(buildDir, "rsc-entry.mjs");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(entryPath, code, "utf-8");
  return entryPath;
}

export type BuildRscNitroOptions = {
  rendererPath: string;
  publicDir: string;
  ssrPath?: string;
  assetsDir?: string;
  root: string;
  outputDir?: string;
  preset?: string;
};

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

  const { build, copyPublicAssets, createNitro, prepare } = await import("nitro");

  console.log(`[FARM] Building RSC server with Nitro (preset: ${preset})...`);

  const buildDir = path.join(root, ".nitro");
  const serverDir = path.join(outputDir, "server");
  const publicOutDir = path.join(outputDir, "public");

  const entryPath = writeRscEntryFile(buildDir, rendererPath, ssrPath);

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
    renderer: { entry: entryPath },
    // The prebuilt RSC/SSR bundles are copied after Nitro finishes, so Nitro's
    // module graph cannot otherwise see their bare package imports. Trace both
    // entry points explicitly to keep node-server output self-contained.
    externals: {
      traceInclude: [rendererPath, ...(ssrPath ? [ssrPath] : [])],
    },
    // Externalize rsc/ssr so we don't bundle (they reference Vite-generated manifest). We copy dist into server output after build.
    rollupConfig: {
      external: (id: string) =>
        id.includes("../dist/") || id.includes("dist/rsc") || id.includes("dist/ssr"),
    },
    compatibilityDate: "2024-12-01",
    minify: true,
  };

  const nitro = await createNitro(config);
  await prepare(nitro);
  await copyPublicAssets(nitro);
  await build(nitro);
  await nitro.close();

  // Copy dist into server so runtime relative imports resolve. Handle missing dir (e.g. buildApp order).
  const serverDistDir = path.join(serverDir, "dist");
  const rscSrc = path.dirname(path.resolve(rendererPath));
  const ssrSrc = ssrPath ? path.dirname(path.resolve(ssrPath)) : null;
  mkdirSync(serverDistDir, { recursive: true });
  const copyDir = (src: string, dest: string) => {
    if (!existsSync(src)) return;
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) {
      const srcPath = path.join(src, name);
      const destPath = path.join(dest, name);
      if (statSync(srcPath).isDirectory()) copyDir(srcPath, destPath);
      else copyFileSync(srcPath, destPath);
    }
  };
  copyDir(rscSrc, path.join(serverDistDir, "rsc"));
  if (ssrSrc) copyDir(ssrSrc, path.join(serverDistDir, "ssr"));
  // Stub manifest if missing (RSC plugin may write it after our hook runs)
  const rscDestDir = path.join(serverDistDir, "rsc");
  const manifestDest = path.join(rscDestDir, "__vite_rsc_assets_manifest.js");
  if (!existsSync(manifestDest)) {
    mkdirSync(rscDestDir, { recursive: true });
    writeFileSync(
      manifestDest,
      "export default { serverResources: {}, clientReferenceDeps: {} };",
      "utf-8",
    );
  }

  // Nitro may group the entry under chunks/build or chunks/_ depending on the
  // selected builder. Find it by name and make copied-dist imports relative to
  // the emitted chunk so the output survives being moved away from the project.
  const entryChunkPaths: string[] = [];
  const findEntryChunks = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const candidate = path.join(dir, name);
      if (statSync(candidate).isDirectory()) findEntryChunks(candidate);
      else if (name === "rsc-entry.mjs") entryChunkPaths.push(candidate);
    }
  };
  findEntryChunks(path.join(serverDir, "chunks"));
  for (const entryChunkPath of entryChunkPaths) {
    let code = readFileSync(entryChunkPath, "utf-8");
    const relativeImport = (target: string) => {
      const relative = path.relative(path.dirname(entryChunkPath), target).replace(/\\/g, "/");
      return relative.startsWith(".") ? relative : `./${relative}`;
    };
    // Match any path that ends with dist/rsc/index.js or dist/ssr/index.js (minified, no spaces)
    code = code.replace(
      /(["'`])[^"'`]*?dist\/rsc\/index\.js\1/g,
      JSON.stringify(relativeImport(path.join(serverDistDir, "rsc", "index.js"))),
    );
    code = code.replace(
      /(["'`])[^"'`]*?dist\/ssr\/index\.js\1/g,
      JSON.stringify(relativeImport(path.join(serverDistDir, "ssr", "index.js"))),
    );
    writeFileSync(entryChunkPath, code, "utf-8");
  }

  // Patch SSR bundle: inject production client CSS href and bootstrap script so HTML has styles and hydration works
  const ssrIndexPath = path.join(serverDistDir, "ssr", "index.js");
  const manifestPath = path.join(serverDistDir, "rsc", MANIFEST_FILENAME);
  let bootstrapScriptContent = "";
  let clientEntryHref = "";
  const RSC_CALL_SERVER_PLACEHOLDER =
    "(function(){if(typeof globalThis.__viteRscCallServer!=='function'){globalThis.__viteRscCallServer=function(){return Promise.reject(new Error(\"Farm.js: server actions not ready\"));}}})();\n";
  if (existsSync(manifestPath)) {
    try {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const start = manifestContent.indexOf("{");
      const end = manifestContent.lastIndexOf("}") + 1;
      if (start >= 0 && end > start) {
        const manifest = JSON.parse(manifestContent.slice(start, end)) as {
          bootstrapScriptContent?: string;
        };
        bootstrapScriptContent = manifest.bootstrapScriptContent || "";
        const importMatch = bootstrapScriptContent.match(
          /^import\s*\(\s*["']([^"']+)["']\s*\)\s*$/,
        );
        if (importMatch) clientEntryHref = importMatch[1];
      }
    } catch {
      // ignore
    }
  }
  const fullBootstrap = bootstrapScriptContent
    ? RSC_CALL_SERVER_PLACEHOLDER + bootstrapScriptContent
    : "";
  // Patch manifest so production SSR gets bootstrap with __viteRscCallServer placeholder (SSR reads assetsManifest.bootstrapScriptContent)
  if (fullBootstrap && existsSync(manifestPath)) {
    try {
      let manifestCode = readFileSync(manifestPath, "utf-8");
      const escaped = JSON.stringify(bootstrapScriptContent);
      const escapedFull = JSON.stringify(fullBootstrap);
      if (manifestCode.includes(escaped) && escaped !== escapedFull) {
        manifestCode = manifestCode.replace(escaped, escapedFull);
        writeFileSync(manifestPath, manifestCode, "utf-8");
      }
    } catch {
      // ignore
    }
  }
  if (existsSync(ssrIndexPath)) {
    const assetsDir = path.join(publicDir, "assets");
    let clientCssHref = "";
    if (existsSync(assetsDir)) {
      const files = readdirSync(assetsDir);
      const cssFile = files.find((f) => f.endsWith(".css"));
      if (cssFile) clientCssHref = "/assets/" + cssFile;
    }
    try {
      let ssrCode = readFileSync(ssrIndexPath, "utf-8");
      if (ssrCode.includes("__FARM_CLIENT_CSS_HREF__")) {
        ssrCode = ssrCode.replace("__FARM_CLIENT_CSS_HREF__", clientCssHref);
      }
      if (clientEntryHref && ssrCode.includes("__FARM_CLIENT_ENTRY_HREF__")) {
        ssrCode = ssrCode.replace(
          /(CLIENT_ENTRY_HREF\s*=\s*)"__FARM_CLIENT_ENTRY_HREF__"/,
          "$1" + JSON.stringify(clientEntryHref),
        );
      }
      if (fullBootstrap && ssrCode.includes("__FARM_BOOTSTRAP_SCRIPT__")) {
        ssrCode = ssrCode.replace(
          /=\s*["']__FARM_BOOTSTRAP_SCRIPT__["']/,
          "= " + JSON.stringify(fullBootstrap),
        );
      }
      writeFileSync(ssrIndexPath, ssrCode, "utf-8");
    } catch {
      // ignore
    }
  }

  console.log("[FARM] RSC Nitro build completed");
  console.log(`[FARM] Output: ${outputDir}`);
}
