#!/usr/bin/env node
/**
 * Build .vercel/output (Build Output API v3) from .output (Nitro) + dist.
 * Run after `pnpm build`. Then: vercel deploy --prebuilt
 */
import path from "node:path";
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const root = process.cwd();
const outputDir = path.join(root, ".output");
const distDir = path.join(root, "dist");
const vercelOut = path.join(root, ".vercel", "output");

if (!existsSync(outputDir)) {
  console.error("Missing .output — run pnpm build first.");
  process.exit(1);
}

// Clean so we don't mix old output with new
if (existsSync(vercelOut)) rmSync(vercelOut, { recursive: true });

const staticDir = path.join(vercelOut, "static");
const funcDir = path.join(vercelOut, "functions", "__fallback.func");
mkdirSync(staticDir, { recursive: true });
mkdirSync(funcDir, { recursive: true });

// Nitro server (handler + chunks + dist/rsc)
cpSync(path.join(outputDir, "server"), funcDir, { recursive: true });

// Add runtime deps to function so dist/ssr and dist/rsc can resolve react, etc.
const appPkgPath = path.join(root, "package.json");
if (existsSync(appPkgPath)) {
  const appPkg = JSON.parse(readFileSync(appPkgPath, "utf-8"));
  const deps = { ...(appPkg.dependencies || {}), ...(appPkg.devDependencies || {}) };
  delete deps["@farmjs/core"];
  delete deps["@farmjs/plugin"];
  ["@tailwindcss/vite", "@types/react", "@types/react-dom", "@vitejs/plugin-react", "@vitejs/plugin-rsc", "tailwindcss", "typescript", "vite"].forEach((k) => delete deps[k]);
  const funcPkg = {
    name: "rsc-fallback",
    version: "1.0.0",
    type: "module",
    private: true,
    dependencies: deps,
  };
  writeFileSync(path.join(funcDir, "package.json"), JSON.stringify(funcPkg, null, 2), "utf-8");
  const shouldInstall =
    process.env.FARM_SKIP_NPM_INSTALL !== "1" && process.env.SKIP_NPM_INSTALL !== "1";
  if (shouldInstall) {
    try {
      execSync("npm install --omit=dev", {
        cwd: funcDir,
        stdio: "inherit",
        timeout: 120_000,
      });
    } catch (err) {
      const timedOut = typeof err === "object" && err && "signal" in err && err.signal === "SIGTERM";
      console.warn(
        `[vercel-output] npm install in function dir failed${timedOut ? " (timed out)" : ""}; ` +
          "deploy may fail at runtime if dist needs node_modules.",
      );
    }
  } else {
    console.warn("[vercel-output] Skipping npm install in function dir (FARM_SKIP_NPM_INSTALL=1).");
  }
}

// Static assets: prefer .output/public (Nitro copyPublicAssets), then .nitro/vite/dist/client, then dist/client
const publicDir = path.join(outputDir, "public");
const nitroClientDir = path.join(root, ".nitro", "vite", "dist", "client");
const legacyClientDir = path.join(distDir, "client");
if (existsSync(publicDir) && readdirSync(publicDir).length > 0) {
  cpSync(publicDir, staticDir, { recursive: true });
}
if (!existsSync(path.join(staticDir, "assets")) && existsSync(nitroClientDir)) {
  cpSync(nitroClientDir, staticDir, { recursive: true });
}
if (!existsSync(path.join(staticDir, "assets")) && existsSync(legacyClientDir)) {
  cpSync(legacyClientDir, staticDir, { recursive: true });
}

// dist/ssr and dist/rsc already came from cpSync(server) above — they are the PATCHED bundles from nitro-build.
// Do not overwrite with .nitro/vite/dist/ssr (unpatched) or we lose CSS and bootstrap injection.
const serverDistDir = path.join(funcDir, "dist");
const nitroSsrDir = path.join(root, ".nitro", "vite", "dist", "ssr");
const legacySsrDir = path.join(distDir, "ssr");
const ssrSrc = existsSync(nitroSsrDir) ? nitroSsrDir : legacySsrDir;
const ssrDest = path.join(serverDistDir, "ssr");
if (!existsSync(ssrDest) && existsSync(ssrSrc)) {
  mkdirSync(path.join(serverDistDir, "ssr"), { recursive: true });
  cpSync(ssrSrc, ssrDest, { recursive: true });
}

const config = {
  version: 3,
  routes: [
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/__fallback" },
  ],
};
writeFileSync(path.join(vercelOut, "config.json"), JSON.stringify(config, null, 2), "utf-8");

console.log("[vercel-output] .vercel/output (v3) ready. Run: vercel deploy --prebuilt");
