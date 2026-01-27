import type { ResolvedFarmConfig } from "../config";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import { build as viteBuild } from "vite";
import { build as nitroBuild, createNitro, prepare, copyPublicAssets } from "nitro";
import { fromWebHandler } from "h3";
import path from "path";
import { logger } from "../utils";
import { virtualBundlePlugin } from "./virtual-bundle-plugin";
import type { OutputBundle } from "rollup";
import type { NitroConfig } from "nitro/config";

/**
 * Universal build using TanStack Start pattern
 * - Builds SSR bundle in memory
 * - Uses virtual bundle plugin to expose to Nitro
 * - Creates virtual entry wrapping Web Standard handler
 */
export async function buildUniversal(
  config: ResolvedFarmConfig,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
  options: {
    preset?: string;
    root?: string;
  } = {},
): Promise<void> {
  const root = options.root || config.root || process.cwd();
  const preset = options.preset || config.preset || "node-server";
  const srcDir = config.srcDir || "src";
  const distDir = config.distDir || ".farm";

  logger.info(`🚜 Building Farm.js application (universal) with preset: ${preset}...`);

  try {
    // Step 1: Build client bundle (to disk)
    logger.info("📦 Building client bundle...");
    const clientOutputDir = path.join(root, distDir, "client");
    await buildClient(config, root, srcDir, clientOutputDir);

    // Step 2: Build SSR bundle in memory
    logger.info("📦 Building SSR bundle (in memory)...");
    const { bundle: ssrBundle, entryFile: ssrEntryFile } = await buildSSRInMemory(
      config,
      root,
      srcDir,
    );

    // Step 3: Build with Nitro using virtual bundle
    logger.info(`🚀 Building server with Nitro (preset: ${preset})...`);
    await buildNitroUniversal(
      config,
      routeManager,
      apiRouteManager,
      serverRenderer,
      preset,
      root,
      distDir,
      ssrBundle,
      ssrEntryFile,
      clientOutputDir,
    );

    logger.success("✅ Build completed successfully!");
    logger.info(`📁 Output directory: ${path.join(root, distDir, ".output")}`);
  } catch (error) {
    logger.error(`❌ Build failed: ${error}`);
    throw error;
  }
}

/**
 * Build client bundle (to disk)
 */
async function buildClient(
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  outputDir: string,
) {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });

  await viteBuild({
    root,
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(root, srcDir, "app", "page.tsx"),
      },
    },
    plugins: [farmPlugin(config, pluginManager)],
    mode: "production",
  });
}

/**
 * Build SSR bundle in memory (write: false)
 * Uses server-entry.ts as the entry point which exports a Web Standard fetch handler
 */
async function buildSSRInMemory(
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
): Promise<{ bundle: OutputBundle; entryFile: string }> {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });

  let ssrBundle: OutputBundle;
  let ssrEntryFile: string;

  // Use server-entry.ts as the SSR entry point
  // This file exports a Web Standard fetch handler
  // Use file URL resolution for ESM compatibility
  let serverEntryPath: string;
  try {
    // Try to resolve using import.meta.url (ESM)
    if (typeof import.meta !== "undefined" && import.meta.url) {
      const currentFileUrl = new URL(import.meta.url);
      const nitroDir = path.dirname(currentFileUrl.pathname);
      serverEntryPath = path.resolve(nitroDir, "server-entry.ts");
    } else {
      // Fallback for CommonJS
      const nitroDir = __dirname;
      serverEntryPath = path.resolve(nitroDir, "server-entry.ts");
    }
  } catch {
    // Last resort: use relative path from source structure
    // This assumes the file structure: packages/farm/src/nitro/server-entry.ts
    serverEntryPath = path.resolve(root, "node_modules", "@farmjs", "core", "src", "nitro", "server-entry.ts");
  }
  
  const finalEntryPath = serverEntryPath;

  await viteBuild({
    root,
    build: {
      ssr: true,
      write: false, // ⭐ Keep in memory
      rollupOptions: {
        input: finalEntryPath,
      },
    },
    plugins: [
      farmPlugin(config, pluginManager),
      {
        name: "capture-ssr-bundle",
        generateBundle(_options, bundle) {
          ssrBundle = bundle;

          // Find entry file
          for (const [fileName, file] of Object.entries(bundle)) {
            if (file.type === "chunk" && file.isEntry) {
              ssrEntryFile = fileName;
              break;
            }
          }

          if (!ssrEntryFile) {
            throw new Error("No entry point found in SSR bundle");
          }
        },
      },
    ],
    mode: "production",
    resolve: {
      alias: {
        // Ensure server-entry can resolve farm modules
        // Use root-relative path for better compatibility
        farm: path.resolve(root, "node_modules", "@farmjs", "core", "src"),
      },
    },
  });

  return { bundle: ssrBundle!, entryFile: ssrEntryFile! };
}

/**
 * Build with Nitro using virtual bundle
 */
async function buildNitroUniversal(
  config: ResolvedFarmConfig,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
  preset: string,
  root: string,
  distDir: string,
  ssrBundle: OutputBundle,
  ssrEntryFile: string,
  clientOutputDir: string,
) {
  const outputDir = path.join(root, distDir, ".output");
  const virtualEntry = "#farm/entry";

  // Store managers in global for runtime access
  // Note: In serverless environments, the global scope persists across invocations
  // within the same function instance, so this should work
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__FARM_REGISTRY__ = {
      routeManager,
      apiRouteManager,
      serverRenderer,
    };
  }

  // Store route paths and other serializable data for runtime initialization
  // The managers themselves will be available from the global registry
  const routePaths: Record<string, string> = {};
  for (const [pattern, entry] of routeManager.getRoutes()) {
    const bundledPath = entry.modulePath
      .replace(/.*\/src\/app\//, "")
      .replace(/\.(tsx?|jsx?)$/, ".js");
    routePaths[pattern] = bundledPath;
  }

  const nitroConfig: NitroConfig = {
    preset,
    rootDir: root,
    srcDir: root,
    buildDir: path.join(root, distDir, ".nitro"),
    compatibilityDate: "2024-12-01",
    output: {
      dir: outputDir,
      serverDir: path.join(outputDir, "server"),
      publicDir: path.join(outputDir, "public"),
    },
    publicAssets: [
      {
        dir: clientOutputDir,
        maxAge: 31536000,
        baseURL: "/",
      },
    ],
    // Step 4: Set virtual entry as renderer
    renderer: virtualEntry,
    rollupConfig: {
      // Step 5: Add virtual bundle plugin
      plugins: [virtualBundlePlugin(ssrBundle) as any],
    },
    // Step 6: Define virtual entry that wraps Web Standard handler
    virtual: {
      [virtualEntry]: `
import { fromWebHandler } from 'h3'
import handler from '${ssrEntryFile}'
export default fromWebHandler(handler.fetch)
      `.trim(),
    },
    routeRules: {
      "/api/**": {
        cors: true,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "*",
        },
      },
      "/**": {
        prerender: false,
      },
    },
    externals: {
      external: ["react", "react-dom"],
    },
    runtimeConfig: {
      // Store serializable route metadata
      farm: {
        routePaths,
      },
      public: {},
    },
    minify: process.env.NODE_ENV === "production",
    sourceMap: true,
  };

  // Step 7: Build with Nitro
  const nitro = await createNitro(nitroConfig);
  await prepare(nitro);
  await copyPublicAssets(nitro);
  await build(nitro);
  await nitro.close();
}
