import type { ResolvedFarmConfig } from "../config";
import { resolveDeployOutputPath } from "../config";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import type { PluginManager } from "../plugin";
import { build as viteBuild, type Rollup } from "vite";
import * as nitro from "nitro";
import os from "os";
import path from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { builtinModules, createRequire } from "module";
import { logger } from "../utils";
import { getClientModuleMetadata } from "../utils/client-component";
import { isFarmMarkdownPageFile } from "../app-markdown";
import { virtualBundlePlugin } from "./virtual-bundle-plugin";
import type { ProgrammaticRedirectRoute } from "../routes";
import type { NitroConfig } from "nitro/config";
import {
  applyFarmWorkflowVercelCrons,
  prepareFarmWorkflowsForNitro,
  type PreparedFarmWorkflows,
} from "../workflows";
import {
  applyFarmCronVercelCrons,
  createFarmCronCloudflareConfig,
  mergeScheduledTasks,
  prepareFarmCronForNitro,
} from "../cron";
import { routeRulesToNitroRouteRules } from "../route-rules";
import { getFarmAppDirectories } from "../layers";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";
import {
  createFarmDocsLastModifiedManifest,
  FARM_DOCS_LAST_MODIFIED_MANIFEST,
} from "../docs/last-modified";
import {
  generateFarmDocsSearchClientRuntime,
  isFarmDocsSearchEnabled,
  resolveFarmDocsSearchClientModule,
} from "../docs/search-client";
import {
  createFarmRouteRuntimeManifest,
  validateFarmRouteRuntimeDeployment,
  writeFarmRouteRuntimeManifest,
} from "../route-runtime-manifest";
import type { FarmRouteRuntimeManifest } from "../route-runtime";
import { createFarmVercelRouteRuntimeFunctions } from "./vercel-route-runtime";

// Type alias for OutputBundle
type OutputBundle = Rollup.OutputBundle;
type UniversalPageRoute = {
  pattern: string;
  modulePath: string;
  source?: string;
};
type UniversalMetadataImageRoute = {
  pattern: string;
  kind: "opengraph" | "twitter";
  fileName: "opengraph-image" | "twitter-image";
  sourceType: "module" | "static";
  modulePath?: string;
  staticInfo?: {
    contentType: string;
    width: number;
    height: number;
    alt?: string;
    hash: string;
    byteLength: number;
  };
  data?: string;
};
type UniversalMiddlewareRoute = {
  path: string;
  filePath: string;
};

// Get __dirname equivalent for ESM
const _filename = typeof import.meta.url !== "undefined" ? fileURLToPath(import.meta.url) : "";
const _dirname = path.dirname(_filename);
const NODE_BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);
const NITRO_EXTERNAL_MODULES = new Set([
  "react",
  "react-dom",
  "react-dom/server",
  "@prisma/client",
  "@prisma/client/default",
  "@prisma/client/default.js",
  ".prisma/client",
  ".prisma/client/default",
  "better-sqlite3",
  "fsevents",
  "esbuild",
  "lightningcss",
  "rollup",
  "vite",
  "nitro",
  "nitropack",
  "sharp",
]);

function isCloudflareImagePreset(preset: string): boolean {
  return (
    preset === "cloudflare" || preset === "cloudflare-pages" || preset === "cloudflare-module"
  );
}

function resolveImageRuntime(
  config: ResolvedFarmConfig,
  preset: string,
): "none" | "node" | "cloudflare" {
  if (config.images.provider === "none") return "none";
  const cloudflarePreset = isCloudflareImagePreset(preset);
  if (config.images.provider === "node" && cloudflarePreset) {
    throw new Error('images.provider "node" cannot run in a Cloudflare deployment');
  }
  if (config.images.provider === "cloudflare" && !cloudflarePreset) {
    throw new Error('images.provider "cloudflare" requires a Cloudflare deployment preset');
  }
  return config.images.provider === "cloudflare" ||
    (config.images.provider === "auto" && cloudflarePreset)
    ? "cloudflare"
    : "node";
}

function isNitroRollupExternal(id: string): boolean {
  const normalizedId = id.replace(/\\/g, "/");

  return (
    NODE_BUILTIN_MODULES.has(id) ||
    NITRO_EXTERNAL_MODULES.has(id) ||
    normalizedId.startsWith(".prisma/") ||
    normalizedId.includes("/node_modules/@prisma/client/") ||
    normalizedId.includes("/node_modules/.prisma/client/")
  );
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function resolveBuildDocsContentDir(config: ResolvedFarmConfig, root: string): string | null {
  if (!config.docs?.enabled) return null;

  const configuredContentDir = config.docs.contentDir || config.docs.config.contentDir;
  if (typeof configuredContentDir === "string" && configuredContentDir.trim()) {
    const contentDir = path.isAbsolute(configuredContentDir)
      ? configuredContentDir
      : path.join(root, configuredContentDir);
    return existsSync(contentDir) ? contentDir : null;
  }

  const entryDir = config.docs.config.entry || trimSlashes(config.docs.entry) || "docs";
  const appDocsDir = path.join(root, config.srcDir || "src", "app", entryDir);
  if (existsSync(appDocsDir)) return appDocsDir;

  const rootDocsDir = path.join(root, entryDir);
  return existsSync(rootDocsDir) ? rootDocsDir : null;
}

function hasProjectPostcssConfig(root: string): boolean {
  const candidates = [
    "postcss.config.js",
    "postcss.config.cjs",
    "postcss.config.mjs",
    "postcss.config.ts",
    "postcss.config.json",
    ".postcssrc",
    ".postcssrc.json",
    ".postcssrc.js",
    ".postcssrc.cjs",
    ".postcssrc.mjs",
    ".postcssrc.ts",
  ];

  const projectRequire = createRequire(path.join(root, "package.json"));
  return candidates.some((file) => {
    try {
      projectRequire.resolve(`./${file}`);
      return true;
    } catch {
      return false;
    }
  });
}

async function findFarmConfigPath(root: string): Promise<string | null> {
  const fs = await import("fs/promises");
  const candidates = [
    "farm.config.ts",
    "farm.config.mts",
    "farm.config.js",
    "farm.config.mjs",
    "config.ts",
    "config.mts",
    "config.js",
    "config.mjs",
  ];

  for (const candidate of candidates) {
    const resolvedPath = path.join(root, candidate);
    try {
      await fs.access(resolvedPath);
      return resolvedPath;
    } catch {
      // Continue checking the next supported config path.
    }
  }

  return null;
}

function hasFarmMiddlewareConfig(config: ResolvedFarmConfig["middleware"]): boolean {
  if (!config) return false;
  if (Array.isArray(config)) return config.length > 0;

  const configRecord = config as Record<string, unknown>;
  return Boolean(
    configRecord.matcher ||
    configRecord.exclude ||
    configRecord.runtime ||
    configRecord.handler ||
    (Array.isArray(configRecord.handlers) && configRecord.handlers.length > 0),
  );
}

export async function discoverMiddlewareRoutes(
  appDir: string | readonly string[],
): Promise<UniversalMiddlewareRoute[]> {
  const fs = await import("fs/promises");
  const appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
  const routes = new Map<string, UniversalMiddlewareRoute>();

  async function walk(
    dir: string,
    routePath: string,
    discovered: UniversalMiddlewareRoute[],
  ): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const middlewareFile = entries.find(
      (entry) => entry.isFile() && /^middleware\.(tsx?|jsx?)$/.test(entry.name),
    );

    if (middlewareFile) {
      discovered.push({
        path: routePath,
        filePath: path.join(dir, middlewareFile.name),
      });
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) {
        continue;
      }

      const childRoutePath = routePath === "/" ? `/${entry.name}` : `${routePath}/${entry.name}`;
      await walk(path.join(dir, entry.name), childRoutePath, discovered);
    }
  }

  for (const sourceAppDir of appDirs) {
    const discovered: UniversalMiddlewareRoute[] = [];
    await walk(sourceAppDir, "/", discovered);
    for (const route of discovered) {
      routes.set(route.path, route);
    }
  }

  return Array.from(routes.values()).sort((a, b) => {
    const depthA = a.path.split("/").filter(Boolean).length;
    const depthB = b.path.split("/").filter(Boolean).length;
    return depthA - depthB || a.path.localeCompare(b.path);
  });
}

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
    pluginManager?: PluginManager;
    routeRuntimeManifest?: FarmRouteRuntimeManifest;
  } = {},
): Promise<void> {
  const root = options.root || config.root || process.cwd();
  const preset = options.preset || config.preset || "node-server";
  const srcDir = config.srcDir || "src";
  const distDir = config.distDir || ".farm";
  const deployOutputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const lifecyclePluginManager = options.pluginManager;

  logger.info(`🚜 Building Farm.js application (universal) with preset: ${preset}...`);

  try {
    const routeRuntimeManifest =
      options.routeRuntimeManifest ||
      (await createFarmRouteRuntimeManifest({
        config,
        routeManager,
        apiRouteManager,
        root,
      }));
    const runtimeValidation = validateFarmRouteRuntimeDeployment(routeRuntimeManifest, preset);
    for (const warning of runtimeValidation.warnings) {
      logger.warn(warning);
    }

    // Get page routes first (needed for both client and SSR builds)
    const pageRoutes: UniversalPageRoute[] = [];
    for (const [pattern, entry] of routeManager.getRoutes()) {
      pageRoutes.push({
        pattern,
        modulePath: entry.modulePath,
        ...(isFarmMarkdownPageFile(entry.modulePath)
          ? { source: readFileSync(entry.modulePath, "utf8") }
          : {}),
      });
    }
    logger.info(`📋 Found ${pageRoutes.length} page routes`);

    // Discover layout files early (needed for client CSS scanning)
    const fs = await import("fs/promises");
    const layoutRoutes: Array<{ pattern: string; modulePath: string }> = [];
    const appDir = path.join(root, srcDir, "app");

    async function findLayoutsForClient(dir: string, routePrefix: string = "/"): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.match(/^layout\.(tsx?|jsx?)$/)) {
            layoutRoutes.push({
              pattern: routePrefix,
              modulePath: path.join(dir, entry.name),
            });
          } else if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !entry.name.startsWith("_")
          ) {
            const childPrefix =
              routePrefix === "/" ? `/${entry.name}` : `${routePrefix}/${entry.name}`;
            await findLayoutsForClient(path.join(dir, entry.name), childPrefix);
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    }
    await findLayoutsForClient(appDir);
    const seenLayoutPatterns = new Set(layoutRoutes.map((layout) => layout.pattern));
    for (const [pattern, entry] of routeManager.getLayouts()) {
      if (seenLayoutPatterns.has(pattern)) continue;
      seenLayoutPatterns.add(pattern);
      layoutRoutes.push({ pattern, modulePath: entry.modulePath });
    }
    logger.info(`📋 Found ${pageRoutes.length} page routes and ${layoutRoutes.length} layouts`);

    const clientOutputDir = path.join(root, distDir, "client");

    // Step 1 & 2: Build client and SSR bundles IN PARALLEL for faster builds
    logger.info("📦 Building client and SSR bundles in parallel...");
    const [_, ssrResult] = await Promise.all([
      // Client build (to disk)
      buildClient(config, root, srcDir, clientOutputDir, pageRoutes, layoutRoutes),
      // SSR build (in memory)
      buildSSRInMemory(config, root, srcDir, routeManager, apiRouteManager, serverRenderer, preset),
    ]);

    const { bundle: ssrBundle, entryFile: ssrEntryFile } = ssrResult;
    await writeSSRAssetsToClient(ssrBundle, clientOutputDir);

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
      routeRuntimeManifest,
      lifecyclePluginManager,
    );

    const runtimeManifestPath = await writeFarmRouteRuntimeManifest(
      path.join(root, distDir),
      routeRuntimeManifest,
    );
    logger.info(`📋 Route runtime manifest: ${path.relative(root, runtimeManifestPath)}`);

    logger.success("✅ Build completed successfully!");
    logger.info(`📁 Output directory: ${deployOutputDir}`);
  } catch (error) {
    if (lifecyclePluginManager) {
      await lifecyclePluginManager.runHookParallel("onError", {
        phase: "buildUniversal",
        error,
        meta: {
          root,
          preset,
        },
      });
    }
    logger.error(`❌ Build failed: ${error}`);
    throw error;
  }
}

async function writeSSRAssetsToClient(bundle: OutputBundle, outputDir: string): Promise<void> {
  const fs = await import("fs/promises");
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "asset") continue;
    const filePath = path.join(outputDir, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, output.source);
  }
}

/**
 * Build client bundle (to disk) with hydration for "use client" components
 */
async function buildClient(
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  outputDir: string,
  pageRoutes: UniversalPageRoute[],
  layoutRoutes: Array<{ pattern: string; modulePath: string }> = [],
) {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");
  const fs = await import("fs/promises");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);

  // Detect which pages should hydrate on the client.
  const clientPages: Array<{ pattern: string; modulePath: string; relativePath: string }> = [];

  for (const route of pageRoutes) {
    if (isFarmMarkdownPageFile(route.modulePath)) {
      continue;
    }
    try {
      const metadata = getClientModuleMetadata(route.modulePath, root);
      if (metadata.shouldHydrate) {
        const relativePath = route.modulePath.replace(root, "").replace(/^\//, "");
        clientPages.push({ ...route, relativePath });
        logger.info(`📱 Found hydratable route: ${route.pattern} -> ${route.modulePath}`);
      }
    } catch (error) {
      logger.warn(`⚠️  Could not inspect route file ${route.modulePath}: ${error}`);
    }
  }

  logger.info(
    `📱 Total hydratable routes detected: ${clientPages.length} out of ${pageRoutes.length} pages`,
  );

  // Generate client hydration entry code
  // Keep generated entries under the project so bare imports resolve through the
  // application's node_modules, including isolated production-build fixtures.
  const clientEntryRoot = path.join(root, ".farm", "tmp");
  await fs.mkdir(clientEntryRoot, { recursive: true });
  const clientEntryDir = await fs.mkdtemp(path.join(clientEntryRoot, "client-entry-"));
  const clientEntryPath = path.join(clientEntryDir, "farm-client-entry.tsx");
  const clientHydrationCode = generateClientHydrationEntry(
    clientPages,
    layoutRoutes,
    root,
    srcDir,
    isFarmDocsSearchEnabled(config.docs),
    resolveFarmDocsSearchClientModule(root),
  );

  // Write the client entry to a temporary file
  await fs.writeFile(clientEntryPath, clientHydrationCode);

  // Tailwind support:
  // - If project has explicit PostCSS config, respect it.
  // - Otherwise enable built-in @tailwindcss/vite (out of the box).
  const hasScopedPostcssConfig = hasProjectPostcssConfig(root);
  let postcssSearchPath: string | undefined;
  let tailwindVitePlugin: any = undefined;
  if (hasScopedPostcssConfig) {
    logger.info("📦 Using project PostCSS/Tailwind configuration");
  } else {
    const postcssConfigPath = path.join(clientEntryDir, "postcss.config.cjs");
    await fs.writeFile(postcssConfigPath, "module.exports = { plugins: [] };\n");
    postcssSearchPath = clientEntryDir;
    try {
      const tailwindVite = (await import("@tailwindcss/vite")).default;
      tailwindVitePlugin = tailwindVite();
      logger.info("📦 Enabled built-in Tailwind support (@tailwindcss/vite)");
    } catch (error) {
      logger.warn(
        `Tailwind plugin auto-enable failed; continuing without it: ${(error as Error).message}`,
      );
    }
  }

  try {
    await viteBuild({
      root,
      esbuild: {
        jsxDev: false,
      },
      build: {
        outDir: outputDir,
        emptyOutDir: true,
        assetsInlineLimit: 0,
        cssCodeSplit: false, // Bundle all CSS into one file
        rollupOptions: {
          input: {
            "farm-client": clientEntryPath,
          },
          output: {
            entryFileNames: "[name].js",
            chunkFileNames: "chunks/[name]-[hash].js",
            // Use predictable name for CSS so we can reference it in SSR HTML
            assetFileNames: (assetInfo) => {
              if (assetInfo.name?.endsWith(".css")) {
                return "farm-client.css";
              }
              return "assets/[name]-[hash][extname]";
            },
          },
          // Externalize Node.js built-ins and server-side modules for client build
          external: (id) => {
            // Externalize Node.js built-ins
            if (
              id.startsWith("node:") ||
              [
                "path",
                "url",
                "fs",
                "fs/promises",
                "os",
                "crypto",
                "http",
                "https",
                "net",
                "stream",
                "util",
                "events",
                "child_process",
                "module",
                "tty",
                "dns",
              ].includes(id)
            ) {
              return true;
            }
            // Externalize native modules that can't be bundled for browser
            if (id === "fsevents" || id.includes("fsevents") || id.endsWith(".node")) {
              return true;
            }
            return false;
          },
        },
      },
      plugins: [
        ...(tailwindVitePlugin ? [tailwindVitePlugin] : []),
        // Plugin to redirect @farmjs/core imports to client-only exports
        {
          name: "farm-client-only-imports",
          enforce: "pre" as const,
          resolveId(id) {
            // Redirect @farmjs/core to just export client-safe parts
            // Don't redirect @farmjs/core/client - that's already client-safe
            if (id === "@farmjs/core") {
              return { id: "\0farm-client-exports", external: false };
            }
            // Block server-only imports completely
            if (
              id === "@farmjs/core/server" ||
              id === "@farmjs/core/api" ||
              id === "@farmjs/core/middleware" ||
              id === "@farmjs/core/headers" ||
              id === "@farmjs/core/config" ||
              id.includes("@farmjs/core/middleware") ||
              id.includes("@farmjs/core/query/server")
            ) {
              return { id: "\0empty-module", external: false };
            }
            // Block API route imports (they come from type-only imports in api.generated.ts)
            if (id.includes("/api/") && id.includes("/route")) {
              return { id: "\0empty-api-route", external: false };
            }
            // Block problematic node modules
            if (
              id === "fsevents" ||
              id.includes("fsevents") ||
              id.endsWith(".node") ||
              id === "nitro" ||
              id === "vite" ||
              id === "esbuild" ||
              id === "rollup" ||
              id.startsWith("nitro/") ||
              id.includes("node-pre-gyp") ||
              id.includes("nf3")
            ) {
              return { id: "\0empty-module", external: false };
            }
            return null;
          },
          load(id) {
            if (id === "\0empty-module") {
              return "const emptyMiddlewareStore = new Map(); export default {}; export const getMiddlewareContext = () => emptyMiddlewareStore; export const getMiddlewareData = () => emptyMiddlewareStore; export const getMiddlewareValue = () => undefined; export const middleware = () => ({});";
            }
            if (id === "\0empty-api-route") {
              // Stub for API routes - only used in type context, provide empty exports
              return "export const GET = () => {}; export const POST = () => {}; export const PUT = () => {}; export const DELETE = () => {}; export const PATCH = () => {}; export default {};";
            }
            if (id === "\0farm-client-exports") {
              // Only export client-safe parts (no type exports - they're erased at compile time)
              return [
                "// Farm.js Client Exports - Safe for browser bundling",
                'export { Link } from "@farmjs/core/client";',
                'export { useRouter } from "@farmjs/core/client";',
                'export { usePathname, useSearchParams } from "@farmjs/core/navigation";',
                'export { createAPIClient } from "@farmjs/core/client";',
              ].join("\n");
            }
            return null;
          },
        },
        farmPlugin(config, pluginManager),
        farmEnvironmentFunctionsPlugin(),
      ],
      mode: "production",
      css: postcssSearchPath
        ? {
            postcss: postcssSearchPath,
          }
        : undefined,
      // Ensure React is bundled for client
      resolve: {
        dedupe: ["react", "react-dom"],
      },
      // Optimize dependencies - exclude server-side code from client bundle
      optimizeDeps: {
        exclude: [
          "@farmjs/core/server",
          "@farmjs/core/api",
          "@farmjs/core/middleware",
          "@farmjs/core/headers",
        ],
      },
    });
  } finally {
    // Clean up temporary entry file
    try {
      await fs.rm(clientEntryDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate client hydration entry that imports and hydrates client components
 */
function generateClientHydrationEntry(
  clientPages: Array<{ pattern: string; modulePath: string; relativePath: string }>,
  layoutRoutes: Array<{ pattern: string; modulePath: string }>,
  root: string,
  srcDir: string,
  docsSearchEnabled: boolean,
  docsSearchModuleId?: string,
): string {
  const toImportPath = (targetPath: string) => targetPath.replace(/\\/g, "/");

  // Always import global CSS for Tailwind
  const globalsCssPath = path.join(root, srcDir, "app", "globals.css");
  const cssImportPath = toImportPath(globalsCssPath);
  const cssImport = `import ${JSON.stringify(cssImportPath)};`;

  // Import layouts for wrapping client components
  const layoutImportStatements: string[] = [];
  const layoutRegistrations: string[] = [];

  layoutRoutes.forEach((layout, index) => {
    const relativePath = toImportPath(layout.modulePath);
    layoutImportStatements.push(`import Layout${index} from "${relativePath}";`);
    layoutRegistrations.push(
      `  { pattern: ${JSON.stringify(layout.pattern)}, Component: Layout${index} }`,
    );
  });

  const layoutImports = layoutImportStatements.join("\n");

  if (clientPages.length === 0) {
    // No client pages - just basic runtime with CSS and SPA navigation
    return `
// Farm.js Client Runtime (no client components)
${cssImport}
${layoutImports}
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { installChunkErrorRecovery } from "@farmjs/core/client";
${generateFarmDocsSearchClientRuntime(docsSearchEnabled, docsSearchModuleId)}

installChunkErrorRecovery();
mountFarmDocsSearch();

// SPA Router for server-rendered pages (HTML swap)
const spaRouter = {
  prefetchCache: new Map(),
  
  navigate: async function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }

    try {
      const html = await this.fetchPage(url.pathname + url.search);
      if (!this.swapContent(html)) {
        window.location.href = href;
        return;
      }
      window.history.pushState({}, "", href);
    } catch (error) {
      console.error("[Farm.js] Navigation error:", error);
      window.location.href = href;
    }
  },
  
  fetchPage: async function(url) {
    const cached = this.prefetchCache.get(url);
    if (cached) return cached;
    
    const response = await fetch(url, {
      headers: { "Accept": "text/html" }
    });
    if (!response.ok) throw new Error("Failed to fetch page");
    return response.text();
  },
  
  swapContent: function(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Update title
    const newTitle = doc.querySelector("title");
    if (newTitle) document.title = newTitle.textContent || "";
    
    // Update meta tags
    const newMetas = doc.querySelectorAll("meta[name]");
    newMetas.forEach(function(meta) {
      const name = meta.getAttribute("name");
      if (name) {
        const existing = document.querySelector("meta[name=\\"" + name + "\\"]");
        if (existing) {
          existing.setAttribute("content", meta.getAttribute("content") || "");
        } else {
          document.head.appendChild(meta.cloneNode(true));
        }
      }
    });
    
    // Swap root content
    const newRoot = doc.getElementById("root");
    const currentRoot = document.getElementById("root");
    if (!newRoot || !currentRoot) return this.swapDocument(doc);
    currentRoot.innerHTML = newRoot.innerHTML;
    return true;
  },

  swapDocument: function(doc) {
    if (!doc.documentElement || !doc.body) return false;

    Array.from(document.documentElement.attributes).forEach(function(attr) {
      if (!doc.documentElement.hasAttribute(attr.name)) {
        document.documentElement.removeAttribute(attr.name);
      }
    });
    Array.from(doc.documentElement.attributes).forEach(function(attr) {
      document.documentElement.setAttribute(attr.name, attr.value);
    });

    document.head.innerHTML = doc.head ? doc.head.innerHTML : "";
    document.body.innerHTML = doc.body.innerHTML;
    delete window.__farmDocsRuntime;
    delete window.__farmDocsPageActionsRuntime;

    setTimeout(function() {
      Array.from(document.querySelectorAll("script")).forEach(function(script) {
        const freshScript = document.createElement("script");
        Array.from(script.attributes).forEach(function(attr) {
          freshScript.setAttribute(attr.name, attr.value);
        });
        freshScript.textContent = script.textContent || "";
        script.replaceWith(freshScript);
      });
    }, 0);

    return true;
  },
  prefetch: function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    
    const pathname = url.pathname + url.search;
    if (this.prefetchCache.has(pathname)) return;
    
    this.fetchPage(pathname)
      .then(function(html) { spaRouter.prefetchCache.set(pathname, html); })
      .catch(function() {});
  },
  
  observeForPrefetch: function(element, href) {
    if (!("IntersectionObserver" in window)) return;
    
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          spaRouter.prefetch(href);
          observer.disconnect();
        }
      });
    }, { rootMargin: "50px" });
    
    observer.observe(element);
  },
  
  unobserveForPrefetch: function() {}
};

// Expose router globally
window.__FARM_SPA_ROUTER__ = spaRouter;

// Handle popstate (back/forward)
window.addEventListener("popstate", function() {
  if (document.documentElement.dataset.farmDocsRuntime === "true") return;
  spaRouter.fetchPage(window.location.pathname + window.location.search)
    .then(function(html) { if (!spaRouter.swapContent(html)) window.location.reload(); })
    .catch(function() { window.location.reload(); });
});

// Intercept link clicks
document.addEventListener("click", function(e) {
  const target = e.target;
  const anchor = target.closest ? target.closest("a") : null;
  if (!anchor) return;
  
  const href = anchor.getAttribute("href");
  if (!href) return;
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
  if (href.startsWith("#")) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (document.documentElement.dataset.farmDocsRuntime === "true") return;
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.button !== 0) return;
  if (e.defaultPrevented) return;
  
  e.preventDefault();
  spaRouter.navigate(href);
});
`.trim();
  }

  // Generate imports for client components
  const imports: string[] = [];
  const routeEntries: string[] = [];

  clientPages.forEach((page, index) => {
    const importPath = toImportPath(page.modulePath);
    imports.push(`import Page${index} from "${importPath}";`);
    routeEntries.push(`  { pattern: ${JSON.stringify(page.pattern)}, Component: Page${index} }`);
  });

  // Full SPA client with hydration for client components
  return `
// Farm.js Client Runtime - SPA with Hydration
${cssImport}
${layoutImports}
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { installChunkErrorRecovery } from "@farmjs/core/client";

${imports.join("\n")}
${generateFarmDocsSearchClientRuntime(docsSearchEnabled, docsSearchModuleId)}

installChunkErrorRecovery();

// Client component routes
const clientRoutes = [
${routeEntries.join(",\n")}
];

// Layout routes for wrapping client components
const layoutRoutes = [
${layoutRegistrations.join(",\n")}
];

// Get applicable layouts for a pathname (sorted by depth, root first)
function getApplicableLayouts(pathname) {
  const applicable = [];
  const normalizedPath = pathname.replace(/\\/$/, '') || '/';
  
  for (const layout of layoutRoutes) {
    if (layout.pattern === '/' || 
        normalizedPath === layout.pattern || 
        normalizedPath.startsWith(layout.pattern + '/')) {
      applicable.push(layout);
    }
  }
  
  // Sort by depth (root first)
  applicable.sort(function(a, b) {
    const depthA = a.pattern.split('/').filter(Boolean).length;
    const depthB = b.pattern.split('/').filter(Boolean).length;
    return depthA - depthB;
  });
  
  return applicable;
}

// Wrap a page element with applicable layouts
function wrapWithLayouts(pageElement, pathname, params) {
  const layouts = getApplicableLayouts(pathname);
  let wrapped = pageElement;
  
  // Wrap from innermost to outermost (reverse order since layouts are root-first)
  for (let i = layouts.length - 1; i >= 0; i--) {
    const LayoutComponent = layouts[i].Component;
    if (LayoutComponent) {
      wrapped = React.createElement(LayoutComponent, { children: wrapped, params: params });
    }
  }
  
  return wrapped;
}

// Match pathname to client route
function matchRoute(pathname) {
  for (const route of clientRoutes) {
    // Convert pattern to regex
    let regexPattern = route.pattern;
    
    // Handle [param] format - convert to named group
    while (regexPattern.includes("[")) {
      const start = regexPattern.indexOf("[");
      const end = regexPattern.indexOf("]");
      if (start === -1 || end === -1) break;
      const paramName = regexPattern.substring(start + 1, end);
      regexPattern = regexPattern.substring(0, start) + "(?<" + paramName + ">[^/]+)" + regexPattern.substring(end + 1);
    }
    
    // Escape forward slashes
    regexPattern = regexPattern.split("/").join("\\\\/");
    
    try {
      const regex = new RegExp("^" + regexPattern + "$");
      const match = pathname.match(regex);
      if (match) {
        return { route: route, params: match.groups || {} };
      }
    } catch (e) {
      console.warn("[Farm.js] Invalid route pattern:", route.pattern);
    }
  }
  return null;
}

// State
let reactRoot = null;
let currentPathname = null;
let isHydrated = false;

function resetReactRoot() {
  if (!reactRoot) return;
  reactRoot.unmount();
  reactRoot = null;
  isHydrated = false;
}

// Hydrate client components
function hydrate() {
  const pathname = window.location.pathname;
  const matched = matchRoute(pathname);
  
  if (!matched) {
    return;
  }
  
  const container = document.getElementById("root");
  if (!container) {
    console.error("[Farm.js] No root element found");
    return;
  }
  
  const Component = matched.route.Component;
  const params = matched.params;
  const searchParams = Object.fromEntries(new URLSearchParams(window.location.search));
  
  const props = { params: params, searchParams: Promise.resolve(searchParams) };
  
  // Create page element and wrap with layouts
  const pageElement = React.createElement(Component, props);
  const wrappedElement = wrapWithLayouts(pageElement, pathname, params);
  
  try {
    if (!isHydrated && container.innerHTML.trim()) {
      reactRoot = hydrateRoot(container, wrappedElement);
      isHydrated = true;
    } else {
      if (!reactRoot) {
        reactRoot = createRoot(container);
      }
      reactRoot.render(wrappedElement);
    }
    currentPathname = pathname;
  } catch (error) {
    console.error("[Farm.js] Hydration error:", error);
  }
}

// SPA Router
const spaRouter = {
  prefetchCache: new Map(),
  
  navigate: async function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }
    
    const pathname = url.pathname;
    const matched = matchRoute(pathname);
    
    if (matched) {
      // Client component - render with layout wrapper
      window.history.pushState({}, "", href);
      const Component = matched.route.Component;
      const params = matched.params;
      const searchParams = Object.fromEntries(url.searchParams);
      const props = { params: params, searchParams: Promise.resolve(searchParams) };
      
      // Create page element and wrap with layouts
      const pageElement = React.createElement(Component, props);
      const wrappedElement = wrapWithLayouts(pageElement, pathname, params);
      
      const container = document.getElementById("root");
      if (container) {
        if (!reactRoot) {
          reactRoot = createRoot(container);
        }
        reactRoot.render(wrappedElement);
        currentPathname = pathname;
      }
      return;
    }
    
    // Server component - fetch HTML
    try {
      const html = await this.fetchPage(url.pathname + url.search);
      if (!this.swapContent(html, url.pathname + url.search)) {
        window.location.href = href;
        return;
      }
      window.history.pushState({}, "", href);
      currentPathname = pathname;
    } catch (error) {
      console.error("[Farm.js] Navigation error:", error);
      window.location.href = href;
    }
  },
  
  fetchPage: async function(url) {
    const cached = this.prefetchCache.get(url);
    if (cached) return cached;
    
    const response = await fetch(url, {
      headers: { "Accept": "text/html" }
    });
    if (!response.ok) throw new Error("Failed to fetch page");
    return response.text();
  },
  
  swapContent: function(html, targetPath) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Update title
    const newTitle = doc.querySelector("title");
    if (newTitle) document.title = newTitle.textContent || "";
    
    // Update meta tags
    const newMetas = doc.querySelectorAll("meta[name]");
    newMetas.forEach(function(meta) {
      const name = meta.getAttribute("name");
      if (name) {
        const existing = document.querySelector("meta[name=\\"" + name + "\\"]");
        if (existing) {
          existing.setAttribute("content", meta.getAttribute("content") || "");
        } else {
          document.head.appendChild(meta.cloneNode(true));
        }
      }
    });
    
    // Swap root content
    const newRoot = doc.getElementById("root");
    const currentRoot = document.getElementById("root");
    if (!newRoot || !currentRoot) return this.swapDocument(doc);
    resetReactRoot();
    currentRoot.innerHTML = newRoot.innerHTML;

    // Check if new page has a client component
    const targetUrl = new URL(targetPath || window.location.href, window.location.origin);
    const newPathname = targetUrl.pathname;
    const matched = matchRoute(newPathname);
    if (matched) {
      // Re-hydrate the client component
      const Component = matched.route.Component;
      const params = matched.params;
      const searchParams = Object.fromEntries(targetUrl.searchParams);
      const props = { params: params, searchParams: Promise.resolve(searchParams) };
      
      if (!reactRoot) {
        reactRoot = createRoot(currentRoot);
      }
      const pageElement = React.createElement(Component, props);
      const wrappedElement = wrapWithLayouts(pageElement, newPathname, params);
      reactRoot.render(wrappedElement);
    }
    return true;
  },

  swapDocument: function(doc) {
    if (!doc.documentElement || !doc.body) return false;

    resetReactRoot();

    Array.from(document.documentElement.attributes).forEach(function(attr) {
      if (!doc.documentElement.hasAttribute(attr.name)) {
        document.documentElement.removeAttribute(attr.name);
      }
    });
    Array.from(doc.documentElement.attributes).forEach(function(attr) {
      document.documentElement.setAttribute(attr.name, attr.value);
    });

    document.head.innerHTML = doc.head ? doc.head.innerHTML : "";
    document.body.innerHTML = doc.body.innerHTML;
    delete window.__farmDocsRuntime;
    delete window.__farmDocsPageActionsRuntime;

    setTimeout(function() {
      Array.from(document.querySelectorAll("script")).forEach(function(script) {
        const freshScript = document.createElement("script");
        Array.from(script.attributes).forEach(function(attr) {
          freshScript.setAttribute(attr.name, attr.value);
        });
        freshScript.textContent = script.textContent || "";
        script.replaceWith(freshScript);
      });
    }, 0);

    return true;
  },
  prefetch: function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    
    const pathname = url.pathname + url.search;
    if (this.prefetchCache.has(pathname)) return;
    
    this.fetchPage(pathname)
      .then(function(html) { spaRouter.prefetchCache.set(pathname, html); })
      .catch(function() {});
  },
  
  observeForPrefetch: function(element, href) {
    if (!("IntersectionObserver" in window)) return;
    
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          spaRouter.prefetch(href);
          observer.disconnect();
        }
      });
    }, { rootMargin: "50px" });
    
    observer.observe(element);
  },
  
  unobserveForPrefetch: function() {}
};

// Expose router globally
window.__FARM_SPA_ROUTER__ = spaRouter;

// Handle popstate (back/forward)
window.addEventListener("popstate", function() {
  if (document.documentElement.dataset.farmDocsRuntime === "true") return;
  const pathname = window.location.pathname;
  const matched = matchRoute(pathname);
  
  if (matched) {
    const Component = matched.route.Component;
    const params = matched.params;
    const searchParams = Object.fromEntries(new URLSearchParams(window.location.search));
    const props = { params: params, searchParams: Promise.resolve(searchParams) };
    const pageElement = React.createElement(Component, props);
    const wrappedElement = wrapWithLayouts(pageElement, pathname, params);
    
    const container = document.getElementById("root");
    if (container) {
      if (!reactRoot) {
        reactRoot = createRoot(container);
      }
      reactRoot.render(wrappedElement);
      currentPathname = pathname;
    }
  } else {
    spaRouter.fetchPage(pathname + window.location.search)
      .then(function(html) { if (!spaRouter.swapContent(html, pathname + window.location.search)) window.location.reload(); })
      .catch(function() { window.location.reload(); });
  }
});

// Intercept link clicks
document.addEventListener("click", function(e) {
  const target = e.target;
  const anchor = target.closest ? target.closest("a") : null;
  if (!anchor) return;
  
  const href = anchor.getAttribute("href");
  if (!href) return;
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
  if (href.startsWith("#")) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (document.documentElement.dataset.farmDocsRuntime === "true") return;
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.button !== 0) return;
  if (e.defaultPrevented) return;
  
  e.preventDefault();
  spaRouter.navigate(href);
});

// Initial hydration
if (isFarmDocsSearchPage()) {
  mountFarmDocsSearch();
} else {
  hydrate();
}
`.trim();
}

/**
 * Build SSR bundle in memory (write: false)
 * Creates a virtual entry that bundles all API routes and page routes
 * Managers are created at runtime from the bundled code
 */
async function buildSSRInMemory(
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
  preset: string,
): Promise<{ bundle: OutputBundle; entryFile: string }> {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");
  const fs = await import("fs/promises");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);
  const hasScopedPostcssConfig = hasProjectPostcssConfig(root);
  let postcssConfigDir: string | undefined;
  if (!hasScopedPostcssConfig) {
    postcssConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-postcss-"));
    await fs.writeFile(
      path.join(postcssConfigDir, "postcss.config.cjs"),
      "module.exports = { plugins: [] };\n",
    );
  }

  let ssrBundle: OutputBundle;
  let ssrEntryFile: string;

  // Generate route manifest from managers
  // This captures route patterns and module paths
  const pageRoutes: UniversalPageRoute[] = [];
  for (const [pattern, entry] of routeManager.getRoutes()) {
    pageRoutes.push({
      pattern,
      modulePath: entry.modulePath,
      ...(isFarmMarkdownPageFile(entry.modulePath)
        ? { source: await fs.readFile(entry.modulePath, "utf8") }
        : {}),
    });
  }

  const metadataImageRoutes: UniversalMetadataImageRoute[] = [];
  for (const entry of routeManager.getMetadataImages().values()) {
    if (entry.sourceType === "static") {
      if (!entry.staticInfo) {
        throw new Error(`Static metadata image ${entry.modulePath} is missing file info`);
      }
      metadataImageRoutes.push({
        pattern: entry.pattern,
        kind: entry.kind,
        fileName: entry.fileName,
        sourceType: "static",
        staticInfo: entry.staticInfo,
        data: (await fs.readFile(entry.modulePath)).toString("base64"),
      });
      continue;
    }

    metadataImageRoutes.push({
      pattern: entry.pattern,
      kind: entry.kind,
      fileName: entry.fileName,
      sourceType: "module",
      modulePath: entry.modulePath,
    });
  }

  // Generate API route manifest
  const apiRoutes: Array<{ path: string; filePath: string; methods: string[] }> = [];
  for (const [routePath, route] of apiRouteManager.getRoutes()) {
    apiRoutes.push({
      path: routePath,
      filePath: route.filePath,
      methods: route.methods,
    });
  }
  const redirectRoutes = routeManager.getRedirects();

  // Discover layout files by scanning the source directory
  const layoutRoutes: Array<{ pattern: string; modulePath: string }> = [];
  const appDirs = getFarmAppDirectories(config);
  const appDir = path.join(root, srcDir, "app");
  const middlewareRoutes = await discoverMiddlewareRoutes(appDirs);

  async function findLayouts(dir: string, routePrefix: string = "/"): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.match(/^layout\.(tsx?|jsx?)$/)) {
          layoutRoutes.push({
            pattern: routePrefix,
            modulePath: path.join(dir, entry.name),
          });
        } else if (
          entry.isDirectory() &&
          !entry.name.startsWith("_") &&
          !entry.name.startsWith(".")
        ) {
          const subRoute = routePrefix === "/" ? `/${entry.name}` : `${routePrefix}/${entry.name}`;
          await findLayouts(path.join(dir, entry.name), subRoute);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await findLayouts(appDir);
  const seenLayoutPatterns = new Set(layoutRoutes.map((layout) => layout.pattern));
  for (const [pattern, entry] of routeManager.getLayouts()) {
    if (seenLayoutPatterns.has(pattern)) {
      continue;
    }

    seenLayoutPatterns.add(pattern);
    layoutRoutes.push({
      pattern,
      modulePath: entry.modulePath,
    });
  }

  // Check for custom not-found page
  let notFoundPath: string | null = null;
  const notFoundExtensions = [".tsx", ".jsx", ".ts", ".js"];
  for (const sourceAppDir of appDirs) {
    for (const ext of notFoundExtensions) {
      const checkPath = path.join(sourceAppDir, `not-found${ext}`);
      try {
        await fs.access(checkPath);
        notFoundPath = checkPath;
        break;
      } catch {
        // File doesn't exist, continue checking
      }
    }
  }
  if (notFoundPath) logger.info(`📋 Found custom 404 page: ${notFoundPath}`);

  // Sort layouts by depth (root first)
  layoutRoutes.sort((a, b) => {
    const depthA = a.pattern.split("/").filter(Boolean).length;
    const depthB = b.pattern.split("/").filter(Boolean).length;
    return depthA - depthB;
  });

  logger.info(
    `📋 Found ${pageRoutes.length} page routes, ${layoutRoutes.length} layouts, ${apiRoutes.length} API routes, and ${middlewareRoutes.length} middleware files`,
  );

  const hasConfiguredIntegrations = Object.values(config.integrations || {}).some(
    (integration) => integration?.serverRuntime !== false,
  );
  const hasObservabilityHandler =
    !!config.observability &&
    typeof config.observability === "object" &&
    "onEvent" in config.observability;
  const hasMdxComponentConfig = Boolean(config.mdx?.components);
  const hasMiddlewareConfig = hasFarmMiddlewareConfig(config.middleware);
  const configModulePath =
    hasConfiguredIntegrations ||
    hasObservabilityHandler ||
    hasMdxComponentConfig ||
    hasMiddlewareConfig
      ? await findFarmConfigPath(root)
      : null;

  // Generate virtual entry code that imports and bundles all routes
  // This ensures all route handlers are captured in the bundle closure
  const virtualEntryCode = generateVirtualEntryCode(
    apiRoutes,
    pageRoutes,
    layoutRoutes,
    metadataImageRoutes,
    middlewareRoutes,
    redirectRoutes,
    notFoundPath,
    config,
    configModulePath,
    preset,
  );

  // Find a temporary file path for the virtual entry
  // We'll use a plugin to intercept this
  const virtualEntryId = "\0virtual:farm-ssr-entry";

  try {
    await viteBuild({
      root,
      build: {
        target: "esnext",
        ssr: true,
        write: false, // ⭐ Keep in memory
        ssrEmitAssets: true,
        assetsInlineLimit: 0,
        minify: false, // Skip minification for SSR (faster build, Nitro will minify)
        sourcemap: false, // Skip sourcemaps for faster SSR build
        rollupOptions: {
          input: virtualEntryId,
          // Externalize native modules and Node.js built-ins
          external: [
            "fsevents",
            "sharp",
            "@prisma/client",
            "@prisma/client/default",
            "@prisma/client/default.js",
            ".prisma/client",
            ".prisma/client/default",
            /^\.prisma\//,
            /\.node$/,
            /^node:/,
          ],
          // Optimize tree-shaking
          treeshake: {
            moduleSideEffects: false,
          },
        },
      },
      // Use esbuild for faster transforms
      esbuild: {
        target: "node18",
        keepNames: true,
        jsxDev: false,
      },
      // SSR configuration to externalize problematic modules
      ssr: {
        // Externalize native modules and build tools that can't be bundled
        // These have native binaries that won't work in serverless environments
        external: [
          "fsevents",
          "sharp",
          "esbuild",
          "lightningcss",
          "rollup",
          "@rollup/rollup-darwin-arm64",
          "@rollup/rollup-darwin-x64",
          "@rollup/rollup-linux-x64-gnu",
          "@rollup/rollup-linux-x64-musl",
          "@rollup/rollup-linux-arm64-gnu",
          "@rollup/rollup-linux-arm64-musl",
          "@rollup/rollup-win32-x64-msvc",
          "@rollup/rollup-win32-arm64-msvc",
          "@rollup/rollup-win32-ia32-msvc",
          "vite",
          "nitro",
          "nitropack",
          "@prisma/client",
          "@prisma/client/default",
          "@prisma/client/default.js",
          ".prisma/client",
          ".prisma/client/default",
        ],
        // Don't externalize these - bundle them into the SSR output
        // Keep this list minimal for faster builds
        noExternal: [
          "@farmjs/core",
          "@farmjs/core/image",
          "better-call",
          ...(preset === "cloudflare-module" ? [] : ["react", "react-dom", "react-dom/server"]),
        ],
      },
      define: {
        __FARM_ENV__: JSON.stringify(config.env || { server: {}, public: {} }),
        __FARM_PUBLIC_ENV__: JSON.stringify(config.env?.public || {}),
      },
      plugins: [
        farmPlugin(config, pluginManager),
        farmEnvironmentFunctionsPlugin(),
        {
          name: "farm-virtual-ssr-entry",
          resolveId(id) {
            if (id === virtualEntryId || id === "\0virtual:farm-ssr-entry") {
              return virtualEntryId;
            }
            return null;
          },
          load(id) {
            if (id === virtualEntryId) {
              return virtualEntryCode;
            }
            return null;
          },
        },
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
      css: postcssConfigDir
        ? {
            postcss: postcssConfigDir,
          }
        : undefined,
      resolve: {
        alias: {
          "@": path.resolve(root, "src"),
          // Ensure imports can resolve farm modules
          farm: path.resolve(root, "node_modules", "@farmjs", "core", "src"),
        },
      },
    });
  } finally {
    if (postcssConfigDir) {
      try {
        await fs.rm(postcssConfigDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }

  return { bundle: ssrBundle!, entryFile: ssrEntryFile! };
}

/**
 * Generate virtual entry code that bundles all routes
 * This creates managers at runtime from bundled code
 */
function generateVirtualEntryCode(
  apiRoutes: Array<{ path: string; filePath: string; methods: string[] }>,
  pageRoutes: UniversalPageRoute[],
  layoutRoutes: Array<{ pattern: string; modulePath: string }>,
  metadataImageRoutes: UniversalMetadataImageRoute[],
  middlewareRoutes: UniversalMiddlewareRoute[],
  redirectRoutes: ProgrammaticRedirectRoute[],
  notFoundPath: string | null,
  config: ResolvedFarmConfig,
  configModulePath: string | null,
  preset: string,
): string {
  // Generate imports for all API routes
  const apiImports: string[] = [];
  const apiRegistrations: string[] = [];

  apiRoutes.forEach((route, index) => {
    const varName = `apiRoute${index}`;
    apiImports.push(`import * as ${varName} from "${route.filePath}";`);
    apiRegistrations.push(`
  {
    path: ${JSON.stringify(route.path)},
    methods: ${JSON.stringify(route.methods)},
    handlers: ${varName},
  }`);
  });

  // Generate imports for all page routes
  const pageImports: string[] = [];
  const pageRegistrations: string[] = [];

  pageRoutes.forEach((route, index) => {
    const varName = `pageRoute${index}`;
    if (route.source !== undefined || isFarmMarkdownPageFile(route.modulePath)) {
      pageRegistrations.push(`
  {
    pattern: ${JSON.stringify(route.pattern)},
    module: createFarmMarkdownRouteModule({
      source: ${JSON.stringify(route.source ?? "")},
      filePath: ${JSON.stringify(route.modulePath)},
      components: farmMdxComponents,
      config: farmMdxConfig,
    }),
    markdownSource: {
      source: ${JSON.stringify(route.source ?? "")},
      filePath: ${JSON.stringify(route.modulePath)},
    },
  }`);
      return;
    }

    pageImports.push(`import * as ${varName} from "${route.modulePath}";`);
    pageRegistrations.push(`
  {
    pattern: ${JSON.stringify(route.pattern)},
    module: ${varName},
  }`);
  });

  // Generate imports for all layouts
  const layoutImports: string[] = [];
  const layoutRegistrations: string[] = [];

  layoutRoutes.forEach((layout, index) => {
    const varName = `layoutRoute${index}`;
    layoutImports.push(`import * as ${varName} from "${layout.modulePath}";`);
    layoutRegistrations.push(`
  {
    pattern: ${JSON.stringify(layout.pattern)},
    module: ${varName},
  }`);
  });

  const metadataImageImports: string[] = [];
  const metadataImageRegistrations: string[] = [];

  metadataImageRoutes.forEach((image, index) => {
    if (image.sourceType === "module") {
      const varName = `metadataImageRoute${index}`;
      metadataImageImports.push(`import * as ${varName} from "${image.modulePath}";`);
      metadataImageRegistrations.push(`
  {
    pattern: ${JSON.stringify(image.pattern)},
    kind: ${JSON.stringify(image.kind)},
    fileName: ${JSON.stringify(image.fileName)},
    sourceType: "module",
    module: ${varName},
  }`);
      return;
    }

    metadataImageRegistrations.push(`  ${JSON.stringify(image)}`);
  });

  // Generate imports for all app middleware files
  const middlewareImports: string[] = [];
  const middlewareRegistrations: string[] = [];

  middlewareRoutes.forEach((middlewareRoute, index) => {
    const varName = `fileMiddleware${index}`;
    middlewareImports.push(`import * as ${varName} from "${middlewareRoute.filePath}";`);
    middlewareRegistrations.push(`
  {
    path: ${JSON.stringify(middlewareRoute.path)},
    filePath: ${JSON.stringify(middlewareRoute.filePath)},
    module: ${varName},
  }`);
  });

  // Generate import for custom not-found page if exists
  const notFoundImport = notFoundPath ? `import * as CustomNotFound from "${notFoundPath}";` : "";
  const apiRouteHelpersImport =
    apiRoutes.length > 0
      ? `import { invokeAPIRouteEndpoint, matchAPIRoute } from "farm/api/route-manager";`
      : "";
  const cacheHelpersImport = `import { createFarmCacheKey, getFarmDataCache, normalizeRevalidatePath } from "farm/cache";`;
  const navigationHelpersImport = `import { getFarmRedirectError, isFarmNotFoundError, isFarmRedirectError } from "farm/navigation";`;
  const metadataHelpersImport = `import { addMetadataImageReference, mergeMetadata, renderMetadataHead } from "farm/metadata";`;
  const afterHelpersImport = `import { _runWithAfterRequest } from "farm/after";`;
  const observabilityHelpersImport = `import { configureFarmObservability, emitFarmEvent } from "farm/observability";`;
  const middlewareRuntimeImport = `import { _runWithMiddlewareContext, _runWithMiddlewareData, applyProductionMiddlewareHeaders, createProductionMiddlewareRunner } from "farm/middleware";`;
  const docsHandlerImport = config.docs?.enabled
    ? `import { createFarmDocsAPIHandler, createFarmDocsHandler } from "farm/docs";`
    : "";
  const docsRuntimeImport = config.docs?.enabled
    ? `import { existsSync as farmDocsExistsSync } from "node:fs";
import { dirname as farmDocsDirname, join as farmDocsJoin } from "node:path";
import { fileURLToPath as farmDocsFileURLToPath } from "node:url";`
    : "";
  const markdownHandlerImport = config.md?.enabled
    ? `import { createMarkdownMirrorResponse } from "farm/markdown";`
    : "";
  const appMarkdownImport = `import { createFarmMarkdownRouteModule, createFarmMarkdownSourceResponse } from "farm/app-markdown";`;
  const mdxComponentsPath =
    typeof config.mdx?.components === "string"
      ? path.isAbsolute(config.mdx.components)
        ? config.mdx.components
        : path.join(config.root, config.mdx.components)
      : null;
  const mdxComponentsImport = mdxComponentsPath
    ? `import * as FarmMdxComponentsModule from "${mdxComponentsPath.replace(/\\/g, "/")}";`
    : "";
  const integrationImports = configModulePath
    ? `
import * as FarmUserConfigModule from "${configModulePath}";
import { dispatchIntegrationRequest, matchIntegrationRoute } from "farm";
`
    : "";
  const imageRuntime = resolveImageRuntime(config, preset);
  const imageRuntimeImport =
    imageRuntime === "none"
      ? ""
      : `import { createCloudflareImageTransformer, createFarmImageHandler } from "farm/image-server";`;
  const imageNodeRuntimeImport =
    imageRuntime === "node"
      ? `import { createNodeImageUrlValidator, createSharpImageTransformer } from "farm/image-sharp";`
      : "";
  const apiHandlerCode =
    apiRoutes.length > 0
      ? `
const apiRouteMap = new Map(apiRoutes.map((route) => [route.path, route]));

async function handleAPIRequest(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const match = matchAPIRoute(apiRouteMap, url.pathname);

  if (!match) {
    return null;
  }

  const { route, params } = match;
  const endpoint = route.handlers[method];
  if (!endpoint) {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    return await invokeAPIRouteEndpoint(endpoint, request, params);
  } catch (error) {
    console.error(\`[API Error] \${url.pathname}:\`, error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
`
      : `
async function handleAPIRequest(request) {
  return null;
}
`;

  return `
// Farm.js SSR Entry - Generated at build time
// All routes are bundled here, managers are created at runtime

${apiImports.join("\n")}
${pageImports.join("\n")}
${layoutImports.join("\n")}
${metadataImageImports.join("\n")}
${middlewareImports.join("\n")}
${notFoundImport}
${apiRouteHelpersImport}
${cacheHelpersImport}
${navigationHelpersImport}
${metadataHelpersImport}
${afterHelpersImport}
${observabilityHelpersImport}
${middlewareRuntimeImport}
${docsHandlerImport}
${docsRuntimeImport}
${markdownHandlerImport}
${appMarkdownImport}
${mdxComponentsImport}
${integrationImports}
${imageRuntimeImport}
${imageNodeRuntimeImport}

// Custom 404 page component (if provided)
const hasCustomNotFound = ${notFoundPath ? "true" : "false"};
const CustomNotFoundComponent = ${notFoundPath ? "CustomNotFound.default || CustomNotFound" : "null"};
const farmUserConfig = ${
    configModulePath ? "(FarmUserConfigModule.default || FarmUserConfigModule)" : "null"
  };
const configuredIntegrations = farmUserConfig?.integrations || {};
const integrationRuntimeConfig = farmUserConfig || {};
const farmImageHandler = ${
    imageRuntime === "none"
      ? "null"
      : imageRuntime === "cloudflare"
        ? `createFarmImageHandler(${JSON.stringify(config.images)}, {
  transform: createCloudflareImageTransformer(),
  onError(error) { console.error("[Farm Image]", error); },
})`
        : `createFarmImageHandler(${JSON.stringify(config.images)}, {
  transform: createSharpImageTransformer(),
  validateRemoteUrl: createNodeImageUrlValidator(${JSON.stringify(config.images)}),
  onError(error) { console.error("[Farm Image]", error); },
})`
  };
const farmMarkdownConfig = ${JSON.stringify(config.md)};
const farmMdxConfig = ${JSON.stringify({
    ...config.mdx,
    components: typeof config.mdx?.components === "string" ? config.mdx.components : undefined,
  })};
const configuredFarmMdxComponents = farmUserConfig?.mdx?.components;
const farmMdxComponents = ${
    mdxComponentsPath
      ? `(FarmMdxComponentsModule.components || Reflect.get(FarmMdxComponentsModule, "default") || {})`
      : `(configuredFarmMdxComponents && typeof configuredFarmMdxComponents === "object" ? configuredFarmMdxComponents : {})`
  };
const farmObservabilityConfig = farmUserConfig?.observability ?? ${JSON.stringify(
    config.observability ?? false,
  )};
configureFarmObservability(farmObservabilityConfig);
const farmDocsBundledContentDir = ${
    config.docs?.enabled
      ? `(() => {
  try {
    const currentDir = farmDocsDirname(farmDocsFileURLToPath(import.meta.url));
    const candidates = [
      farmDocsJoin(currentDir, "farm-docs-content"),
      farmDocsJoin(currentDir, "..", "farm-docs-content"),
      farmDocsJoin(currentDir, "..", "..", "farm-docs-content"),
    ];
    return candidates.find((candidate) => farmDocsExistsSync(candidate)) || null;
  } catch {
    return null;
  }
})()`
      : "null"
  };
const farmDocsResolvedConfig = ${
    config.docs?.enabled
      ? `farmDocsBundledContentDir
  ? {
      ...${JSON.stringify(config.docs)},
      contentDir: farmDocsBundledContentDir,
      config: {
        ...${JSON.stringify(config.docs.config)},
        contentDir: farmDocsBundledContentDir,
      },
    }
  : ${JSON.stringify(config.docs)}`
      : "null"
  };
const farmDocsRuntimeRoot = farmDocsBundledContentDir || ${JSON.stringify(config.root)};
globalThis.__FARM_DOCS_RUNTIME_CONFIG__ = {
  root: farmDocsRuntimeRoot,
  srcDir: ${JSON.stringify(config.srcDir)},
  docs: farmDocsResolvedConfig,
};
const farmDocsHandler = ${
    config.docs?.enabled
      ? `createFarmDocsHandler(farmDocsResolvedConfig, { root: farmDocsRuntimeRoot, srcDir: ${JSON.stringify(config.srcDir)}, clientEntry: "/farm-client.js" })`
      : "null"
  };
const farmDocsAPIHandler = ${
    config.docs?.enabled
      ? `createFarmDocsAPIHandler({ rootDir: farmDocsRuntimeRoot, srcDir: ${JSON.stringify(config.srcDir)}, docs: farmDocsResolvedConfig })`
      : "null"
  };

// API routes bundled at build time
const apiRoutes = [${apiRegistrations.join(",")}
];

// Page routes bundled at build time
const pageRoutes = [${pageRegistrations.join(",")}
];

// Layout routes bundled at build time (sorted by depth, root first)
const layoutRoutes = [${layoutRegistrations.join(",")}
];

// Metadata image routes bundled at build time
const metadataImageRoutes = [${metadataImageRegistrations.join(",")}
];

// Redirect routes bundled at build time
const redirectRoutes = ${JSON.stringify(redirectRoutes, null, 2)};

function normalizeRuntimePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.replace(/\\/+$/, "") : pathname;
}

function splitRuntimePath(pathname) {
  return normalizeRuntimePath(pathname).split("/").filter(Boolean);
}

function matchRuntimePathPattern(pattern, pathname) {
  const patternSegments = splitRuntimePath(pattern);
  const pathnameSegments = splitRuntimePath(pathname);
  const params = {};
  let pathIndex = 0;

  for (const segment of patternSegments) {
    const optionalCatchAll = segment.match(/^\\[\\[\\.\\.\\.(.+)\\]\\]$/);
    const catchAll = segment.match(/^\\[\\.\\.\\.(.+)\\]$/);
    const dynamic = segment.match(/^\\[(.+)\\]$/);

    if (optionalCatchAll || catchAll) {
      const name = (optionalCatchAll || catchAll)[1];
      const remaining = pathnameSegments.slice(pathIndex).map(decodeURIComponent).join("/");
      if (!remaining && catchAll) return null;
      params[name] = remaining;
      pathIndex = pathnameSegments.length;
      continue;
    }

    const pathnameSegment = pathnameSegments[pathIndex];
    if (pathnameSegment === undefined) return null;

    if (dynamic) {
      params[dynamic[1]] = decodeURIComponent(pathnameSegment);
      pathIndex++;
      continue;
    }

    if (segment !== pathnameSegment) return null;
    pathIndex++;
  }

  return pathIndex === pathnameSegments.length ? params : null;
}

function getMatchingMetadataImage(pathname, kind) {
  const pathSegments = splitRuntimePath(pathname);
  let bestMatch = null;

  for (const image of metadataImageRoutes) {
    if (image.kind !== kind) continue;
    const patternDepth = splitRuntimePath(image.pattern).length;
    if (patternDepth > pathSegments.length) continue;

    const pagePath = patternDepth === 0
      ? "/"
      : "/" + pathSegments.slice(0, patternDepth).join("/");
    const params = matchRuntimePathPattern(image.pattern, pagePath);
    if (params === null) continue;

    if (!bestMatch || patternDepth > bestMatch.depth) {
      bestMatch = { image, params, pagePath, depth: patternDepth };
    }
  }

  return bestMatch;
}

function matchMetadataImageRequest(pathname) {
  const normalizedPath = normalizeRuntimePath(pathname);
  let kind;
  let fileName;

  if (normalizedPath === "/opengraph-image" || normalizedPath.endsWith("/opengraph-image")) {
    kind = "opengraph";
    fileName = "opengraph-image";
  } else if (normalizedPath === "/twitter-image" || normalizedPath.endsWith("/twitter-image")) {
    kind = "twitter";
    fileName = "twitter-image";
  } else {
    return null;
  }

  const pagePath = normalizedPath.slice(0, -fileName.length - 1) || "/";
  for (const image of metadataImageRoutes) {
    if (image.kind !== kind) continue;
    const params = matchRuntimePathPattern(image.pattern, pagePath);
    if (params !== null) return { image, params, pagePath };
  }

  return null;
}

function createMetadataImageReference(match) {
  const image = match.image;
  const metadata = image.sourceType === "static" ? image.staticInfo : image.module;
  const basePath = match.pagePath === "/" ? "" : match.pagePath;
  const version = image.sourceType === "static" ? "?v=" + image.staticInfo.hash : "";

  return {
    kind: image.kind,
    href: basePath + "/" + image.fileName + version,
    width: metadata?.width ?? metadata?.size?.width,
    height: metadata?.height ?? metadata?.size?.height,
    alt: metadata?.alt,
    contentType: metadata?.contentType,
  };
}

function decodeMetadataImage(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function handleMetadataImageRequest(request) {
  const url = new URL(request.url);
  const match = matchMetadataImageRequest(url.pathname);
  if (!match) return null;

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const image = match.image;
  if (image.sourceType === "static") {
    const etag = '"' + image.staticInfo.hash + '"';
    const isVersioned = url.searchParams.get("v") === image.staticInfo.hash;
    const headers = new Headers({
      "Content-Type": image.staticInfo.contentType,
      "Content-Length": String(image.staticInfo.byteLength),
      "Cache-Control": isVersioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    });

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    if (!image.bytes) image.bytes = decodeMetadataImage(image.data);
    return new Response(method === "HEAD" ? null : image.bytes, { status: 200, headers });
  }

  try {
    const imageModule = image.module;
    if (!imageModule?.default) {
      throw new Error("Metadata image module does not export a default component or handler");
    }

    const searchParams = Object.fromEntries(url.searchParams.entries());
    const props = {
      params: match.params,
      searchParams: Promise.resolve(searchParams),
      path: match.pagePath,
    };
    const value = typeof imageModule.default === "function"
      ? await imageModule.default(props)
      : imageModule.default;

    if (value instanceof Response) {
      return method === "HEAD"
        ? new Response(null, { status: value.status, headers: value.headers })
        : value;
    }

    let body;
    if (typeof value === "string" || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      body = value;
    } else {
      const React = await import("react");
      if (!React.isValidElement(value)) {
        throw new Error("Metadata image must return a Response, string, bytes, or React element");
      }
      const { renderToStaticMarkup } = await import("react-dom/server");
      body = renderToStaticMarkup(value);
    }

    return new Response(method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": imageModule.contentType || "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Metadata image render failed:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function interpolateRedirectDestination(destination, params) {
  let result = destination;
  for (const [key, value] of Object.entries(params)) {
    result = result.split("[..." + key + "]").join(value);
    result = result.split("[[..." + key + "]]").join(value);
    result = result.split("[" + key + "]").join(value);
    result = result.split(":" + key + "*").join(value);
    result = result.split(":" + key).join(value);
  }
  return result;
}

function matchRedirectRoute(pathname) {
  for (const redirect of redirectRoutes) {
    const params = matchRuntimePathPattern(redirect.source, pathname);
    if (!params) continue;
    return {
      destination: interpolateRedirectDestination(redirect.destination, params),
      statusCode: redirect.statusCode || (redirect.permanent ? 308 : 307),
    };
  }
  return null;
}

// App middleware files bundled at build time (sorted by depth, root first)
const fileMiddlewareModules = [${middlewareRegistrations.join(",")}
];

const farmMiddlewareRunner = createProductionMiddlewareRunner({
  config: farmUserConfig?.middleware,
  modules: fileMiddlewareModules,
});

${apiHandlerCode}

async function handleIntegrationRequest(request) {
  ${
    configModulePath
      ? `const matchedIntegrationRoute = matchIntegrationRoute(configuredIntegrations, {
    pathname: new URL(request.url).pathname,
    method: request.method,
  });

  if (!matchedIntegrationRoute) {
    return null;
  }

  return dispatchIntegrationRequest(
    {
      integration: matchedIntegrationRoute.integration,
      config: integrationRuntimeConfig,
      isDev: false,
      isProd: true,
    },
    request,
  );`
      : "return null;"
  }
}

/**
 * Match URL to page route pattern
 */
function matchPageRoute(pathname) {
  for (const route of pageRoutes) {
    // Convert pattern to regex
    // Handle both [param] and :param formats
    const regexPattern = route.pattern
      .replace(/\\[([^\\]]+)\\]/g, '(?<$1>[^/]+)')   // [id] -> (?<id>[^/]+)
      .replace(/\\/:([^/]+)/g, '/(?<$1>[^/]+)')     // /:id -> /(?<id>[^/]+)
      .replace(/\\//g, '\\\\/');                     // / -> \\/
    
    const regex = new RegExp(\`^\${regexPattern}$\`);
    const match = pathname.match(regex);
    
    if (match) {
      const params = match.groups || {};
      return { route, params };
    }
  }
  return null;
}

/**
 * Get applicable layouts for a page path (from root to most specific)
 */
function getApplicableLayouts(pathname) {
  const applicable = [];
  const normalizedPath = pathname.replace(/\\/$/, '') || '/';
  
  for (const layout of layoutRoutes) {
    // Root layout (/) applies to everything
    // Other layouts apply to their path and sub-paths
    if (layout.pattern === '/' || 
        normalizedPath === layout.pattern || 
        normalizedPath.startsWith(layout.pattern + '/')) {
      applicable.push(layout);
    }
  }
  
  // Sort by depth (root first, then nested)
  applicable.sort((a, b) => {
    const depthA = a.pattern.split('/').filter(Boolean).length;
    const depthB = b.pattern.split('/').filter(Boolean).length;
    return depthA - depthB;
  });
  
  return applicable;
}

const pprShellCache = getFarmDataCache();

function resolvePPRConfig(routeModule) {
  if (!routeModule || routeModule.dynamic === "force-dynamic") {
    return { enabled: false };
  }

  if (routeModule.dynamic === "force-static" || routeModule.dynamic === "error") {
    return { enabled: false };
  }

  const enabled = routeModule.ppr === true || routeModule.experimental_ppr === true;
  const revalidate =
    typeof routeModule.revalidate === "number" && routeModule.revalidate > 0
      ? routeModule.revalidate
      : undefined;

  return { enabled, revalidate };
}

function getPPRShellBypassReason(request, middlewareData, middlewareContext) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return "method";
  if (request.headers.get("cookie")) return "cookie";
  if (request.headers.get("authorization")) return "authorization";
  if (request.headers.get("x-farm-ppr-refresh")) return "refresh";
  if (middlewareData?.size) return "middleware-data";
  if (middlewareContext?.size) return "middleware-context";
  return undefined;
}

function getPPRShellCacheKey(url) {
  return createFarmCacheKey(["ppr", normalizeRevalidatePath(url.pathname), url.search]);
}

function getPPRHeaders(status, config) {
  const headers = {
    "X-Farm-PPR": status,
  };

  if (status === "bypass") {
    headers["Cache-Control"] = "private, no-store";
    return headers;
  }

  if (typeof config.revalidate === "number" && config.revalidate > 0) {
    headers["Cache-Control"] = \`s-maxage=\${config.revalidate}, stale-while-revalidate\`;
  }

  return headers;
}

function getCachedPPRShell(cacheKey) {
  const entry = pprShellCache.getEntry(cacheKey);
  if (!entry) {
    return null;
  }

  return entry.value.html;
}

/**
 * Main request handler - created at runtime with bundled routes
 */
async function handleFarmRequest(request) {
  let url = new URL(request.url);
  let pathname = url.pathname;
  const requestStartTime = Date.now();

  if (farmImageHandler) {
    const imageResponse = await farmImageHandler(request);
    if (imageResponse) {
      return imageResponse;
    }
  }

  const integrationResponse = await handleIntegrationRequest(request.clone());
  if (integrationResponse) {
    return integrationResponse;
  }

  if (farmDocsHandler) {
    const docsResponse = await farmDocsHandler(request.clone());
    if (docsResponse) {
      return docsResponse;
    }
  }

  const markdownSourceResponse = await createFarmMarkdownSourceResponse?.({
    request: request.clone(),
    config: farmMdxConfig,
    resolveSource: (targetPathname) => {
      const match = matchPageRoute(targetPathname);
      return match?.route?.markdownSource || null;
    },
  });
  if (markdownSourceResponse) {
    return markdownSourceResponse;
  }

  if (farmMarkdownConfig?.enabled) {
    const markdownResponse = await createMarkdownMirrorResponse({
      request: request.clone(),
      config: farmMarkdownConfig,
      routeExists: (targetPathname) => Boolean(matchPageRoute(targetPathname)),
      renderPage: (targetRequest) => handleFarmRequest(targetRequest),
    });
    if (markdownResponse) {
      return markdownResponse;
    }
  }

  const middlewareResult = await farmMiddlewareRunner(request);
  if (middlewareResult.response) {
    return middlewareResult.response;
  }
  request = middlewareResult.request;
  const middlewareData = middlewareResult.data;
  const middlewareContext = middlewareResult.context;
  const middlewareHeaders = middlewareResult.headers;
  url = new URL(request.url);
  pathname = url.pathname;

  const redirectMatch = matchRedirectRoute(pathname);
  if (redirectMatch) {
    return applyProductionMiddlewareHeaders(new Response(
      "Redirecting to " + redirectMatch.destination,
      {
        status: redirectMatch.statusCode,
        headers: { Location: redirectMatch.destination },
      }
    ), middlewareHeaders);
  }

  const apiResponse = await handleAPIRequest(request.clone());
  if (apiResponse) {
    return applyProductionMiddlewareHeaders(apiResponse, middlewareHeaders);
  }

  const metadataImageResponse = await handleMetadataImageRequest(request.clone());
  if (metadataImageResponse) {
    return applyProductionMiddlewareHeaders(metadataImageResponse, middlewareHeaders);
  }

  // Preserve the explicit JSON 404 for /api/* misses.
  if (pathname.startsWith("/api/")) {
    if (farmDocsAPIHandler) {
      const docsAPIResponse = await farmDocsAPIHandler(request.clone());
      if (docsAPIResponse) {
        return applyProductionMiddlewareHeaders(docsAPIResponse, middlewareHeaders);
      }
    }

    return applyProductionMiddlewareHeaders(new Response(
      JSON.stringify({ error: "API route not found", pathname }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    ), middlewareHeaders);
  }

  // Handle page routes (SSR)
  emitFarmEvent({ type: "render.start", route: pathname, pathname });
  const matchedRoute = matchPageRoute(pathname);
  if (matchedRoute) {
    const { route, params } = matchedRoute;
    emitFarmEvent({ type: "route.matched", pathname, route: route.pattern, params });
    
    try {
      const pprConfig = resolvePPRConfig(route.module);
      const pprBypassReason = pprConfig.enabled
        ? getPPRShellBypassReason(request, middlewareData, middlewareContext)
        : undefined;
      const pprCanCache = pprConfig.enabled && !pprBypassReason;
      const pprCacheKey = pprCanCache ? getPPRShellCacheKey(url) : null;
      if (pprConfig.enabled && pprBypassReason) {
        emitFarmEvent({ type: "ppr.shell.bypass", route: pathname, reason: pprBypassReason });
        emitFarmEvent({ type: "cache.bypass", route: pathname, reason: pprBypassReason });
        if (pprBypassReason === "refresh") {
          emitFarmEvent({ type: "ppr.refresh.start", route: pathname });
        }
      }
      if (pprCacheKey) {
        const cachedPPRShell = getCachedPPRShell(pprCacheKey);
        if (cachedPPRShell) {
          emitFarmEvent({ type: "ppr.shell.hit", route: pathname, key: pprCacheKey });
          emitFarmEvent({
            type: "render.complete",
            route: pathname,
            pathname,
            status: 200,
            durationMs: Date.now() - requestStartTime,
          });
          return applyProductionMiddlewareHeaders(new Response(cachedPPRShell, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              ...getPPRHeaders("hit", pprConfig),
            },
          }), middlewareHeaders);
        }
        emitFarmEvent({ type: "ppr.shell.miss", route: pathname, key: pprCacheKey });
      }

      // Get the page component and metadata
      const PageComponent = route.module.default;
      const pageMetadata = route.module.metadata || {};
      
      // Get applicable layouts for this page
      const applicableLayouts = getApplicableLayouts(pathname);
      
      if (PageComponent) {
        // Parse search params - make it a resolved Promise for async components
        const searchParamsObj = Object.fromEntries(url.searchParams.entries());
        
        // Import React SSR utilities
        const ReactDOMServer = await import("react-dom/server");
        const React = await import("react");
        
        // Render the page component
        const rawPageProps = {
          params,
          searchParams: Promise.resolve(searchParamsObj),
          path: pathname,
          ...(middlewareData?.size ? { middleware: { data: middlewareData } } : {}),
        };
        const pageProps = route.module.__farmResolveRouteProps
          ? await route.module.__farmResolveRouteProps(rawPageProps)
          : (() => {
              const routeSchemas = route.module.__farmRouteParsesProps
                ? {}
                : route.module.__farmRouteSchemas || {};
              const parsedParams = routeSchemas.params?.parse
                ? routeSchemas.params.parse(params)
                : params;
              const parsedSearch = routeSchemas.search?.parse
                ? routeSchemas.search.parse(searchParamsObj)
                : searchParamsObj;
              return {
                ...rawPageProps,
                params: parsedParams,
                search: parsedSearch,
                searchParams: Promise.resolve(parsedSearch),
              };
            })();
        
        const html = await _runWithMiddlewareData(middlewareData, () =>
          _runWithMiddlewareContext(middlewareContext, async () => {
            // First, render the page content
            let pageElement;

            // Check if the component is async
            if (PageComponent.constructor.name === "AsyncFunction" || PageComponent.toString().includes("async")) {
              // For async components, execute to get the element
              try {
                const result = await PageComponent(pageProps);
                if (React.isValidElement(result)) {
                  pageElement = result;
                } else {
                  pageElement = React.createElement("div", null, String(result));
                }
              } catch (asyncError) {
                if (isFarmRedirectError(asyncError) || isFarmNotFoundError(asyncError)) {
                  throw asyncError;
                }
                // If async rendering fails, try sync rendering as fallback
                pageElement = React.createElement(PageComponent, pageProps);
              }
            } else {
              // Sync component - create element directly
              pageElement = React.createElement(PageComponent, pageProps);
            }

            // Wrap with layouts (from innermost to outermost)
            // Layouts are sorted by depth (root first), so we process in reverse
            let wrappedElement = pageElement;
            for (let i = applicableLayouts.length - 1; i >= 0; i--) {
              const layout = applicableLayouts[i];
              const LayoutComponent = layout.module.default;
              if (LayoutComponent) {
                wrappedElement = React.createElement(LayoutComponent, {
                  children: wrappedElement,
                  params,
                });
              }
            }

            return ReactDOMServer.renderToString(wrappedElement);
          })
        );
        
        // Collect metadata from layouts and page (page overrides layouts)
        let mergedMetadata = {};
        for (const layout of applicableLayouts) {
          if (layout.module.metadata) {
            mergedMetadata = mergeMetadata(mergedMetadata, layout.module.metadata);
          }
        }
        mergedMetadata = mergeMetadata(mergedMetadata, pageMetadata);

        for (const kind of ["opengraph", "twitter"]) {
          const imageMatch = getMatchingMetadataImage(pathname, kind);
          if (imageMatch) {
            mergedMetadata = addMetadataImageReference(
              mergedMetadata,
              createMetadataImageReference(imageMatch),
            );
          }
        }

        const renderedMetadata = renderMetadataHead(mergedMetadata);
        const title = renderedMetadata.title;
        const metaTags = renderedMetadata.tags;
        const hasFavicon = renderedMetadata.hasFavicon;
        
        // Check if the layout already rendered a full HTML document
        const trimmedHtml = html.trim();
        const hasFullDocument = trimmedHtml.startsWith('<html') || trimmedHtml.startsWith('<!DOCTYPE');
        
        let fullHtml;
        if (hasFullDocument) {
          // Layout provides full HTML structure - inject CSS and client script
          fullHtml = html
            // Inject CSS link after opening head tag or first meta tag
            .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/farm-client.css">')
            // Inject title if not present and we have one
            .replace(/<head([^>]*)>([\\s\\S]*?)<\\/head>/i, (match, attrs, headContent) => {
              let nextHeadContent = headContent;
              if (!headContent.includes('<title>') && title !== "Farm.js App") {
                nextHeadContent += "\\n  <title>" + title + "</title>";
              }
              if (metaTags) nextHeadContent += metaTags;
              return nextHeadContent === headContent
                ? match
                : "<head" + attrs + ">" + nextHeadContent + "\\n</head>";
            })
            // Inject client script before closing body tag
            .replace(/<\\/body>/i, '  <script type="module" src="/farm-client.js"></script>\\n</body>');
          
          // Add DOCTYPE if not present
          if (!fullHtml.trim().startsWith('<!DOCTYPE')) {
            fullHtml = '<!DOCTYPE html>\\n' + fullHtml;
          }
        } else {
          // No layout with full document - wrap in HTML structure
          fullHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  \${hasFavicon ? "" : '<link rel="icon" href="data:,">'}
  <title>\${title}</title>\${metaTags}
  <link rel="stylesheet" href="/farm-client.css">
</head>
<body>
  <div id="root">\${html}</div>
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`;
        }
        
        // Include client CSS and hydration script
        // Add caching headers for edge caching (Vercel, Cloudflare, etc.)
        // s-maxage: cache at edge for 60s, stale-while-revalidate: serve stale while updating
        const hasRequestScopedMiddleware = Boolean(
          middlewareData?.size || middlewareContext?.size
        );
        const responseHeaders = {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": hasRequestScopedMiddleware
            ? "private, no-store"
            : "public, s-maxage=60, stale-while-revalidate=300",
          ...(pprConfig.enabled ? getPPRHeaders(pprCanCache ? "miss" : "bypass", pprConfig) : {}),
        };

        if (pprCacheKey && request.method.toUpperCase() !== "HEAD") {
          pprShellCache.set(
            pprCacheKey,
            { html: fullHtml },
            {
              paths: [pathname],
              tags: ["ppr"],
              revalidate: pprConfig.revalidate ?? false,
            }
          );
          emitFarmEvent({
            type: "ppr.shell.cached",
            route: pathname,
            key: pprCacheKey,
            revalidate: pprConfig.revalidate,
          });
        }

        if (pprBypassReason === "refresh") {
          emitFarmEvent({
            type: "ppr.refresh.complete",
            route: pathname,
            durationMs: Date.now() - requestStartTime,
          });
        }

        emitFarmEvent({
          type: "render.complete",
          route: pathname,
          pathname,
          status: 200,
          durationMs: Date.now() - requestStartTime,
        });

        return applyProductionMiddlewareHeaders(new Response(
          fullHtml,
          { 
            status: 200, 
            headers: responseHeaders
          }
        ), middlewareHeaders);
      }
    } catch (error) {
      if (isFarmRedirectError(error)) {
        const redirect = getFarmRedirectError(error);
        emitFarmEvent({
          type: "route.redirect",
          from: pathname,
          to: redirect.url,
          status: redirect.status,
        });
        emitFarmEvent({
          type: "render.complete",
          route: pathname,
          pathname,
          status: redirect.status,
          durationMs: Date.now() - requestStartTime,
        });
        return applyProductionMiddlewareHeaders(new Response(null, {
          status: redirect.status,
          headers: {
            Location: redirect.url,
          },
        }), middlewareHeaders);
      }

      if (isFarmNotFoundError(error)) {
        emitFarmEvent({ type: "route.notFound", pathname });
        emitFarmEvent({
          type: "render.complete",
          route: pathname,
          pathname,
          status: 404,
          durationMs: Date.now() - requestStartTime,
        });
        return applyProductionMiddlewareHeaders(new Response("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }), middlewareHeaders);
      }

      emitFarmEvent({ type: "render.error", route: pathname, error });
      console.error("SSR Error:", error);
      return applyProductionMiddlewareHeaders(new Response(
        \`<html><body><h1>Error</h1><p>\${error.message}</p><pre>\${error.stack}</pre></body></html>\`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      ), middlewareHeaders);
    }
  }

  // 404 fallback - render proper HTML page
  emitFarmEvent({ type: "route.notFound", pathname });
  try {
    const ReactDOMServer = await import("react-dom/server");
    const React = await import("react");
    
    // Default 404 page component
    function Default404Page() {
      return React.createElement("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#f9fafb",
          padding: "20px",
          textAlign: "center",
        }
      },
        React.createElement("div", {
          style: {
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "48px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            maxWidth: "500px",
            width: "100%",
          }
        },
          React.createElement("h1", {
            style: {
              fontSize: "96px",
              fontWeight: "bold",
              color: "#22c55e",
              margin: "0 0 16px 0",
              lineHeight: "1",
            }
          }, "404"),
          React.createElement("h2", {
            style: {
              fontSize: "24px",
              fontWeight: "600",
              color: "#1f2937",
              margin: "0 0 16px 0",
            }
          }, "Page Not Found"),
          React.createElement("p", {
            style: {
              fontSize: "16px",
              color: "#6b7280",
              margin: "0 0 24px 0",
            }
          }, "The page ", React.createElement("code", {
            style: { backgroundColor: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }
          }, pathname), " doesn't exist."),
          React.createElement("a", {
            href: "/",
            style: {
              display: "inline-block",
              backgroundColor: "#22c55e",
              color: "white",
              padding: "12px 24px",
              borderRadius: "8px",
              textDecoration: "none",
              fontWeight: "500",
            }
          }, "Go Home")
        ),
        React.createElement("p", {
          style: {
            marginTop: "24px",
            fontSize: "14px",
            color: "#9ca3af",
          }
        }, "Powered by Farm.js")
      );
    }
    
    // Use custom 404 page if provided, otherwise use default
    const NotFoundPage = hasCustomNotFound && CustomNotFoundComponent ? CustomNotFoundComponent : Default404Page;
    
    // Wrap 404 page with root layout if available
    let notFoundElement = React.createElement(NotFoundPage, { pathname: pathname });
    const applicableLayouts = getApplicableLayouts("/");
    
    // Wrap with layouts (from innermost to outermost)
    for (let i = applicableLayouts.length - 1; i >= 0; i--) {
      const layout = applicableLayouts[i];
      const LayoutComponent = layout.module.default;
      if (LayoutComponent) {
        notFoundElement = React.createElement(LayoutComponent, { children: notFoundElement, params: {} });
      }
    }
    
    const html = ReactDOMServer.renderToString(notFoundElement);
    
    // Check if layout provides full HTML document
    const trimmedHtml = html.trim();
    const hasFullDocument = trimmedHtml.startsWith('<html') || trimmedHtml.startsWith('<!DOCTYPE');
    
    let fullHtml;
    if (hasFullDocument) {
      fullHtml = html
        .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/farm-client.css">')
        .replace(/<\\/body>/i, '  <script type="module" src="/farm-client.js"></script>\\n</body>');
      if (!fullHtml.trim().startsWith('<!DOCTYPE')) {
        fullHtml = '<!DOCTYPE html>\\n' + fullHtml;
      }
    } else {
      fullHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/farm-client.css">
  <title>404 - Page Not Found</title>
</head>
<body>
  <div id="root">\${html}</div>
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`;
    }
    
    emitFarmEvent({
      type: "render.complete",
      route: pathname,
      pathname,
      status: 404,
      durationMs: Date.now() - requestStartTime,
    });

    return applyProductionMiddlewareHeaders(new Response(fullHtml, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }), middlewareHeaders);
  } catch (error) {
    console.error("404 render error:", error);
    return applyProductionMiddlewareHeaders(new Response(
      \`<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Page Not Found</h1><p>The page \${pathname} doesn't exist.</p><a href="/">Go Home</a></body></html>\`,
      { status: 404, headers: { "Content-Type": "text/html" } }
    ), middlewareHeaders);
  }
}

// Export as Web Standard fetch API
export async function fetch(request, context) {
  return _runWithAfterRequest(request, () => handleFarmRequest(request), context);
}
export default { fetch };
  `.trim();
}

/**
 * Build with Nitro using virtual bundle
 * Routes are now bundled in the SSR entry, so we just need to wrap the handler
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
  routeRuntimeManifest: FarmRouteRuntimeManifest,
  pluginManager?: PluginManager,
) {
  const fs = await import("fs/promises");

  const isVercel = preset === "vercel" || preset === "vercel-edge";
  const isCloudflareWorker = preset === "cloudflare-module";
  const outputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const ssrOutputDir = path.join(root, distDir, "ssr");

  logger.info(`📦 Nitro output directory: ${outputDir}`);
  logger.info(`📦 SSR entry file: ${ssrEntryFile}`);
  logger.info(`📦 Preset: ${preset}`);

  const farmWorkflows = await prepareFarmWorkflowsForNitro(config);
  const farmCron = await prepareFarmCronForNitro(config);
  if (farmWorkflows.workflows.length > 0) {
    logger.info(`⏱️  Found ${farmWorkflows.workflows.length} Farm workflow task(s)`);
  }
  if (farmCron.jobs.length > 0) {
    logger.info(`⏱️  Configured ${farmCron.jobs.length} Farm cron route(s)`);
  }
  if (preset === "cloudflare-pages" && farmCron.jobs.length > 0) {
    logger.warn(
      "Cloudflare Pages does not install Cron Triggers. Use the cloudflare-module preset or an external scheduler with .farm/cron-manifest.json.",
    );
  }

  const scheduledTasks = mergeScheduledTasks(farmWorkflows.scheduledTasks, farmCron.scheduledTasks);
  const cloudflareCronConfig = createFarmCronCloudflareConfig(farmCron.jobs);

  // Write SSR bundle to disk
  await fs.mkdir(ssrOutputDir, { recursive: true });

  for (const [fileName, content] of Object.entries(ssrBundle)) {
    const chunk = content as Rollup.OutputChunk | Rollup.OutputAsset;
    if (chunk.type === "chunk") {
      const filePath = path.join(ssrOutputDir, fileName);
      // Ensure parent directory exists for nested files like assets/foo.js
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, chunk.code);
    }
  }

  // Create entry that wraps the SSR handler with h3's fromWebHandler
  const nitroEntryPath = path.join(ssrOutputDir, "nitro-entry.mjs");

  const nitroEntryCode = `
// Farm.js Nitro Entry
// This file imports h3 and the SSR handler, wrapping it for Nitro

import { defineEventHandler } from 'h3'
import handler from './${ssrEntryFile}'

// Export the wrapped handler for Nitro
export default defineEventHandler((event) => handler.fetch(event.req, {
  waitUntil: (promise) => event.waitUntil(promise),
}))
  `.trim();

  await fs.writeFile(nitroEntryPath, nitroEntryCode);

  let nitroConfig: NitroConfig = {
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
    experimental: {
      tasks: farmWorkflows.workflows.length > 0 || farmCron.jobs.length > 0,
    },
    tasks: {
      ...farmWorkflows.tasks,
      ...farmCron.tasks,
    },
    scheduledTasks: isVercel ? farmWorkflows.scheduledTasks : scheduledTasks,
    ...(isCloudflareWorker && cloudflareCronConfig
      ? {
          cloudflare: cloudflareCronConfig,
        }
      : {}),
    // Use serverHandlers to define our workflow handler first, then the catch-all handler.
    handlers: [
      ...(farmWorkflows.handlerPath
        ? [
            {
              route: `${config.workflows.route}/**`,
              handler: farmWorkflows.handlerPath,
            },
          ]
        : []),
      {
        route: "/**",
        handler: nitroEntryPath,
      },
    ],
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
      ...routeRulesToNitroRouteRules(config.routeRules),
    },
    externals: {
      external: [
        "react",
        "react-dom",
        "@prisma/client",
        "@prisma/client/default",
        "@prisma/client/default.js",
        ".prisma/client",
        ".prisma/client/default",
        "better-sqlite3",
        "sharp",
      ],
    },
    rollupConfig: {
      external: isNitroRollupExternal,
    },
    minify: true, // Enable minification for smaller bundles
    sourceMap: false, // Skip sourcemaps for faster build
  };

  if (pluginManager) {
    nitroConfig = await pluginManager.runHookSerial("beforeNitroBuild", nitroConfig);
  }

  // Build with Nitro
  const nitroInstance = await nitro.createNitro(nitroConfig);
  await nitro.prepare(nitroInstance);
  await nitro.copyPublicAssets(nitroInstance);
  await nitro.build(nitroInstance);
  await nitroInstance.close();

  if (resolveImageRuntime(config, preset) === "node") {
    await copySharpRuntime(config, root, path.join(outputDir, "server"), fs);
  }

  if (pluginManager) {
    await pluginManager.runHookParallel("afterNitroBuild", {
      root,
      preset,
      distDir,
      outputDir,
    });
  }

  // Post-process for Vercel Build Output API v3
  // Move server/ to functions/__nitro.func/ and update config.json
  if (isVercel) {
    await postProcessVercelOutput(root, outputDir, fs, config, farmWorkflows, routeRuntimeManifest);
  }

  logger.success(`✅ Nitro build completed with preset: ${preset}`);
}

/**
 * Post-process Vercel output to match Build Output API v3
 * Moves server/ to functions/__nitro.func/ and updates routes
 */
async function postProcessVercelOutput(
  root: string,
  outputDir: string,
  fs: typeof import("fs/promises"),
  config: ResolvedFarmConfig,
  farmWorkflows: PreparedFarmWorkflows,
  routeRuntimeManifest: FarmRouteRuntimeManifest,
) {
  const serverDir = path.join(outputDir, "server");
  const functionsDir = path.join(outputDir, "functions");
  const nitroFuncDir = path.join(functionsDir, "__nitro.func");
  const staticDir = path.join(outputDir, "static");
  const publicDir = path.join(outputDir, "public");

  // Create functions directory
  await fs.mkdir(nitroFuncDir, { recursive: true });

  // Move server contents to functions/__nitro.func/
  const serverContents = await fs.readdir(serverDir);
  for (const file of serverContents) {
    const src = path.join(serverDir, file);
    const dest = path.join(nitroFuncDir, file);
    await fs.rename(src, dest);
  }

  // Remove empty server directory
  await fs.rmdir(serverDir);

  // Rename public to static (Vercel expects static files in static/)
  try {
    await fs.rename(publicDir, staticDir);
  } catch {
    // public might not exist
  }

  // Add runtime assets before cloning route-specific functions.
  await copyFarmDocsContentForVercel(config, root, nitroFuncDir, fs);
  await copyPrismaClientForVercel(root, nitroFuncDir, fs);

  // Update config.json routes to point to the function
  const configPath = path.join(outputDir, "config.json");
  const configContent = await fs.readFile(configPath, "utf-8");
  const vercelConfig = JSON.parse(configContent);

  const runtimeRoutes = await createFarmVercelRouteRuntimeFunctions(
    outputDir,
    routeRuntimeManifest,
    fs,
  );

  // Update routes to use the correct function path
  vercelConfig.routes = [
    // Serve static files first
    {
      handle: "filesystem",
    },
    ...runtimeRoutes,
    // API routes
    {
      src: "/api/(.*)",
      dest: "/__nitro",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
      },
    },
    // All other routes go to the serverless function
    {
      src: "/(.*)",
      dest: "/__nitro",
    },
  ];

  const vercelConfigWithWorkflowCrons = applyFarmWorkflowVercelCrons(
    vercelConfig,
    farmWorkflows.workflows,
  );
  const vercelConfigWithCrons = applyFarmCronVercelCrons(
    vercelConfigWithWorkflowCrons,
    config.cron.jobs,
  );

  await fs.writeFile(configPath, JSON.stringify(vercelConfigWithCrons, null, 2));

  logger.info("✅ Post-processed Vercel output for Build Output API v3");
}

async function copyFarmDocsContentForVercel(
  config: ResolvedFarmConfig,
  root: string,
  nitroFuncDir: string,
  fs: typeof import("fs/promises"),
) {
  const docsContentDir = resolveBuildDocsContentDir(config, root);
  if (!docsContentDir) return;

  const bundledContentDir = path.join(nitroFuncDir, "chunks", "nitro", "farm-docs-content");
  const lastModifiedManifest = createFarmDocsLastModifiedManifest(docsContentDir, {
    fallback: "now",
  });
  await fs.rm(bundledContentDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(bundledContentDir), { recursive: true });
  await fs.cp(docsContentDir, bundledContentDir, { recursive: true, force: true });
  await fs.writeFile(
    path.join(bundledContentDir, FARM_DOCS_LAST_MODIFIED_MANIFEST),
    `${JSON.stringify(lastModifiedManifest, null, 2)}\n`,
  );

  logger.info(`📚 Bundled docs content for Vercel: ${path.relative(root, docsContentDir)}`);
}

async function copySharpRuntime(
  config: ResolvedFarmConfig,
  root: string,
  nitroFuncDir: string,
  fs: typeof import("fs/promises"),
) {
  if (config.images.provider === "none") return;

  const projectRequire = createRequire(path.join(root, "package.json"));
  const copiedPackages = new Map<string, string>();
  const targetNodeModules = path.join(nitroFuncDir, "node_modules");

  async function copyPackage(
    packageName: string,
    parentRequire: NodeJS.Require,
  ): Promise<void> {
    if (copiedPackages.has(packageName)) return;

    const packageJsonPath = resolvePackageJson(parentRequire, packageName);
    if (!packageJsonPath) return;
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    const packageDir = path.dirname(packageJsonPath);
    const targetDir = path.join(targetNodeModules, ...packageName.split("/"));
    copiedPackages.set(packageName, String(packageJson.version || "*"));

    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.cp(packageDir, targetDir, {
      recursive: true,
      force: true,
      dereference: true,
    });

    const packageRequire = createRequire(packageJsonPath);
    const dependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.optionalDependencies || {}),
    };
    for (const dependency of Object.keys(dependencies)) {
      await copyPackage(dependency, packageRequire);
    }
  }

  await copyPackage("sharp", projectRequire);
  if (!copiedPackages.has("sharp")) {
    throw new Error(
      "Farm image optimization requires sharp. Reinstall dependencies without omitting optional packages.",
    );
  }

  const functionPackagePath = path.join(nitroFuncDir, "package.json");
  const functionPackage = JSON.parse(await fs.readFile(functionPackagePath, "utf8"));
  functionPackage.dependencies = {
    ...functionPackage.dependencies,
    ...Object.fromEntries(copiedPackages),
  };
  await fs.writeFile(functionPackagePath, JSON.stringify(functionPackage, null, 2));
  logger.info(`🖼️  Bundled Sharp image runtime (${copiedPackages.size} packages)`);
}

function resolvePackageJson(parentRequire: NodeJS.Require, packageName: string): string | null {
  for (const request of [`${packageName}/package.json`, `${packageName}/package`]) {
    try {
      return parentRequire.resolve(request);
    } catch {
      // Try the next package metadata export.
    }
  }
  return null;
}

async function copyPrismaClientForVercel(
  root: string,
  nitroFuncDir: string,
  fs: typeof import("fs/promises"),
) {
  const projectRequire = createRequire(path.join(root, "package.json"));

  let prismaClientDir: string;
  try {
    prismaClientDir = path.dirname(projectRequire.resolve("@prisma/client/default.js"));
  } catch {
    return;
  }

  const generatedClientDir = path.join(prismaClientDir, "..", "..", ".prisma", "client");

  try {
    await fs.access(generatedClientDir);
  } catch {
    return;
  }

  const targetNodeModules = path.join(nitroFuncDir, "node_modules");
  const targetPrismaScopeDir = path.join(targetNodeModules, "@prisma");
  const targetGeneratedDir = path.join(targetNodeModules, ".prisma", "client");
  const targetClientDir = path.join(targetPrismaScopeDir, "client");

  await fs.mkdir(targetPrismaScopeDir, { recursive: true });
  await fs.cp(prismaClientDir, targetClientDir, { recursive: true, force: true });
  await fs.cp(generatedClientDir, targetGeneratedDir, { recursive: true, force: true });

  const functionPackagePath = path.join(nitroFuncDir, "package.json");
  const clientPackagePath = path.join(prismaClientDir, "package.json");
  const [functionPackageContent, clientPackageContent] = await Promise.all([
    fs.readFile(functionPackagePath, "utf-8"),
    fs.readFile(clientPackagePath, "utf-8"),
  ]);
  const functionPackage = JSON.parse(functionPackageContent);
  const clientPackage = JSON.parse(clientPackageContent);

  functionPackage.dependencies = {
    ...functionPackage.dependencies,
    "@prisma/client": clientPackage.version,
  };

  await fs.writeFile(functionPackagePath, JSON.stringify(functionPackage, null, 2));
}
