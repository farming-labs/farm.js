import type { RedirectConfig, ResolvedFarmConfig, RewriteConfig } from "../config";
import { hasCustomFarmRouteContext, resolveDeployOutputPath } from "../config";
import {
  FARM_CLIENT_CSS_HREF_PLACEHOLDER,
  resolveHashedClientCssHref,
} from "./client-css-href";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import type { FarmPlugin, PluginManager } from "../plugin";
import {
  generateFarmClientPluginEntryCode,
  type FarmClientPluginEntryCode,
} from "../client-plugin-build";
import type { Rollup } from "vite";
import os from "os";
import path from "path";
import { constants as fsConstants, existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { builtinModules, createRequire } from "module";
import { isDeepStrictEqual } from "node:util";
import { logger } from "../utils";
import { getClientModuleMetadata } from "../utils/client-component";
import { isFarmMarkdownPageFile } from "../app-markdown";
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
import { resolveFarmDocsFontAssets, toFarmDocsPublicFontAssets } from "../docs/fonts";
import {
  createFarmRouteRuntimeManifest,
  validateFarmRouteRuntimeDeployment,
  writeFarmRouteRuntimeManifest,
} from "../route-runtime-manifest";
import type { FarmRouteRuntimeManifest, FarmRouteRuntimeManifestEntry } from "../route-runtime";
import { createFarmVercelRouteRuntimeFunctions } from "./vercel-route-runtime";
import { createFarmVercelImmutableAssetRoute } from "./vercel-assets";
import { createFarmNodeServerEntry } from "./node-server-entry";
import { readFarmI18nCatalogs } from "../i18n/catalog";
import type { FarmI18nCatalogs } from "../i18n/types";
import { getFarmIntegrationPluginServerRuntime } from "../integrations";
import type { TransformOptions } from "esbuild";
import { loadFarmProductionVite, type FarmProductionViteRuntime } from "../build/production-vite";
import { adaptTailwindVitePlugin } from "../build/vite-plugin-compat";
import { mergeFarmFontCss } from "../font-vite";
import type { FarmIslandStrategy } from "../island";
import { createFarmSourceAlias } from "../server/vite-config";
import { DEFAULT_NOT_FOUND_STYLES } from "../components/not-found-styles";
import { createFarmThemeCssPlugin } from "../theme/vite";
import { resolveFarmInstrumentationFile } from "../instrumentation";
import {
  getFarmRendererComponentExtensions,
  isReactRenderer,
  loadFarmRendererVitePlugins,
  REACT_RENDERER,
} from "../renderer";
import type { FarmRenderer } from "../renderer";

// Type alias for OutputBundle
type OutputBundle = Rollup.OutputBundle;
type NitroEsbuildOptions = NonNullable<NonNullable<NitroConfig["esbuild"]>["options"]>;
type FarmNitroRuntime = typeof import("nitro");
type UniversalPageRoute = {
  pattern: string;
  modulePath: string;
  source?: string;
  markdownSourcePath?: string;
};
type UniversalBoundaryRoute = {
  pattern: string;
  modulePath: string;
};
type UniversalRouteSlot = {
  name: string;
  ownerPattern: string;
  pattern: string;
  modulePath: string;
  containerId: string;
  interception: boolean;
  fallback: boolean;
};
type UniversalConfiguredHeaderRoute = {
  source: string;
  headers: Array<{ key: string; value: string }>;
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

function preloadFarmNitroRuntime(): Promise<PromiseSettledResult<FarmNitroRuntime>> {
  return import("nitro").then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
}

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
  "vite-rolldown",
  "nitro",
  "nitropack",
  "sharp",
]);
const FARM_SSR_PACKAGE_IMPORT = "#farm-ssr-entry";
const FARM_SSR_OUTPUT_DIR = "farm-ssr";
const FARM_CLIENT_BUILD_TARGET = ["es2020", "edge88", "firefox78", "chrome87", "safari14"];

function resolveNitroRuntimeDependency(root: string, specifier: string): string {
  const projectRequire = createRequire(path.join(root, "package.json"));
  let runtimeRequire = projectRequire;
  try {
    runtimeRequire = createRequire(projectRequire.resolve("@farm.js/core"));
  } catch {
    // Source-only framework builds can resolve Nitro directly from the project.
  }
  const nitroEntry = runtimeRequire.resolve("nitro");
  return createRequire(nitroEntry).resolve(specifier).split(path.sep).join("/");
}

function cloneConfigValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;
  if (value instanceof Date) return new Date(value) as T;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const entry of value) clone.push(cloneConfigValue(entry, seen));
    return clone as T;
  }

  const clone: Record<PropertyKey, unknown> = {};
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneConfigValue((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return clone as T;
}

function snapshotSSRRebundleOptions(config: NitroConfig) {
  return cloneConfigValue({
    alias: config.alias,
    commonJS: config.commonJS,
    entry: config.entry,
    externals: config.externals,
    exportConditions: config.exportConditions,
    imports: config.imports,
    inlineDynamicImports: config.inlineDynamicImports,
    moduleSideEffects: config.moduleSideEffects,
    noExternals: config.noExternals,
    node: config.node,
    nodeModulesDirs: config.nodeModulesDirs,
    plugins: config.plugins,
    replace: config.replace,
    serverEntry: config.serverEntry,
    typescript: config.typescript,
    unenv: config.unenv,
    virtual: config.virtual,
    wasm: config.experimental?.wasm,
    bundleRuntimeDependencies: config.experimental?.bundleRuntimeDependencies,
  });
}

async function canUseRolldownBuilder(): Promise<boolean> {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const isSupportedNode =
    (major === 20 && minor >= 19) || major > 22 || (major === 22 && minor >= 12);
  if (!isSupportedNode) {
    return false;
  }

  try {
    await import("rolldown");
    return true;
  } catch {
    // Rolldown is optional so Node 18 and --no-optional installs retain Rollup.
    return false;
  }
}

function isCloudflareImagePreset(preset: string): boolean {
  return preset === "cloudflare" || preset === "cloudflare-pages" || preset === "cloudflare-module";
}

function shouldUseExternalMetadataImageRuntime(
  preset: string,
  hasGeneratedMetadataImages: boolean,
): boolean {
  return hasGeneratedMetadataImages && preset !== "vercel-edge" && !isCloudflareImagePreset(preset);
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

const FARM_METADATA_IMAGE_WASM_PREFIX = "\0farm-metadata-image-wasm:";

function createMetadataImageWasmPlugin(): Rollup.Plugin {
  return {
    name: "farm-metadata-image-wasm",
    resolveId(source, importer) {
      if (
        !source.endsWith(".wasm?module") ||
        !importer?.replace(/\\/g, "/").includes("/@vercel/og/")
      ) {
        return null;
      }

      const requestPath = source.slice(0, -"?module".length);
      const resolvedPath = path.isAbsolute(requestPath)
        ? requestPath
        : path.resolve(path.dirname(importer.split("?", 1)[0]), requestPath);
      return `${FARM_METADATA_IMAGE_WASM_PREFIX}${resolvedPath}`;
    },
    load(id) {
      if (!id.startsWith(FARM_METADATA_IMAGE_WASM_PREFIX)) return null;
      const wasmPath = id.slice(FARM_METADATA_IMAGE_WASM_PREFIX.length);
      const encoded = readFileSync(wasmPath).toString("base64");
      return `
const encoded = ${JSON.stringify(encoded)};
const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
export default new WebAssembly.Module(bytes);
`;
    },
  };
}

function collectSSRExternalPackages(ssrBundle: OutputBundle): Set<string> {
  const emittedFiles = new Set(
    Object.keys(ssrBundle).map((fileName) => fileName.replace(/^\.\//, "")),
  );
  const externalPackages = new Set<string>();

  for (const [fileName, output] of Object.entries(ssrBundle)) {
    if (output.type !== "chunk") continue;

    for (const importId of [...output.imports, ...output.dynamicImports]) {
      const normalizedImportId = importId.replace(/\\/g, "/");
      const normalizedId = normalizedImportId.replace(/^\.\//, "");
      const resolvedRelativeId =
        normalizedImportId.startsWith("./") || normalizedImportId.startsWith("../")
          ? path.posix.normalize(path.posix.join(path.posix.dirname(fileName), normalizedImportId))
          : null;
      if (
        emittedFiles.has(normalizedId) ||
        (resolvedRelativeId !== null && emittedFiles.has(resolvedRelativeId)) ||
        NODE_BUILTIN_MODULES.has(importId) ||
        importId.startsWith("node:")
      ) {
        continue;
      }

      if (
        path.isAbsolute(importId) ||
        /^[A-Za-z]:[\\/]/.test(importId) ||
        importId.startsWith("#") ||
        importId.startsWith("\0")
      ) {
        externalPackages.add(importId);
        continue;
      }

      const segments = importId.split("/");
      const packageName = importId.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
      if (packageName) externalPackages.add(packageName);
    }
  }

  return externalPackages;
}

function createExternalSSRBundlePlugin(
  nitroEntryPath: string,
  ssrOutputDir: string,
  ssrEntryFile: string,
): Rollup.Plugin {
  const resolvedNitroEntry = path.resolve(nitroEntryPath);
  const resolvedSSREntry = path.resolve(ssrOutputDir, ssrEntryFile);

  return {
    name: "farm-externalize-prebuilt-ssr",
    resolveId(source, importer) {
      if (!importer || path.resolve(importer) !== resolvedNitroEntry) {
        return null;
      }

      const resolvedImport = path.resolve(path.dirname(importer), source);
      if (resolvedImport !== resolvedSSREntry) return null;

      // A package import remains valid even when Nitro moves its adapter into a
      // nested chunk. A relative external import would be resolved from that
      // adapter chunk and can point at the wrong location.
      return { id: FARM_SSR_PACKAGE_IMPORT, external: true };
    },
  };
}

function hasRollupPlugins(plugins: unknown): boolean {
  if (Array.isArray(plugins)) {
    return plugins.some((plugin) => hasRollupPlugins(plugin));
  }
  return Boolean(plugins);
}

export function hasFarmRuntimeConfigModule(
  config: Pick<ResolvedFarmConfig, "layers">,
  configModulePath: string | null,
): boolean {
  return Boolean(configModulePath || (config.layers || []).some((layer) => layer.configFile));
}

function createEsbuildTransformOptions(
  configuredEsbuildOptions: NitroEsbuildOptions,
  minify: boolean,
  defaultTarget: string,
): TransformOptions {
  const {
    include: _include,
    exclude: _exclude,
    sourceMap: _sourceMap,
    loaders: _loaders,
    ...configuredTransformOptions
  } = configuredEsbuildOptions;
  const configuredTarget = Array.isArray(configuredTransformOptions.target)
    ? configuredTransformOptions.target.filter(
        (target): target is string => typeof target === "string",
      )
    : configuredTransformOptions.target;
  const transformTarget =
    Array.isArray(configuredTarget) && configuredTarget.length === 0
      ? defaultTarget
      : (configuredTarget ?? defaultTarget);
  const transformSupported = configuredTransformOptions.supported
    ? Object.fromEntries(
        Object.entries(configuredTransformOptions.supported).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      )
    : undefined;

  return {
    ...(configuredTransformOptions as TransformOptions),
    format: "esm",
    target: transformTarget,
    loader: "js",
    sourcemap: false,
    minify,
    keepNames: configuredTransformOptions.keepNames ?? true,
    legalComments: configuredTransformOptions.legalComments ?? "none",
    supported: transformSupported,
  };
}

function createEsbuildChunkMinifyPlugin(
  configuredEsbuildOptions: NitroEsbuildOptions,
): Rollup.Plugin {
  const configuredTransformOptions = createEsbuildTransformOptions(
    configuredEsbuildOptions,
    true,
    "esnext",
  );
  // Nitro already applies the configured esbuild transform to every module.
  // Keep this final chunk pass limited to minification controls so options such
  // as banner, footer, define, drop, and property mangling are not applied twice.
  const transformOptions: TransformOptions = {
    format: "esm",
    target: configuredTransformOptions.target,
    loader: "js",
    sourcemap: false,
    minify: true,
    keepNames: configuredTransformOptions.keepNames,
    legalComments: configuredTransformOptions.legalComments,
    charset: configuredTransformOptions.charset,
  };

  return {
    name: "farm-esbuild-minify",
    async renderChunk(code, chunk) {
      const { transform } = await import("esbuild");
      const result = await transform(code, {
        ...transformOptions,
        sourcefile: chunk.fileName,
      });
      if (!result.code) return null;
      return {
        code: result.code,
        map: result.map || null,
      };
    },
  };
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

function hasFarmServerRuntimePlugins(config: ResolvedFarmConfig): boolean {
  return (config.plugins || []).some((plugin) => {
    if (getFarmIntegrationPluginServerRuntime(plugin) === false) return false;

    return Boolean(
      plugin.setup ||
      plugin.init ||
      plugin.ready ||
      plugin.shutdown ||
      plugin.runtime ||
      plugin.router ||
      plugin.render ||
      plugin.beforeRouteMatch ||
      plugin.afterRouteMatch ||
      plugin.beforeRender ||
      plugin.afterRender ||
      plugin.onError ||
      plugin.transformHTML,
    );
  });
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
    productionVite?: FarmProductionViteRuntime | Promise<FarmProductionViteRuntime>;
  } = {},
): Promise<void> {
  const root = options.root || config.root || process.cwd();
  const preset = options.preset || config.preset || "node-server";
  const srcDir = config.srcDir || "src";
  const distDir = config.distDir || ".farm";
  const deployOutputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const lifecyclePluginManager = options.pluginManager;
  // Attach all-settled handlers immediately so an earlier discovery failure
  // cannot leave a rejected preload unobserved.
  const productionViteResultPromise = Promise.allSettled([
    Promise.resolve(options.productionVite ?? loadFarmProductionVite()),
  ]);
  // Nitro is guaranteed to be needed for every universal production build.
  // Start resolving it while route metadata and the client/SSR bundles are
  // prepared, then consume the settled result at the adapter stage.
  const nitroRuntimeResultPromise = preloadFarmNitroRuntime();

  logger.info(`🚜 Building Farm.js application (universal) with preset: ${preset}...`);

  try {
    const routeRuntimeManifestPromise = options.routeRuntimeManifest
      ? Promise.resolve(options.routeRuntimeManifest)
      : createFarmRouteRuntimeManifest({
          config,
          routeManager,
          apiRouteManager,
          root,
        });
    const routeRuntimeManifestResultPromise = Promise.allSettled([routeRuntimeManifestPromise]);

    // Get page routes first (needed for both client and SSR builds)
    const pageRoutes: UniversalPageRoute[] = [];
    for (const [pattern, entry] of routeManager.getRoutes()) {
      const markdownSourcePath =
        entry.markdownSourcePath ||
        (isFarmMarkdownPageFile(entry.modulePath) ? entry.modulePath : undefined);
      pageRoutes.push({
        pattern,
        modulePath: entry.modulePath,
        ...(markdownSourcePath
          ? {
              source: readFileSync(markdownSourcePath, "utf8"),
              markdownSourcePath,
            }
          : {}),
      });
    }
    const routeSlots: UniversalRouteSlot[] = Array.from(
      routeManager.getRouteSlots().values(),
      (entry) => ({
        name: entry.name,
        ownerPattern: entry.ownerPattern,
        pattern: entry.pattern,
        modulePath: entry.modulePath,
        containerId: entry.containerId,
        interception: entry.interception,
        fallback: entry.fallback,
      }),
    );
    logger.info(`📋 Found ${pageRoutes.length} page routes`);

    // Discover layout files early (needed for client CSS scanning)
    const fs = await import("fs/promises");
    const layoutRoutes: Array<{ pattern: string; modulePath: string }> = [];
    const appDir = path.join(root, srcDir, "app");

    async function findLayoutsForClient(dir: string, routePrefix: string = "/"): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.match(/^layout\.(tsx?|jsx?|vue|svelte)$/)) {
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
    const [productionViteResult] = await productionViteResultPromise;
    if (productionViteResult.status === "rejected") {
      // Route evaluation may still be using the project module server. Drain it
      // before the outer build cleanup closes that server.
      await routeRuntimeManifestResultPromise;
      throw productionViteResult.reason;
    }
    const productionVite = productionViteResult.value;
    if (productionVite.builder === "rolldown") {
      logger.info("⚡ Building application bundles with Vite Rolldown");
    }

    const buildClientBundle = () =>
      buildClient(
        productionVite,
        config,
        root,
        srcDir,
        clientOutputDir,
        pageRoutes,
        layoutRoutes,
        routeSlots,
      );
    const buildSSRBundle = () =>
      buildSSRInMemory(
        productionVite,
        config,
        root,
        routeManager,
        apiRouteManager,
        serverRenderer,
        preset,
        pageRoutes,
        layoutRoutes,
        routeSlots,
      );

    // Route metadata and the client/SSR graphs read independent inputs. Drain
    // every task before propagating a deterministic first failure so a rejected
    // sibling cannot keep mutating build output in the background. Renderer
    // compiler plugins with process-global caches can request serial graphs.
    let clientBuildResult: PromiseSettledResult<Awaited<ReturnType<typeof buildClientBundle>>>;
    let ssrBuildResult: PromiseSettledResult<Awaited<ReturnType<typeof buildSSRBundle>>>;
    if (config.renderer.buildConcurrency === "serial") {
      logger.info(`📦 Building client and SSR bundles serially for ${config.renderer.name}...`);
      [clientBuildResult] = await Promise.allSettled([buildClientBundle()]);
      [ssrBuildResult] = await Promise.allSettled([buildSSRBundle()]);
    } else {
      logger.info("📦 Building client and SSR bundles in parallel...");
      [clientBuildResult, ssrBuildResult] = await Promise.allSettled([
        buildClientBundle(),
        buildSSRBundle(),
      ]);
    }
    const [routeRuntimeManifestResult] = await routeRuntimeManifestResultPromise;
    if (routeRuntimeManifestResult.status === "rejected") {
      throw routeRuntimeManifestResult.reason;
    }
    if (ssrBuildResult.status === "rejected") throw ssrBuildResult.reason;
    if (clientBuildResult.status === "rejected") {
      if (
        productionVite.builder !== "rolldown" ||
        !(clientBuildResult.reason instanceof IncompleteClientBuildOutputError)
      ) {
        throw clientBuildResult.reason;
      }

      // Rolldown can very rarely complete a parallel client build without
      // traversing its entry graph. Preserve the fast parallel path, then
      // recover only that invalid result once the SSR graph is fully drained.
      logger.warn("Client bundle was incomplete; retrying after the SSR build...");
      await buildClient(
        productionVite,
        config,
        root,
        srcDir,
        clientOutputDir,
        pageRoutes,
        layoutRoutes,
        routeSlots,
      );
    }

    const ssrResult = ssrBuildResult.value;
    const routeRuntimeManifest = routeRuntimeManifestResult.value;

    const runtimeValidation = validateFarmRouteRuntimeDeployment(routeRuntimeManifest, preset);
    for (const warning of runtimeValidation.warnings) {
      logger.warn(warning);
    }

    const { bundle: ssrBundle, entryFile: ssrEntryFile, configuredHeaderRoutes } = ssrResult;
    await writeSSRAssetsToClient(ssrBundle, clientOutputDir);
    if (config.docs.enabled) {
      await copyFarmDocsFontAssetsToClient(root, clientOutputDir);
    }

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
      configuredHeaderRoutes,
      nitroRuntimeResultPromise,
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
    if (fileName === "farm-fonts.css") {
      await mergeBuiltFontCss(outputDir, output.source);
      continue;
    }
    const filePath = path.join(outputDir, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, output.source);
  }
}

async function copyFarmDocsFontAssetsToClient(root: string, outputDir: string): Promise<void> {
  const fs = await import("fs/promises");
  await Promise.all(
    resolveFarmDocsFontAssets(root).map(async ({ sourcePath, url }) => {
      const targetPath = path.join(outputDir, url.replace(/^\/+/, ""));
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }),
  );
}

async function mergeBuiltFontCss(
  outputDir: string,
  fontCssSource?: string | Uint8Array,
): Promise<void> {
  const fs = await import("fs/promises");
  const fontCssPath = path.join(outputDir, "farm-fonts.css");
  let fontCss = fontCssSource;
  if (fontCss === undefined) {
    try {
      fontCss = await fs.readFile(fontCssPath);
    } catch {
      return;
    }
  }

  const clientCssPath = path.join(outputDir, "farm-client.css");
  let clientCss = "";
  try {
    clientCss = await fs.readFile(clientCssPath, "utf8");
  } catch {
    // A font-only app may not have produced a stylesheet yet.
  }
  const normalizedFontCss =
    typeof fontCss === "string" ? fontCss : Buffer.from(fontCss).toString("utf8");
  await fs.writeFile(fontCssPath, normalizedFontCss);
  await fs.writeFile(clientCssPath, mergeFarmFontCss(clientCss, normalizedFontCss));
}

class IncompleteClientBuildOutputError extends Error {
  constructor(detail: string) {
    super(`Farm client build produced incomplete output: ${detail}`);
    this.name = "IncompleteClientBuildOutputError";
  }
}

async function validateClientBuildOutput(
  root: string,
  srcDir: string,
  outputDir: string,
): Promise<void> {
  const fs = await import("fs/promises");
  const clientEntryPath = path.join(outputDir, "farm-client.js");
  let clientEntrySize = 0;

  try {
    const clientEntry = await fs.stat(clientEntryPath);
    if (clientEntry.isFile()) clientEntrySize = clientEntry.size;
  } catch {
    // Report the missing entry through the shared incomplete-output diagnostic.
  }

  if (clientEntrySize === 0) {
    throw new IncompleteClientBuildOutputError("farm-client.js is missing or empty");
  }

  const clientCssPath = path.join(outputDir, "farm-client.css");
  const globalsCssPath = path.join(root, srcDir, "app", "globals.css");
  let expectsCss = false;
  try {
    const globalsCss = await fs.readFile(globalsCssPath, "utf8");
    expectsCss = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "").trim().length > 0;
  } catch {
    // Vite reports a missing imported stylesheet before output validation.
  }

  try {
    const clientCss = await fs.stat(clientCssPath);
    if (expectsCss && (!clientCss.isFile() || clientCss.size === 0)) {
      throw new IncompleteClientBuildOutputError("farm-client.css is empty");
    }
  } catch (error) {
    if (error instanceof IncompleteClientBuildOutputError) throw error;
    if (expectsCss) {
      throw new IncompleteClientBuildOutputError("farm-client.css is missing");
    }

    // Farm's HTML always references this stable path. Keep intentionally
    // style-free applications from receiving an unnecessary 404.
    await fs.writeFile(clientCssPath, "");
  }
}

/**
 * Build client bundle (to disk) with hydration for "use client" components
 */
async function buildClient(
  productionVite: FarmProductionViteRuntime,
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  outputDir: string,
  pageRoutes: UniversalPageRoute[],
  layoutRoutes: Array<{ pattern: string; modulePath: string }> = [],
  routeSlots: UniversalRouteSlot[] = [],
) {
  const viteBuild = productionVite.build;
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
  const clientPages: Array<{
    pattern: string;
    modulePath: string;
    relativePath: string;
    pageShouldHydrate: boolean;
    islandStrategy: FarmIslandStrategy;
  }> = [];

  const clientLayouts = layoutRoutes.map((layout) => {
    try {
      const metadata = getClientModuleMetadata(layout.modulePath, root);
      return {
        ...layout,
        shouldHydrate: metadata.shouldHydrate,
        islandStrategy: metadata.islandStrategy,
      };
    } catch (error) {
      logger.warn(`⚠️  Could not inspect layout file ${layout.modulePath}: ${error}`);
      return {
        ...layout,
        shouldHydrate: false,
        islandStrategy: null,
      };
    }
  });

  const layoutAppliesToRoute = (layoutPattern: string, routePattern: string) =>
    layoutPattern === "/" ||
    routePattern === layoutPattern ||
    routePattern.startsWith(`${layoutPattern}/`);

  const adapterOwnsDocsRuntime = Boolean(
    isReactRenderer(config.renderer) &&
    config.docs?.enabled &&
    config.docs.adapter?.server &&
    config.docs.adapter.react,
  );
  const adapterDocsEntry = config.docs?.enabled
    ? `/${config.docs.entry || "docs"}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/"
    : null;
  const isAdapterDocsRoute = (routePattern: string) =>
    Boolean(
      adapterOwnsDocsRuntime &&
      adapterDocsEntry &&
      (adapterDocsEntry === "/" ||
        routePattern === adapterDocsEntry ||
        routePattern.startsWith(`${adapterDocsEntry}/`)),
    );

  for (const route of pageRoutes) {
    // The adapter imports and hydrates its compiled MDX modules itself. Keeping
    // the same files in Farm's generic route table duplicates the docs runtime
    // and can pull server-only Markdown dependencies into the browser bundle.
    if (isAdapterDocsRoute(route.pattern)) continue;

    try {
      const metadata = isFarmMarkdownPageFile(route.modulePath)
        ? {
            isClientComponent: false,
            shouldHydrate: false,
            islandStrategy: null,
          }
        : getClientModuleMetadata(route.modulePath, root);
      const applicableClientLayouts = clientLayouts.filter(
        (layout) => layout.shouldHydrate && layoutAppliesToRoute(layout.pattern, route.pattern),
      );
      if (metadata.suppressedAsyncHydration) {
        logger.warn(
          `⚠️  ${route.pattern} is an async server component that imports client components; ` +
            `React cannot hydrate async components, so the route stays server-rendered ` +
            `and its client imports are not interactive.`,
        );
      }
      if (metadata.shouldHydrate || applicableClientLayouts.length > 0) {
        const relativePath = route.modulePath.replace(root, "").replace(/^\//, "");
        const hydrationStrategies = [
          ...(metadata.islandStrategy ? [metadata.islandStrategy] : []),
          ...applicableClientLayouts.flatMap((layout) =>
            layout.islandStrategy ? [layout.islandStrategy] : [],
          ),
        ];
        const islandStrategy = hydrationStrategies.every(
          (strategy) => strategy === hydrationStrategies[0],
        )
          ? (hydrationStrategies[0] ?? "load")
          : "load";
        clientPages.push({
          ...route,
          relativePath,
          pageShouldHydrate: metadata.shouldHydrate,
          islandStrategy,
        });
        logger.info(`📱 Found hydratable route: ${route.pattern} -> ${route.modulePath}`);
      }
    } catch (error) {
      logger.warn(`⚠️  Could not inspect route file ${route.modulePath}: ${error}`);
    }
  }

  if (config.docs?.enabled && !adapterOwnsDocsRuntime) {
    const docsEntry =
      `/${config.docs.entry || "docs"}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    const applicableClientLayouts = clientLayouts.filter(
      (layout) => layout.shouldHydrate && layoutAppliesToRoute(layout.pattern, docsEntry),
    );
    if (applicableClientLayouts.length > 0) {
      const hydrationStrategies = applicableClientLayouts.flatMap((layout) =>
        layout.islandStrategy ? [layout.islandStrategy] : [],
      );
      const islandStrategy = hydrationStrategies.every(
        (strategy) => strategy === hydrationStrategies[0],
      )
        ? (hydrationStrategies[0] ?? "load")
        : "load";
      const docsPatterns =
        docsEntry === "/" ? ["/", "/[...slug]"] : [docsEntry, `${docsEntry}/[...slug]`];
      const docsClientRoutes = docsPatterns.map((pattern) => ({
        pattern,
        modulePath: "",
        relativePath: "",
        pageShouldHydrate: false,
        islandStrategy,
      }));

      // Docs requests take precedence over app page routes on the server, so
      // their synthetic layout-only entries must take precedence in the client
      // route table as well.
      clientPages.unshift(...docsClientRoutes);
    }
  }

  const clientRouteSlots = routeSlots.filter((slot) => {
    try {
      return getClientModuleMetadata(slot.modulePath, root).shouldHydrate;
    } catch (error) {
      logger.warn(`⚠️  Could not inspect route slot ${slot.modulePath}: ${error}`);
      return false;
    }
  });

  logger.info(
    `📱 Total hydratable routes detected: ${clientPages.length} pages, ${clientLayouts.filter((layout) => layout.shouldHydrate).length} layouts, and ${clientRouteSlots.length} slots`,
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
    clientLayouts,
    clientRouteSlots,
    root,
    srcDir,
    adapterOwnsDocsRuntime ? false : isFarmDocsSearchEnabled(config.docs),
    adapterOwnsDocsRuntime ? undefined : resolveFarmDocsSearchClientModule(root),
    config.docs?.enabled ? config.docs.entry : undefined,
    adapterOwnsDocsRuntime ? config.docs.adapter?.react : undefined,
    config.i18n,
    config.plugins,
    config.renderer,
    config.publicRuntimeConfig,
  );

  // Write the client entry to a temporary file
  await fs.writeFile(clientEntryPath, clientHydrationCode);

  // Tailwind support:
  // - If project has explicit PostCSS config, respect it.
  // - Otherwise enable built-in @tailwindcss/vite (out of the box).
  const hasScopedPostcssConfig = hasProjectPostcssConfig(root);
  let postcssSearchPath: string | undefined;
  let tailwindVitePlugin: any = undefined;
  const rendererVitePlugins = await loadFarmRendererVitePlugins(config.renderer, root, {
    ssr: false,
  });
  if (hasScopedPostcssConfig) {
    logger.info("📦 Using project PostCSS/Tailwind configuration");
  } else {
    const postcssConfigPath = path.join(clientEntryDir, "postcss.config.cjs");
    await fs.writeFile(postcssConfigPath, "module.exports = { plugins: [] };\n");
    postcssSearchPath = clientEntryDir;
    try {
      const tailwindVite = (await import("@tailwindcss/vite")).default;
      tailwindVitePlugin = adaptTailwindVitePlugin(tailwindVite(), productionVite.builder);
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
        // Preserve Farm's Vite 5 browser baseline when the production builder
        // uses Vite 8, whose default target only covers newer browsers.
        target: FARM_CLIENT_BUILD_TARGET,
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
            chunkFileNames: "chunks/[name]-h[hash].js",
            hashCharacters: "hex",
            // Use predictable name for CSS so we can reference it in SSR HTML
            assetFileNames: (assetInfo) => {
              if (assetInfo.name?.endsWith(".css")) {
                return "farm-client.css";
              }
              return "assets/[name]-h[hash][extname]";
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
        createFarmThemeCssPlugin(config.theme, config.basePath),
        ...(tailwindVitePlugin ? [tailwindVitePlugin] : []),
        ...(rendererVitePlugins as any[]),
        ...(config.vite.plugins || []),
        // Plugin to redirect @farm.js/core imports to client-only exports
        {
          name: "farm-client-only-imports",
          enforce: "pre" as const,
          resolveId(id) {
            // Redirect @farm.js/core to just export client-safe parts
            // Don't redirect @farm.js/core/client - that's already client-safe
            if (id === "@farm.js/core") {
              return { id: "\0farm-client-exports", external: false };
            }
            if (id === "@farm.js/core/i18n/server") {
              return { id: "\0farm-i18n-client-bridge", external: false };
            }
            // Block server-only imports completely
            if (
              id === "@farm.js/core/server" ||
              id === "@farm.js/core/api" ||
              id === "@farm.js/core/middleware" ||
              id === "@farm.js/core/headers" ||
              id === "@farm.js/core/config" ||
              id.includes("@farm.js/core/middleware") ||
              id.includes("@farm.js/core/query/server")
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
              id === "vite-rolldown" ||
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
              return "export const GET = () => {}; export const HEAD = () => {}; export const QUERY = () => {}; export const POST = () => {}; export const PUT = () => {}; export const DELETE = () => {}; export const PATCH = () => {}; export const OPTIONS = () => {}; export default {};";
            }
            if (id === "\0farm-i18n-client-bridge") {
              return 'export { createTranslator, format, getLocale, getLocaleSource, t } from "@farm.js/core/i18n/client";';
            }
            if (id === "\0farm-client-exports") {
              // Only export client-safe parts (no type exports - they're erased at compile time)
              return [
                "// Farm.js Client Exports - Safe for browser bundling",
                'export { Link } from "@farm.js/core/client";',
                'export { useRouter } from "@farm.js/core/client";',
                'export { usePathname, useSearchParams } from "@farm.js/core/navigation";',
                'export { createAPIClient } from "@farm.js/core/client";',
                'export { localFont, remoteFont } from "@farm.js/core/font";',
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
        dedupe: [...(config.renderer.dedupe || [])],
      },
      // Optimize dependencies - exclude server-side code from client bundle
      optimizeDeps: {
        exclude: [
          "@farm.js/core/server",
          "@farm.js/core/api",
          "@farm.js/core/middleware",
          "@farm.js/core/headers",
        ],
      },
    });
    await mergeBuiltFontCss(outputDir);
    await validateClientBuildOutput(root, srcDir, outputDir);
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
function generateUniversalRouterStateRuntime(): string {
  return `
const FARM_PAGE_STATE_KEY = "__farmPageState";
const IDLE_NAVIGATION_STATE = {
  state: "idle",
  pending: false,
  from: null,
  to: null,
  action: null,
  startedAt: null,
};

function createNavigationLocation(url) {
  return {
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

function scrollElementStorageKey(pathname, key) {
  return "farm-scroll-" + pathname + ":" + key;
}

function createHistoryState(path, pageState, currentState) {
  const base = currentState && typeof currentState === "object" ? { ...currentState } : {};
  return {
    ...base,
    path,
    [FARM_PAGE_STATE_KEY]: pageState,
  };
}
`.trim();
}

function generateUniversalRouterStateProperties(): string {
  return `
  blockers: new Set(),
  navigationListeners: new Set(),
  navigationState: IDLE_NAVIGATION_STATE,
  observers: new Map(),
  scrollElements: new Map(),
  currentPath: window.location.pathname + window.location.search,

  getNavigationState: function() {
    return this.navigationState;
  },

  subscribeNavigation: function(listener) {
    this.navigationListeners.add(listener);
    listener(this.navigationState);
    return () => this.navigationListeners.delete(listener);
  },

  addBlocker: function(blocker) {
    this.blockers.add(blocker);
    return () => this.blockers.delete(blocker);
  },

  shouldBlockNavigation: async function(context) {
    for (const blocker of this.blockers) {
      if (await blocker(context)) return true;
    }
    return false;
  },

  startNavigation: function(from, to, action) {
    this.setNavigationState({
      state: "loading",
      pending: true,
      from,
      to: createNavigationLocation(to),
      action,
      startedAt: Date.now(),
    });
  },

  finishNavigation: function() {
    this.setNavigationState(IDLE_NAVIGATION_STATE);
  },

  setNavigationState: function(state) {
    this.navigationState = state;
    for (const listener of this.navigationListeners) listener(state);
  },

  pushState: function(state, href) {
    this.writePageState("push", state, href);
  },

  replaceState: function(state, href) {
    this.writePageState("replace", state, href);
  },

  writePageState: function(action, state, href) {
    const url = new URL(href || window.location.href, window.location.origin);
    const nextState = createHistoryState(
      url.pathname + url.search,
      state,
      window.history.state,
    );
    if (action === "replace") {
      window.history.replaceState(nextState, "", url);
    } else {
      window.history.pushState(nextState, "", url);
    }
    window.dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
  },

  registerScrollElement: function(key, element) {
    this.scrollElements.set(key, element);
    this.restoreScrollElement(window.location.pathname, key, element);
    return () => {
      if (this.scrollElements.get(key) === element) this.scrollElements.delete(key);
    };
  },

  saveScrollPosition: function(pathname) {
    try {
      sessionStorage.setItem(
        "farm-scroll-" + pathname,
        JSON.stringify({ x: window.scrollX, y: window.scrollY }),
      );
      for (const [key, element] of this.scrollElements) {
        sessionStorage.setItem(
          scrollElementStorageKey(pathname, key),
          JSON.stringify({ x: element.scrollLeft, y: element.scrollTop }),
        );
      }
    } catch {}
  },

  restoreScrollPosition: function(pathname) {
    try {
      const saved = sessionStorage.getItem("farm-scroll-" + pathname);
      if (saved) {
        const position = JSON.parse(saved);
        setTimeout(() => window.scrollTo(position.x, position.y), 0);
      }
      for (const [key, element] of this.scrollElements) {
        this.restoreScrollElement(pathname, key, element);
      }
    } catch {}
  },

  restoreScrollElement: function(pathname, key, element) {
    try {
      const saved = sessionStorage.getItem(scrollElementStorageKey(pathname, key));
      if (!saved) return;
      const position = JSON.parse(saved);
      setTimeout(() => {
        element.scrollLeft = position.x;
        element.scrollTop = position.y;
      }, 0);
    } catch {}
  },

  runViewTransition: async function(enabled, callback) {
    const startViewTransition = document.startViewTransition;
    if (!enabled || typeof startViewTransition !== "function") {
      await callback();
      return;
    }
    const transition = startViewTransition.call(document, () => callback());
    await transition.finished;
  },
`.trim();
}

function generateClientHydrationEntry(
  clientPages: Array<{
    pattern: string;
    modulePath: string;
    relativePath: string;
    pageShouldHydrate: boolean;
    islandStrategy: FarmIslandStrategy;
  }>,
  layoutRoutes: Array<{
    pattern: string;
    modulePath: string;
    shouldHydrate: boolean;
    islandStrategy: FarmIslandStrategy | null;
  }>,
  clientRouteSlots: UniversalRouteSlot[],
  root: string,
  srcDir: string,
  docsSearchEnabled: boolean,
  docsSearchModuleId: string | undefined,
  docsEntryPath: string | undefined,
  docsAdapterReact: string | undefined,
  i18nConfig: ResolvedFarmConfig["i18n"] = {
    enabled: false,
    locales: ["en"],
    defaultLocale: "en",
    messages: "",
    routing: "none",
    detection: [],
    fallbackLocale: "en",
    strict: false,
    cookie: {
      name: "farm_locale",
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: false,
    },
    direction: {},
  },
  plugins: readonly FarmPlugin[] = [],
  renderer: FarmRenderer = REACT_RENDERER,
  publicRuntimeConfig: Record<string, unknown> | undefined = undefined,
): string {
  const toImportPath = (targetPath: string) => targetPath.replace(/\\/g, "/");
  const clientPluginEntry: FarmClientPluginEntryCode = generateFarmClientPluginEntryCode(
    plugins,
    root,
    srcDir,
    publicRuntimeConfig,
  );
  const rendererClientImports = isReactRenderer(renderer)
    ? `import React from "react";\nimport { createRoot, hydrateRoot } from "react-dom/client";`
    : `import React, { createRoot, hydrateRoot } from ${JSON.stringify(renderer.client)};`;

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
      `  { pattern: ${JSON.stringify(layout.pattern)}, Component: Layout${index}, shouldHydrate: ${JSON.stringify(layout.shouldHydrate)}, islandStrategy: ${JSON.stringify(layout.islandStrategy)} }`,
    );
  });

  const layoutImports = layoutImportStatements.join("\n");
  const i18nRoutingConfig = {
    locales: i18nConfig.locales,
    defaultLocale: i18nConfig.defaultLocale,
    routing: i18nConfig.routing,
  };
  const i18nClientRuntime = i18nConfig.enabled
    ? `
import { stripFarmLocaleFromPathname } from "@farm.js/core/i18n";
import { _setFarmI18nClientSnapshot } from "@farm.js/core/i18n/client";

const farmI18nConfig = ${JSON.stringify(i18nRoutingConfig)};
if (window.__FARM_I18N__) {
  _setFarmI18nClientSnapshot(window.__FARM_I18N__);
}

function getFarmRoutePathname(pathname) {
  return stripFarmLocaleFromPathname(pathname, farmI18nConfig);
}

function isFarmLocaleDocumentChange(doc) {
  const currentLocale = window.__FARM_I18N__?.locale || document.documentElement.lang;
  const nextLocale = doc.documentElement?.lang;
  return Boolean(currentLocale && nextLocale && currentLocale !== nextLocale);
}
`
    : `
function getFarmRoutePathname(pathname) {
  return pathname;
}

function isFarmLocaleDocumentChange() {
  return false;
}
`;
  const docsNavigationRuntime = docsEntryPath
    ? `
const farmDocsEntryPath = ${JSON.stringify(docsEntryPath)};
function isFarmDocsPath(pathname) {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\\/+$/, "") : pathname;
  return normalizedPath === farmDocsEntryPath || normalizedPath.startsWith(farmDocsEntryPath + "/");
}
`
    : `
function isFarmDocsPath() {
  return false;
}
`;
  const docsAdapterRuntime = docsAdapterReact
    ? `
import * as FarmDocsAdapterReact from ${JSON.stringify(docsAdapterReact)};

async function hydrateFarmDocsAdapterRuntime() {
  const runtime = window.__FARM_DOCS_ADAPTER__;
  if (!runtime) return false;
  if (typeof FarmDocsAdapterReact.hydrateFarmDocs !== "function") {
    throw new Error("The configured Farm docs adapter does not export hydrateFarmDocs().");
  }
  FarmDocsAdapterReact.hydrateFarmDocs({
    config: runtime.config || {},
    data: runtime.data,
  });
  return true;
}
`
    : `
async function hydrateFarmDocsAdapterRuntime() {
  return false;
}
`;

  if (clientPages.length === 0 && clientRouteSlots.length === 0) {
    // No client pages - just basic runtime with CSS and SPA navigation
    return `
// Farm.js Client Runtime (no client components)
${cssImport}
${layoutImports}
import { createClientPluginManager, installChunkErrorRecovery } from "@farm.js/core/internal/client-runtime";
${clientPluginEntry.imports}
${i18nClientRuntime}
${docsNavigationRuntime}
${docsAdapterRuntime}
${generateFarmDocsSearchClientRuntime(docsSearchEnabled, docsSearchModuleId)}

installChunkErrorRecovery();
mountFarmDocsSearch();

${generateUniversalRouterStateRuntime()}

// SPA Router for server-rendered pages (HTML swap)
const spaRouter = {
${generateUniversalRouterStateProperties()}
  prefetchCache: new Map(),
  
  navigate: async function(href, options = {}) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }
    if (isFarmDocsPath(url.pathname)) {
      window.location.href = href;
      return;
    }

    const action = options.action || (options.replace ? "replace" : "push");
    const to = url.pathname + url.search;
    if (!options.refresh && action !== "pop" && to === this.currentPath) {
      if (url.hash) window.location.hash = url.hash;
      return;
    }
    if (action === "pop" && to === this.currentPath) return;

    const from = this.currentPath;
    if (await this.shouldBlockNavigation({ from, to, action })) return;

    this.saveScrollPosition(window.location.pathname);
    this.startNavigation(from, url, action);
    let clientNavigation;
    try {
      clientNavigation = await farmClientRuntime.beginNavigation({
        from: action === "pop" ? null : window.location.href,
        to: url,
        action,
      });
      const html = await this.fetchPage(url.pathname + url.search, options.refresh === true);
      await farmClientRuntime.markNavigationLoaded(clientNavigation, html);
      await this.runViewTransition(options.viewTransition, async () => {
        if (!this.swapContent(html)) {
          throw new Error("Farm could not swap the target document");
        }
        const historyState = createHistoryState(
          url.pathname + url.search,
          options.state,
          window.history.state,
        );
        if (action === "replace") {
          window.history.replaceState(historyState, "", url);
        } else if (action !== "pop") {
          window.history.pushState(historyState, "", url);
        }
        if (options.scroll !== false) {
          if (url.hash) document.querySelector(url.hash)?.scrollIntoView();
          else window.scrollTo(0, 0);
        } else {
          this.restoreScrollPosition(url.pathname);
        }
      });
      await farmClientRuntime.resolveNavigation(clientNavigation);
      void farmClientRuntime.scheduleNavigationRendered(clientNavigation);
      this.currentPath = to;
      this.finishNavigation();
    } catch (error) {
      if (clientNavigation) {
        await farmClientRuntime.failNavigation(clientNavigation, error);
      }
      this.finishNavigation();
      console.error("[Farm.js] Navigation error:", error);
      if (action === "pop") window.location.reload();
      else window.location.href = href;
    }
  },

  refresh: function(options = {}) {
    return this.navigate(window.location.href, {
      ...options,
      action: "replace",
      replace: true,
      refresh: true,
      scroll: options.scroll === undefined ? false : options.scroll,
    });
  },
  
  fetchPage: async function(url, fresh = false) {
    if (fresh) this.prefetchCache.delete(url);
    const cached = fresh ? undefined : this.prefetchCache.get(url);
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
    if (isFarmLocaleDocumentChange(doc)) return false;
    if (doc.getElementById("nd-docs-layout")) return false;
    
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

  clearCache: function() {
    this.prefetchCache.clear();
  },
  
  observeForPrefetch: function(element) {
    if (!("IntersectionObserver" in window)) return;

    const href = element.getAttribute("href");
    if (!href) return;

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          spaRouter.prefetch(href);
          observer.disconnect();
          spaRouter.observers.delete(element);
        }
      });
    }, { rootMargin: "50px" });

    observer.observe(element);
    this.observers.set(element, observer);
  },

  unobserveForPrefetch: function(element) {
    const observer = this.observers.get(element);
    if (!observer) return;
    observer.unobserve(element);
    observer.disconnect();
    this.observers.delete(element);
  }
};

const farmClientRuntime = createClientPluginManager(
  ${clientPluginEntry.registrations},
  {
    router: spaRouter,
    isDev: false,
    isProd: true,
    deploymentId: window.__FARM_DEPLOYMENT_ID__,
  },
);
window.__FARM_CLIENT_RUNTIME__ = farmClientRuntime;
void farmClientRuntime.start();

// Expose router globally
window.__FARM_SPA_ROUTER__ = spaRouter;

void hydrateFarmDocsAdapterRuntime();

window.addEventListener("beforeunload", function(event) {
  if (spaRouter.blockers.size > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
  spaRouter.saveScrollPosition(window.location.pathname);
});

// Handle popstate (back/forward)
window.addEventListener("popstate", function() {
  if (document.documentElement.dataset.farmDocsRuntime === "true") return;
  void spaRouter.navigate(window.location.href, { action: "pop", scroll: false });
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
  const routeSlotEntries: string[] = [];

  clientPages.forEach((page) => {
    const load = page.pageShouldHydrate
      ? `() => import(${JSON.stringify(toImportPath(page.modulePath))}).then((module) => module.default)`
      : "null";
    routeEntries.push(`  {
    pattern: ${JSON.stringify(page.pattern)},
    pageShouldHydrate: ${JSON.stringify(page.pageShouldHydrate)},
    islandStrategy: ${JSON.stringify(page.islandStrategy)},
    navigation: "html-fragment",
    load: ${load},
  }`);
  });
  clientRouteSlots.forEach((slot, index) => {
    const importPath = toImportPath(slot.modulePath);
    imports.push(`import RouteSlot${index} from "${importPath}";`);
    routeSlotEntries.push(`  {
    name: ${JSON.stringify(slot.name)},
    ownerPattern: ${JSON.stringify(slot.ownerPattern)},
    pattern: ${JSON.stringify(slot.pattern)},
    containerId: ${JSON.stringify(slot.containerId)},
    interception: ${JSON.stringify(slot.interception)},
    fallback: ${JSON.stringify(slot.fallback)},
    Component: RouteSlot${index},
  }`);
  });

  // Full SPA client with hydration for client components
  return `
// Farm.js Client Runtime - SPA with Hydration
${cssImport}
${layoutImports}
${rendererClientImports}
import { createClientPluginManager, installChunkErrorRecovery, scheduleFarmIslandHydration } from "@farm.js/core/internal/client-runtime";
import { matchFarmRoute } from "@farm.js/core/router";
${clientPluginEntry.imports}
${i18nClientRuntime}
${docsNavigationRuntime}
${docsAdapterRuntime}

${imports.join("\n")}
${generateFarmDocsSearchClientRuntime(docsSearchEnabled, docsSearchModuleId)}

installChunkErrorRecovery();

// Client component routes
const clientRoutes = [
${routeEntries.join(",\n")}
];

const clientRouteSlots = [
${routeSlotEntries.join(",\n")}
];

// Layout routes for wrapping client components
const layoutRoutes = [
${layoutRegistrations.join(",\n")}
];

// Get applicable layouts for a pathname (sorted by depth, root first)
function getApplicableLayouts(pathname) {
  const applicable = [];
  const normalizedPath = getFarmRoutePathname(pathname).replace(/\\/$/, '') || '/';
  
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

function hasHydratableLayout(pathname) {
  return getApplicableLayouts(pathname).some(function(layout) {
    return layout.shouldHydrate === true;
  });
}

// Wrap a page element with applicable layouts
function wrapWithLayouts(pageElement, pathname, params) {
  const layouts = getApplicableLayouts(pathname);
  let wrapped = pageElement;
  
  // Wrap from innermost to outermost (reverse order since layouts are root-first)
  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i];
    const LayoutComponent = layout.Component;
    if (LayoutComponent) {
      wrapped = React.createElement(LayoutComponent, { children: wrapped, params: params });
      wrapped = React.createElement(
        "div",
        {
          "data-farm-layout-boundary": "true",
          "data-farm-layout-pattern": layout.pattern,
          style: { display: "contents" },
        },
        wrapped,
      );
    }
  }
  
  return wrapped;
}

function createLayoutPageBoundary(route, pageElement, serverHtml) {
  const props = {
    id: "__farm_page__",
    "data-farm-client": route.pageShouldHydrate ? "true" : "false",
    "data-farm-layout-client": "true",
    "data-farm-island": "page",
    "data-farm-island-strategy": route.islandStrategy || "load",
  };
  if (typeof serverHtml === "string") {
    props.suppressHydrationWarning = true;
    props.dangerouslySetInnerHTML = { __html: serverHtml };
    return React.createElement("div", props);
  }
  return React.createElement("div", props, pageElement);
}

// Match pathname to client route
function matchRoute(pathname) {
  pathname = getFarmRoutePathname(pathname);
  for (const route of clientRoutes) {
    const params = matchFarmRoute(route.pattern, pathname);
    if (params !== null) return { route: route, params: params };
  }
  return null;
}

async function loadRouteComponent(route) {
  if (!route.load) return null;
  if (route.Component) return route.Component;
  route.Component = await route.load();
  return route.Component;
}

async function createMatchedHydrationElement(matched, pathname, searchParams, serverHtml) {
  const hydrateLayouts = hasHydratableLayout(pathname);
  const params = matched.params;
  let pageElement = null;

  if (matched.route.pageShouldHydrate) {
    const Component = await loadRouteComponent(matched.route);
    if (!Component) return null;
    if (typeof Component === "function" && Component.constructor && Component.constructor.name === "AsyncFunction") {
      console.warn(
        "[Farm.js] Skipping hydration for " + pathname +
        ": async server components cannot run in the browser. Server-rendered HTML is preserved."
      );
      return null;
    }
    const props = { params: params, searchParams: Promise.resolve(searchParams) };
    pageElement = React.createElement(Component, props);
  } else if (hydrateLayouts) {
    const serverPage = document.getElementById("__farm_page__");
    pageElement = createLayoutPageBoundary(
      matched.route,
      null,
      typeof serverHtml === "string" ? serverHtml : serverPage ? serverPage.innerHTML : "",
    );
  }

  if (!pageElement) return null;
  if (!hydrateLayouts) return pageElement;
  if (matched.route.pageShouldHydrate) {
    pageElement = createLayoutPageBoundary(matched.route, pageElement);
  }
  return wrapWithLayouts(pageElement, pathname, params);
}

function matchesRoutePrefix(pathname, pattern) {
  if (pattern === "/") return true;
  const pathSegments = getFarmRoutePathname(pathname).split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);
  if (patternSegments.length > pathSegments.length) return false;
  const candidate = "/" + pathSegments.slice(0, patternSegments.length).join("/");
  return matchFarmRoute(pattern, candidate) !== null;
}

function matchInterceptedRouteSlot(pathname, from) {
  for (const slot of clientRouteSlots) {
    if (!slot.interception || !matchesRoutePrefix(from, slot.ownerPattern)) continue;
    const params = matchFarmRoute(slot.pattern, getFarmRoutePathname(pathname));
    if (params !== null) return { slot: slot, params: params };
  }
  return null;
}

function routeSlotKey(slot) {
  return slot.ownerPattern + ":" + slot.name;
}

function findClientRouteSlot(slot) {
  return clientRouteSlots.find(function(candidate) {
    return candidate.name === slot.name &&
      candidate.ownerPattern === slot.ownerPattern &&
      candidate.pattern === slot.pattern &&
      candidate.interception === slot.interception &&
      candidate.fallback === slot.fallback;
  });
}

function readRouteSlotPayload(doc) {
  const script = doc.getElementById("__farm_route_slots_data__");
  if (!script?.textContent) return [];
  try {
    const parsed = JSON.parse(script.textContent);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const routeSlotRoots = new Map();
let activeRouteInterception = null;

function resetRouteSlotRoots() {
  for (const root of routeSlotRoots.values()) {
    try { root.unmount(); } catch {}
  }
  routeSlotRoots.clear();
  activeRouteInterception = null;
}

function renderClientRouteSlot(slot, registration, mode) {
  const container = document.getElementById(slot.containerId);
  if (!container || !registration?.Component) return false;
  const key = routeSlotKey(slot);
  const existingRoot = routeSlotRoots.get(key);
  const props = slot.props && typeof slot.props === "object" ? slot.props : {};
  const element = React.createElement(registration.Component, props);

  if (mode === "hydrate") {
    if (existingRoot) return true;
    const root = hydrateRoot(container, element);
    routeSlotRoots.set(key, root);
    return true;
  }

  if (existingRoot) {
    try { existingRoot.unmount(); } catch {}
    routeSlotRoots.delete(key);
  } else {
    container.replaceChildren();
  }
  const root = createRoot(container);
  root.render(element);
  routeSlotRoots.set(key, root);
  return true;
}

function hydrateInitialRouteSlots() {
  const slots = Array.isArray(window.__FARM_ROUTE_SLOTS__)
    ? window.__FARM_ROUTE_SLOTS__
    : [];
  for (const slot of slots) {
    const registration = findClientRouteSlot(slot);
    if (!registration) continue;
    try {
      renderClientRouteSlot(slot, registration, "hydrate");
    } catch (error) {
      console.warn("[Farm.js] Could not hydrate route slot:", slot.name, error);
    }
  }
}

function renderRouteInterception(slot, registration, from) {
  const container = document.getElementById(slot.containerId);
  if (!container) return false;
  const key = routeSlotKey(slot);
  const previousSlot = (window.__FARM_ROUTE_SLOTS__ || []).find(function(candidate) {
    return routeSlotKey(candidate) === key;
  }) || null;
  const previousHtml = container.innerHTML;

  if (!renderClientRouteSlot(slot, registration, "render")) return false;
  activeRouteInterception = {
    from: from,
    key: key,
    slot: slot,
    previousSlot: previousSlot,
    previousHtml: previousHtml,
  };
  return true;
}

function clearRouteInterception(destination) {
  if (!activeRouteInterception) return false;
  const active = activeRouteInterception;
  activeRouteInterception = null;
  const root = routeSlotRoots.get(active.key);
  if (root) {
    try { root.unmount(); } catch {}
    routeSlotRoots.delete(active.key);
  }
  const container = document.getElementById(active.slot.containerId);
  if (container) {
    container.innerHTML = active.previousHtml;
    if (active.previousSlot) {
      const registration = findClientRouteSlot(active.previousSlot);
      if (registration) {
        try {
          renderClientRouteSlot(active.previousSlot, registration, "hydrate");
        } catch {}
      }
    }
  }
  return destination === active.from;
}

// State
let reactRoot = null;
let reactRootContainer = null;
let currentPathname = null;
let isHydrated = false;
let pendingPageHydrationController = null;

${generateUniversalRouterStateRuntime()}

function cancelPendingPageHydration() {
  pendingPageHydrationController?.abort();
  pendingPageHydrationController = null;
}

function resetReactRoot() {
  cancelPendingPageHydration();
  if (!reactRoot) return;
  reactRoot.unmount();
  reactRoot = null;
  reactRootContainer = null;
  isHydrated = false;
}

// Hydrate client components
async function hydrate() {
  if (await hydrateFarmDocsAdapterRuntime()) {
    return;
  }

  const pathname = window.location.pathname;
  const matched = matchRoute(pathname);
  hydrateInitialRouteSlots();

  if (!matched) {
    return;
  }
  
  const rootContainer = document.getElementById("root");
  const container = hasHydratableLayout(pathname)
    ? rootContainer
    : document.getElementById("__farm_page__") || rootContainer;
  if (!container) {
    console.error("[Farm.js] No root element found");
    return;
  }
  
  container.dataset.farmIsland = "page";
  container.dataset.farmIslandStrategy = matched.route.islandStrategy || "load";

  const hydrationController = new AbortController();
  pendingPageHydrationController = hydrationController;
  try {
    await scheduleFarmIslandHydration({
      container,
      strategy: matched.route.islandStrategy,
      signal: hydrationController.signal,
      hydrate: async function() {
        if (
          hydrationController.signal.aborted ||
          !container.isConnected ||
          window.location.pathname !== pathname
        ) {
          return;
        }
        const searchParams = Object.fromEntries(new URLSearchParams(window.location.search));
        const wrappedElement = await createMatchedHydrationElement(
          matched,
          pathname,
          searchParams,
        );
        if (!wrappedElement) return;
        const shouldHydrate = !isHydrated && Boolean(container.innerHTML.trim());
        const hydrationSession = await farmClientRuntime.beginHydration({
          container,
          mode: shouldHydrate ? "hydrate" : "render",
        });

        try {
          if (hydrationController.signal.aborted || !container.isConnected) {
            await farmClientRuntime.failHydration(
              hydrationSession,
              new DOMException("Route hydration was cancelled", "AbortError"),
            );
            return;
          }
          if (shouldHydrate) {
            reactRoot = hydrateRoot(container, wrappedElement);
            reactRootContainer = container;
            isHydrated = true;
          } else {
            if (!reactRoot) {
              reactRoot = createRoot(container);
              reactRootContainer = container;
            }
            reactRoot.render(wrappedElement);
          }
          currentPathname = pathname;
          await farmClientRuntime.completeHydration(hydrationSession);
        } catch (error) {
          await farmClientRuntime.failHydration(hydrationSession, error);
          console.error("[Farm.js] Hydration error:", error);
        }
      },
    });
  } finally {
    if (pendingPageHydrationController === hydrationController) {
      pendingPageHydrationController = null;
    }
  }
}

function findLayoutBoundary(root, pattern) {
  const boundaries = root?.querySelectorAll?.('[data-farm-layout-boundary="true"]') || [];
  for (const boundary of boundaries) {
    if (boundary.getAttribute("data-farm-layout-pattern") === pattern) return boundary;
  }
  return null;
}

function getLayoutPatterns(root) {
  return Array.from(root?.querySelectorAll?.('[data-farm-layout-boundary="true"]') || [])
    .map(function(element) { return element.getAttribute("data-farm-layout-pattern"); })
    .filter(Boolean);
}

function activateNavigationScripts(root) {
  for (const script of Array.from(root?.querySelectorAll?.("script") || [])) {
    const freshScript = document.createElement("script");
    for (const attribute of Array.from(script.attributes)) {
      freshScript.setAttribute(attribute.name, attribute.value);
    }
    freshScript.textContent = script.textContent || "";
    script.replaceWith(freshScript);
  }
}

function replaceSharedLayoutBoundary(currentRoot, nextRoot) {
  const currentPatterns = getLayoutPatterns(currentRoot);
  const nextPatterns = getLayoutPatterns(nextRoot);
  let sharedCount = 0;
  while (
    sharedCount < currentPatterns.length &&
    sharedCount < nextPatterns.length &&
    currentPatterns[sharedCount] === nextPatterns[sharedCount]
  ) sharedCount++;

  const nextTreeRoot = nextPatterns.length
    ? findLayoutBoundary(nextRoot, nextPatterns[0])
    : nextRoot.querySelector("#__farm_page__");
  const currentTarget = sharedCount < currentPatterns.length
    ? findLayoutBoundary(currentRoot, currentPatterns[sharedCount])
    : currentRoot.querySelector("#__farm_page__");
  const nextTarget = sharedCount < nextPatterns.length
    ? findLayoutBoundary(nextRoot, nextPatterns[sharedCount])
    : nextRoot.querySelector("#__farm_page__");

  if (!currentTarget || !nextTarget) return false;
  currentTarget.replaceWith(nextTarget);
  activateNavigationScripts(nextTarget);
  if (nextTreeRoot && nextTreeRoot !== nextTarget) nextTreeRoot.remove();

  if (nextRoot.childNodes.length) {
    const support = document.createElement("div");
    support.hidden = true;
    support.dataset.farmFragmentSupport = "true";
    while (nextRoot.firstChild) support.appendChild(nextRoot.firstChild);
    document.body.appendChild(support);
    activateNavigationScripts(support);
    setTimeout(function() { support.remove(); }, 0);
  }
  return true;
}

// SPA Router
const spaRouter = {
${generateUniversalRouterStateProperties()}
  prefetchCache: new Map(),
  
  navigate: async function(href, options = {}) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }
    if (isFarmDocsPath(url.pathname)) {
      window.location.href = href;
      return;
    }

    const action = options.action || (options.replace ? "replace" : "push");
    const to = url.pathname + url.search;
    if (action !== "pop" && to === this.currentPath) {
      if (url.hash) window.location.hash = url.hash;
      return;
    }
    if (action === "pop" && to === this.currentPath) return;
    
    const pathname = url.pathname;
    const matched = matchRoute(pathname);
    const from = this.currentPath;
    if (await this.shouldBlockNavigation({ from, to, action })) return;

    // A route transition invalidates any trigger waiting on the previous DOM boundary.
    cancelPendingPageHydration();
    this.saveScrollPosition(window.location.pathname);
    this.startNavigation(from, url, action);
    let clientNavigation;

    try {
      clientNavigation = await farmClientRuntime.beginNavigation({
        from: action === "pop" ? null : window.location.href,
        to: url,
        action,
        route: matched
          ? { pattern: matched.route.pattern, params: matched.params }
          : undefined,
      });

      if (activeRouteInterception && clearRouteInterception(to)) {
        await farmClientRuntime.markNavigationLoaded(clientNavigation, {
          routeSlots: "restored",
        });
        await farmClientRuntime.resolveNavigation(clientNavigation);
        void farmClientRuntime.scheduleNavigationRendered(clientNavigation);
        this.currentPath = to;
        this.finishNavigation();
        return;
      }
      if (activeRouteInterception) {
        clearRouteInterception(to);
      }

      const intercepted = matchInterceptedRouteSlot(pathname, from);
      if (intercepted) {
        const html = await this.fetchPage(to, from);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const slotPayload = readRouteSlotPayload(doc);
        const selectedSlot = slotPayload.find(function(slot) {
          return slot.interception &&
            slot.name === intercepted.slot.name &&
            slot.ownerPattern === intercepted.slot.ownerPattern;
        });

        if (
          selectedSlot &&
          renderRouteInterception(selectedSlot, intercepted.slot, from)
        ) {
          await farmClientRuntime.markNavigationLoaded(clientNavigation, {
            route: intercepted.slot.pattern,
            params: intercepted.params,
          });
          const historyState = createHistoryState(
            to,
            options.state,
            window.history.state,
          );
          if (action === "replace") {
            window.history.replaceState(historyState, "", url);
          } else if (action !== "pop") {
            window.history.pushState(historyState, "", url);
          }
          await farmClientRuntime.resolveNavigation(clientNavigation);
          void farmClientRuntime.scheduleNavigationRendered(clientNavigation);
          this.currentPath = to;
          this.finishNavigation();
          return;
        }
      }

      if (matched?.route.navigation === "client-render") {
        // Navigation itself signals intent, so destination routes load eagerly even
        // when their initial document hydration strategy is deferred.
        const Component = await loadRouteComponent(matched.route);
        const params = matched.params;
        const searchParams = Object.fromEntries(url.searchParams);
        const props = { params: params, searchParams: Promise.resolve(searchParams) };
        let pageElement = React.createElement(Component, props);
        if (hasHydratableLayout(pathname)) {
          pageElement = createLayoutPageBoundary(matched.route, pageElement);
        }
        const wrappedElement = wrapWithLayouts(pageElement, pathname, params);

        await farmClientRuntime.markNavigationLoaded(clientNavigation, {
          route: matched.route.pattern,
          params,
        });

        await this.runViewTransition(options.viewTransition, async () => {
          const historyState = createHistoryState(
            url.pathname + url.search,
            options.state,
            window.history.state,
          );
          if (action === "replace") {
            window.history.replaceState(historyState, "", url);
          } else if (action !== "pop") {
            window.history.pushState(historyState, "", url);
          }

          const container = document.getElementById("root");
          if (container) {
            if (reactRoot && reactRootContainer !== container) resetReactRoot();
            if (!reactRoot) {
              reactRoot = createRoot(container);
              reactRootContainer = container;
            }
            reactRoot.render(wrappedElement);
            currentPathname = pathname;
          }
        });
      } else {
        const html = await this.fetchPage(url.pathname + url.search);
        await farmClientRuntime.markNavigationLoaded(clientNavigation, html);
        await this.runViewTransition(options.viewTransition, async () => {
          if (!(await this.swapContent(html, url.pathname + url.search))) {
            throw new Error("Farm could not swap the target document");
          }
          const historyState = createHistoryState(
            url.pathname + url.search,
            options.state,
            window.history.state,
          );
          if (action === "replace") {
            window.history.replaceState(historyState, "", url);
          } else if (action !== "pop") {
            window.history.pushState(historyState, "", url);
          }
          currentPathname = pathname;
        });
      }

      if (options.scroll !== false) {
        if (url.hash) document.querySelector(url.hash)?.scrollIntoView();
        else window.scrollTo(0, 0);
      } else {
        this.restoreScrollPosition(url.pathname);
      }
      await farmClientRuntime.resolveNavigation(clientNavigation);
      void farmClientRuntime.scheduleNavigationRendered(clientNavigation);
      this.currentPath = to;
      this.finishNavigation();
    } catch (error) {
      if (clientNavigation) {
        await farmClientRuntime.failNavigation(clientNavigation, error);
      }
      this.finishNavigation();
      console.error("[Farm.js] Navigation error:", error);
      if (action === "pop") window.location.reload();
      else window.location.href = href;
    }
  },
  
  fetchPage: async function(url, interceptFrom) {
    const cacheKey = interceptFrom ? url + "\\nintercept:" + interceptFrom : url;
    const cached = this.prefetchCache.get(cacheKey);
    if (cached) return cached;
    
    const response = await fetch(url, {
      headers: {
        "Accept": "text/html",
        ...(interceptFrom ? { "X-Farm-Intercept-From": interceptFrom } : {}),
      }
    });
    if (!response.ok) throw new Error("Failed to fetch page");
    const html = await response.text();
    this.prefetchCache.set(cacheKey, html);
    return html;
  },
  
  swapContent: async function(html, targetPath) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    if (isFarmLocaleDocumentChange(doc)) return false;
    if (doc.getElementById("nd-docs-layout")) return false;
    const nextRouteSlots = readRouteSlotPayload(doc);
    
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
    const targetUrl = new URL(targetPath || window.location.href, window.location.origin);
    const newPathname = targetUrl.pathname;
    const matched = matchRoute(newPathname);
    const hydrateLayouts = hasHydratableLayout(newPathname);
    const nextPage = newRoot.querySelector("#__farm_page__");

    // If React already owns the shared layout, update that root. React keeps
    // matching layout component instances and their state mounted.
    if (matched && hydrateLayouts && reactRoot && reactRootContainer === currentRoot) {
      const searchParams = Object.fromEntries(targetUrl.searchParams);
      const wrappedElement = await createMatchedHydrationElement(
        matched,
        newPathname,
        searchParams,
        nextPage ? nextPage.innerHTML : "",
      );
      if (wrappedElement) {
        reactRoot.render(wrappedElement);
        window.__FARM_ROUTE_SLOTS__ = nextRouteSlots;
        isHydrated = true;
        return true;
      }
    }

    const rootWasReactOwned = reactRootContainer === currentRoot;
    resetReactRoot();
    resetRouteSlotRoots();
    if (rootWasReactOwned || !replaceSharedLayoutBoundary(currentRoot, newRoot)) {
      currentRoot.innerHTML = newRoot.innerHTML;
      activateNavigationScripts(currentRoot);
    }
    window.__FARM_ROUTE_SLOTS__ = nextRouteSlots;
    hydrateInitialRouteSlots();

    // Check if the new HTML contains an interactive route boundary.
    if (matched) {
      const searchParams = Object.fromEntries(targetUrl.searchParams);
      const pageContainer =
        hydrateLayouts ? currentRoot : document.getElementById("__farm_page__") || currentRoot;
      const wrappedElement = await createMatchedHydrationElement(
        matched,
        newPathname,
        searchParams,
      );
      if (wrappedElement) {
        reactRoot = hydrateRoot(pageContainer, wrappedElement);
        reactRootContainer = pageContainer;
        isHydrated = true;
      }
    }
    return true;
  },

  swapDocument: function(doc) {
    if (!doc.documentElement || !doc.body) return false;

    resetReactRoot();
    resetRouteSlotRoots();

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
    const interceptFrom = this.currentPath;
    const cacheKey = pathname + "\\nintercept:" + interceptFrom;
    if (this.prefetchCache.has(cacheKey)) return;
    
    this.fetchPage(pathname, interceptFrom)
      .then(function(html) { spaRouter.prefetchCache.set(cacheKey, html); })
      .catch(function() {});
  },
  
  observeForPrefetch: function(element) {
    if (!("IntersectionObserver" in window)) return;

    const href = element.getAttribute("href");
    if (!href) return;

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          spaRouter.prefetch(href);
          observer.disconnect();
          spaRouter.observers.delete(element);
        }
      });
    }, { rootMargin: "50px" });

    observer.observe(element);
    this.observers.set(element, observer);
  },

  unobserveForPrefetch: function(element) {
    const observer = this.observers.get(element);
    if (!observer) return;
    observer.unobserve(element);
    observer.disconnect();
    this.observers.delete(element);
  }
};

const farmClientRuntime = createClientPluginManager(
  ${clientPluginEntry.registrations},
  {
    router: spaRouter,
    isDev: false,
    isProd: true,
    deploymentId: window.__FARM_DEPLOYMENT_ID__,
  },
);
window.__FARM_CLIENT_RUNTIME__ = farmClientRuntime;
void farmClientRuntime.start();

// Expose router globally
window.__FARM_SPA_ROUTER__ = spaRouter;

window.addEventListener("beforeunload", function(event) {
  if (spaRouter.blockers.size > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
  spaRouter.saveScrollPosition(window.location.pathname);
});

// Handle popstate (back/forward)
window.addEventListener("popstate", function() {
  if (document.documentElement.dataset.farmDocsRuntime === "true") return;
  void spaRouter.navigate(window.location.href, { action: "pop", scroll: false });
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
}
void hydrate();
`.trim();
}

/**
 * Build SSR bundle in memory (write: false)
 * Creates a virtual entry that bundles all API routes and page routes
 * Managers are created at runtime from the bundled code
 */
async function buildSSRInMemory(
  productionVite: FarmProductionViteRuntime,
  config: ResolvedFarmConfig,
  root: string,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
  preset: string,
  collectedPageRoutes: readonly UniversalPageRoute[],
  collectedLayoutRoutes: ReadonlyArray<{ pattern: string; modulePath: string }>,
  collectedRouteSlots: readonly UniversalRouteSlot[],
): Promise<{
  bundle: OutputBundle;
  entryFile: string;
  configuredHeaderRoutes: UniversalConfiguredHeaderRoute[];
}> {
  const viteBuild = productionVite.build;
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
  let tailwindVitePlugin: any = undefined;
  const rendererVitePlugins = await loadFarmRendererVitePlugins(config.renderer, root, {
    ssr: true,
  });
  if (!hasScopedPostcssConfig) {
    postcssConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-postcss-"));
    await fs.writeFile(
      path.join(postcssConfigDir, "postcss.config.cjs"),
      "module.exports = { plugins: [] };\n",
    );
    try {
      const tailwindVite = (await import("@tailwindcss/vite")).default;
      tailwindVitePlugin = adaptTailwindVitePlugin(tailwindVite(), productionVite.builder);
    } catch (error) {
      logger.warn(
        `Tailwind plugin auto-enable failed for SSR; continuing without it: ${(error as Error).message}`,
      );
    }
  }

  let ssrBundle: OutputBundle;
  let ssrEntryFile: string;

  // Reuse the route and layout manifests already collected for the parallel
  // client build instead of rescanning the same project tree.
  const pageRoutes = collectedPageRoutes.map((route) => ({ ...route }));
  const layoutRoutes = collectedLayoutRoutes.map((route) => ({ ...route }));
  const routeSlots = collectedRouteSlots.map((slot) => ({ ...slot }));

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
  const apiRoutes: Array<{
    path: string;
    filePath: string;
    methods: string[];
  }> = [];
  for (const [routePath, route] of apiRouteManager.getRoutes()) {
    apiRoutes.push({
      path: routePath,
      filePath: route.filePath,
      methods: route.methods,
    });
  }
  const [configuredRedirects, configuredRewrites, configuredHeaderRoutes] = await Promise.all([
    config.redirects(),
    config.rewrites(),
    config.headers(),
  ]);
  const redirectRoutes: ProgrammaticRedirectRoute[] = [
    ...routeManager.getRedirects(),
    ...configuredRedirects.map((redirect: RedirectConfig) => ({
      source: redirect.source,
      destination: redirect.destination,
      permanent: redirect.permanent,
      statusCode: redirect.statusCode,
    })),
  ];
  const errorRoutes: UniversalBoundaryRoute[] = Array.from(
    routeManager.getErrors().values(),
    (entry) => ({
      pattern: entry.pattern,
      modulePath: entry.modulePath,
    }),
  );
  const i18nCatalogs = config.i18n.enabled
    ? (await readFarmI18nCatalogs(config.i18n)).catalogs
    : {};

  const appDirs = getFarmAppDirectories(config);
  const middlewareRoutes = await discoverMiddlewareRoutes(appDirs);
  const instrumentationPath = resolveFarmInstrumentationFile(root, config.srcDir || "src");

  // Check for custom not-found page
  let notFoundPath: string | null = null;
  const notFoundExtensions = getFarmRendererComponentExtensions(config.renderer);
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

  const configuredIntegrationValues = Object.values(config.integrations || {});
  const hasAnyConfiguredIntegrations = configuredIntegrationValues.some(
    (integration) => typeof integration === "object" && integration !== null,
  );
  const hasServerRuntimeIntegrations = configuredIntegrationValues.some(
    (integration) =>
      typeof integration === "object" &&
      integration !== null &&
      (!("serverRuntime" in integration) || integration.serverRuntime !== false),
  );
  const hasObservabilityHandler =
    !!config.observability &&
    typeof config.observability === "object" &&
    "onEvent" in config.observability;
  const hasMdxComponentConfig = Boolean(config.mdx?.components);
  const hasMiddlewareConfig = hasFarmMiddlewareConfig(config.middleware);
  const hasRouteContextConfig = hasCustomFarmRouteContext(config);
  const hasServerRuntimePlugins = hasFarmServerRuntimePlugins(config);
  const configModulePath =
    hasServerRuntimeIntegrations ||
    hasObservabilityHandler ||
    hasMdxComponentConfig ||
    hasMiddlewareConfig ||
    hasRouteContextConfig ||
    hasServerRuntimePlugins
      ? await findFarmConfigPath(root)
      : null;
  const hasRuntimeConfigModule = hasFarmRuntimeConfigModule(config, configModulePath);
  const hasRuntimeIntegrationConfig = hasRuntimeConfigModule && hasAnyConfiguredIntegrations;
  const hasConfiguredRuntimePlugins = Boolean(
    hasRuntimeConfigModule && (config.plugins || []).length > 0,
  );

  // Generate virtual entry code that imports and bundles all routes
  // This ensures all route handlers are captured in the bundle closure
  const virtualEntryCode = generateVirtualEntryCode(
    apiRoutes,
    pageRoutes,
    layoutRoutes,
    routeSlots,
    errorRoutes,
    metadataImageRoutes,
    middlewareRoutes,
    redirectRoutes,
    configuredRewrites,
    configuredHeaderRoutes,
    notFoundPath,
    instrumentationPath,
    config,
    configModulePath,
    hasServerRuntimeIntegrations,
    hasRuntimeIntegrationConfig,
    hasConfiguredRuntimePlugins,
    preset,
    i18nCatalogs,
  );

  // Find a temporary file path for the virtual entry
  // We'll use a plugin to intercept this
  const virtualEntryId = "\0virtual:farm-ssr-entry";
  const useExternalMetadataImageRuntime = shouldUseExternalMetadataImageRuntime(
    preset,
    metadataImageRoutes.some((image) => image.sourceType === "module"),
  );
  const rendererOptionalExternals = isReactRenderer(config.renderer)
    ? []
    : [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/client",
        "react-dom/server",
      ];

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
            ...rendererOptionalExternals,
            ...(useExternalMetadataImageRuntime ? ["@vercel/og"] : []),
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
        // Adapters can render provider scripts by serializing function source.
        // keepNames injects helper calls into those functions; after Nitro
        // minifies the server chunk the helper is no longer in script scope.
        keepNames: !(config.docs?.enabled && config.docs.adapter?.server),
        jsxDev: false,
      },
      // SSR configuration to externalize problematic modules
      ssr: {
        // Externalize native modules and build tools that can't be bundled
        // These have native binaries that won't work in serverless environments
        external: [
          "fsevents",
          "sharp",
          ...rendererOptionalExternals,
          ...(useExternalMetadataImageRuntime ? ["@vercel/og"] : []),
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
          "vite-rolldown",
          "nitro",
          "nitropack",
          "@prisma/client",
          "@prisma/client/default",
          "@prisma/client/default.js",
          ".prisma/client",
          ".prisma/client/default",
        ],
        // Node deployments must bundle application dependencies with Farm's
        // React runtime. Leaving a React component package external can make it
        // resolve a second React instance at runtime and break hooks during SSR.
        // Native and build-only packages above remain explicitly external.
        noExternal:
          preset === "cloudflare-module"
            ? [
                "@farm.js/core",
                "@farm.js/core/image",
                "better-call",
                ...(metadataImageRoutes.some((image) => image.sourceType === "module")
                  ? ["@vercel/og"]
                  : []),
              ]
            : true,
      },
      define: {
        __FARM_API_BASE_URL__: JSON.stringify(config.api.baseURL),
        __FARM_ENV__: JSON.stringify(config.env || { server: {}, public: {} }),
        __FARM_PUBLIC_ENV__: JSON.stringify(config.env?.public || {}),
      },
      plugins: [
        createFarmThemeCssPlugin(config.theme, config.basePath),
        ...(tailwindVitePlugin ? [tailwindVitePlugin] : []),
        ...(rendererVitePlugins as any[]),
        ...(config.vite.plugins || []),
        ...(!useExternalMetadataImageRuntime &&
        metadataImageRoutes.some((image) => image.sourceType === "module")
          ? [createMetadataImageWasmPlugin()]
          : []),
        {
          name: "farm-react-production-mode",
          enforce: "pre",
          transform(code, id) {
            const normalizedId = id.replace(/\\/g, "/");
            const isReactRuntime =
              normalizedId.includes("/node_modules/react/") ||
              normalizedId.includes("/node_modules/react-dom/");
            const nodeEnvExpression = ["process", "env", "NODE_ENV"].join(".");

            if (!isReactRuntime || !code.includes(nodeEnvExpression)) return null;

            return {
              code: code.split(nodeEnvExpression).join('"production"'),
              map: null,
            };
          },
        },
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
        alias: createFarmSourceAlias(root, config.srcDir),
        // Route modules and the renderer adapter must share one runtime instance.
        dedupe: [...(config.renderer.dedupe || [])],
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

  return {
    bundle: ssrBundle!,
    entryFile: ssrEntryFile!,
    configuredHeaderRoutes,
  };
}

/**
 * Generate virtual entry code that bundles all routes
 * This creates managers at runtime from bundled code
 */
function generateVirtualEntryCode(
  apiRoutes: Array<{ path: string; filePath: string; methods: string[] }>,
  pageRoutes: UniversalPageRoute[],
  layoutRoutes: Array<{ pattern: string; modulePath: string }>,
  routeSlots: UniversalRouteSlot[],
  errorRoutes: UniversalBoundaryRoute[],
  metadataImageRoutes: UniversalMetadataImageRoute[],
  middlewareRoutes: UniversalMiddlewareRoute[],
  redirectRoutes: ProgrammaticRedirectRoute[],
  configuredRewriteRoutes: RewriteConfig[],
  configuredHeaderRoutes: UniversalConfiguredHeaderRoute[],
  notFoundPath: string | null,
  instrumentationPath: string | null,
  config: ResolvedFarmConfig,
  configModulePath: string | null,
  hasServerRuntimeIntegrations: boolean,
  hasRuntimeIntegrationConfig: boolean,
  hasConfiguredRuntimePlugins: boolean,
  preset: string,
  i18nCatalogs: FarmI18nCatalogs,
): string {
  const hasPluginRuntime = hasRuntimeIntegrationConfig || hasConfiguredRuntimePlugins;
  const adapterOwnsDocsRuntime = Boolean(
    isReactRenderer(config.renderer) &&
    config.docs?.enabled &&
    config.docs.adapter?.server &&
    config.docs.adapter.react,
  );
  const rendererServerImports = isReactRenderer(config.renderer)
    ? `import * as React from "react";\nimport * as ReactDOMServer from "react-dom/server";`
    : `import React, * as ReactDOMServer from ${JSON.stringify(config.renderer.server)};`;
  const hasGeneratedMetadataImages = metadataImageRoutes.some(
    (image) => image.sourceType === "module",
  );
  const hasMiddlewareRuntime =
    middlewareRoutes.length > 0 || hasFarmMiddlewareConfig(config.middleware);
  const farmDocsBaseConfig = config.docs?.enabled
    ? { ...config.docs, config: undefined }
    : undefined;
  const farmDocsFontAssets = config.docs?.enabled
    ? toFarmDocsPublicFontAssets(resolveFarmDocsFontAssets(config.root))
    : [];

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
  const hasMarkdownPages = pageRoutes.some((route) => route.source !== undefined);
  const orderedPageRoutes = pageRoutes
    .map((route, index) => ({ route, index }))
    .sort(
      (left, right) =>
        routePatternSpecificity(right.route.pattern) -
          routePatternSpecificity(left.route.pattern) || left.index - right.index,
    )
    .map(({ route }) => route);

  orderedPageRoutes.forEach((route, index) => {
    const varName = `pageRoute${index}`;
    if (isFarmMarkdownPageFile(route.modulePath)) {
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
      filePath: ${JSON.stringify(route.markdownSourcePath ?? route.modulePath)},
    },
  }`);
      return;
    }

    pageImports.push(`import * as ${varName} from "${route.modulePath}";`);
    const clientMetadata = getClientModuleMetadata(route.modulePath, config.root);
    pageRegistrations.push(`
  {
    pattern: ${JSON.stringify(route.pattern)},
    module: ${varName},
    shouldHydrate: ${JSON.stringify(clientMetadata.shouldHydrate)},
    islandStrategy: ${JSON.stringify(clientMetadata.islandStrategy)},
    ${
      route.source !== undefined
        ? `markdownSource: {
      source: ${JSON.stringify(route.source)},
      filePath: ${JSON.stringify(route.markdownSourcePath)},
    },`
        : ""
    }
  }`);
  });

  // Generate imports for all layouts
  const layoutImports: string[] = [];
  const layoutRegistrations: string[] = [];

  layoutRoutes.forEach((layout, index) => {
    const varName = `layoutRoute${index}`;
    const clientMetadata = getClientModuleMetadata(layout.modulePath, config.root);
    layoutImports.push(`import * as ${varName} from "${layout.modulePath}";`);
    layoutRegistrations.push(`
  {
    pattern: ${JSON.stringify(layout.pattern)},
    module: ${varName},
    shouldHydrate: ${JSON.stringify(clientMetadata.shouldHydrate)},
    islandStrategy: ${JSON.stringify(clientMetadata.islandStrategy)},
  }`);
  });

  const routeSlotImports: string[] = [];
  const routeSlotRegistrations: string[] = [];
  routeSlots.forEach((slot, index) => {
    const varName = `routeSlot${index}`;
    routeSlotImports.push(`import * as ${varName} from "${slot.modulePath}";`);
    routeSlotRegistrations.push(`
  {
    name: ${JSON.stringify(slot.name)},
    ownerPattern: ${JSON.stringify(slot.ownerPattern)},
    pattern: ${JSON.stringify(slot.pattern)},
    containerId: ${JSON.stringify(slot.containerId)},
    interception: ${JSON.stringify(slot.interception)},
    fallback: ${JSON.stringify(slot.fallback)},
    module: ${varName},
  }`);
  });

  // Generate imports for route-level error boundaries.
  const errorImports: string[] = [];
  const errorRegistrations: string[] = [];

  errorRoutes.forEach((errorRoute, index) => {
    const varName = `errorRoute${index}`;
    errorImports.push(`import * as ${varName} from "${errorRoute.modulePath}";`);
    errorRegistrations.push(`
  {
    pattern: ${JSON.stringify(errorRoute.pattern)},
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
      ? `import { invokeAPIRouteEndpoint, matchAPIRoute } from "@farm.js/core/api/runtime";`
      : "";
  const productionRuntimeImport = `import {
  _runWithAfterRequest,
  _runWithCurrentRequest,
  _runWithMiddlewareContext,
  _runWithMiddlewareData,
  _setDefaultFarmThemeConfig,
  addMetadataImageReference,
  applyFarmThemeDocument,
  appendFarmLinkHeader,
  applyProductionMiddlewareHeaders,
  configureFarmCache,
  configureFarmObservability,
  createDefaultErrorMarkup,
  createFarmInstrumentationLifecycle,
  createFarmCacheKey,
  createFarmThemeDocumentParts,
  createFarmLocaleCookie,
  createFarmProductionLifecycle,
  createProductionMiddlewareRunner,
  getTheme as getFarmTheme,
  emitFarmEvent,
  getFarmDataCache,
  getFarmLocaleVaryHeaders,
  getFarmRedirectError,
  getDefaultErrorStatusText,
  isFarmNotFoundError,
  isFarmRedirectError,
  localizeFarmHref,
  localizeFarmPathname,
  manageFarmDocumentPreloads,
  manageFarmLinkHeaderPreloads,
  mergeMetadata,
  normalizeRevalidatePath,
  reportFarmPreloadWarnings,
  renderMetadataHead,
  resolveFarmRouteContext,
  resolveDefaultErrorStatus,
  resolveFarmInstrumentationRuntime,
  runWithFarmRequestSpan,
  stripFarmLocaleFromPathname,
  withFarmRouteContext,
} from "@farm.js/core/internal/production-runtime";`;
  const metadataImageRuntimeImport = hasGeneratedMetadataImages
    ? `import { createFarmMetadataImageResponse } from "@farm.js/core/internal/metadata-image-runtime";`
    : "";
  const pluginRuntimeImport = hasPluginRuntime
    ? `import { PluginManager } from "@farm.js/core/plugin";`
    : "";
  const i18nServerImport = config.i18n.enabled
    ? `import { _runWithFarmI18nRequest, _setDefaultFarmI18nRuntime, createFarmI18nRuntime, getFarmI18nClientSnapshot } from "@farm.js/core/i18n/server";`
    : "";
  const docsHandlerImport = config.docs?.enabled
    ? adapterOwnsDocsRuntime
      ? `import { isFarmDocsAPIRequest } from "@farm.js/core/docs";
import { createFarmDocsRuntimeHandler as createFarmDocsAdapterRuntimeHandler } from ${JSON.stringify(config.docs.adapter!.server)};
import * as FarmDocsAdapterReact from ${JSON.stringify(config.docs.adapter!.react)};`
      : `import { createFarmDocsAPIHandler, createFarmDocsHandler, isFarmDocsAPIRequest } from "@farm.js/core/docs";`
    : "";
  const docsFontImport = config.docs?.enabled
    ? `import { resolveFarmLayoutFonts } from "@farm.js/core/font";`
    : "";
  const docsRuntimeImport = config.docs?.enabled
    ? `import { existsSync as farmDocsExistsSync } from "node:fs";
import { dirname as farmDocsDirname, join as farmDocsJoin } from "node:path";
import { fileURLToPath as farmDocsFileURLToPath } from "node:url";`
    : "";
  const markdownHandlerImport = config.md?.enabled
    ? `import { applyMarkdownNegotiationHeaders, createMarkdownMirrorResponse } from "@farm.js/core/markdown";`
    : "";
  const appMarkdownImport = hasMarkdownPages
    ? `import { createFarmMarkdownRouteModule, createFarmMarkdownSourceResponse } from "@farm.js/core/app-markdown";`
    : "const createFarmMarkdownSourceResponse = null;";
  const mdxComponentsPath =
    typeof config.mdx?.components === "string"
      ? path.isAbsolute(config.mdx.components)
        ? config.mdx.components
        : path.join(config.root, config.mdx.components)
      : null;
  const mdxComponentsImport = mdxComponentsPath
    ? `import * as FarmMdxComponentsModule from "${mdxComponentsPath.replace(/\\/g, "/")}";`
    : "";
  const layerConfigPaths = (config.layers || [])
    .map((layer) => layer.configFile)
    .filter((configFile): configFile is string => Boolean(configFile))
    .filter((configFile) => configFile !== configModulePath);
  const layerConfigImports = layerConfigPaths
    .map(
      (configFile, index) =>
        `import * as FarmLayerConfigModule${index} from "${configFile.replace(/\\/g, "/")}";`,
    )
    .join("\n");
  const layerConfigValues = layerConfigPaths.map(
    (_configFile, index) =>
      `(FarmLayerConfigModule${index}.default || FarmLayerConfigModule${index})`,
  );
  const integrationRuntimeExports = Array.from(
    new Set([
      ...(hasServerRuntimeIntegrations
        ? ["dispatchIntegrationRequest", "matchIntegrationRoute"]
        : []),
      ...(hasRuntimeIntegrationConfig
        ? ["getRegisteredIntegrationAPIManifest", "resolveIntegrationPlugins"]
        : []),
    ]),
  );
  const integrationRuntimeImport = integrationRuntimeExports.length
    ? `import { ${integrationRuntimeExports.join(", ")} } from "@farm.js/core/integrations";`
    : "";
  const instrumentationImport = instrumentationPath
    ? `import * as FarmInstrumentationModule from "${instrumentationPath.replace(/\\/g, "/")}";`
    : "";
  const integrationImports = `
${configModulePath ? `import * as FarmUserConfigModule from "${configModulePath}";` : ""}
${layerConfigImports}
${integrationRuntimeImport}
`;
  const imageRuntime = resolveImageRuntime(config, preset);
  const imageRuntimeImport =
    imageRuntime === "none"
      ? ""
      : `import { createCloudflareImageTransformer, createFarmImageHandler } from "@farm.js/core/image/server";`;
  const imageNodeRuntimeImport =
    imageRuntime === "node"
      ? `import { createNodeImageUrlValidator, createSharpImageTransformer } from "@farm.js/core/image/sharp";`
      : "";
  const apiHandlerCode =
    apiRoutes.length > 0
      ? `
const apiRouteMap = new Map(apiRoutes.map((route) => [route.path, route]));

function matchLocalAPIRequest(request) {
  return matchAPIRoute(apiRouteMap, new URL(request.url).pathname);
}

async function handleAPIRequest(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const match = matchLocalAPIRequest(request);

  if (!match) {
    return null;
  }

  const { route, params } = match;
  const startedAt = Date.now();
  emitFarmEvent({ type: "route.matched", pathname: url.pathname, route: route.path });
  emitFarmEvent({
    type: "api.request.start",
    pathname: url.pathname,
    route: route.path,
    method,
  });
  const endpoint = route.handlers[method];
  if (!endpoint) {
    const response = new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      {
        status: 405,
        headers: {
          "Allow": route.methods.join(", "),
          "Content-Type": "application/json",
        },
      }
    );
    emitFarmEvent({
      type: "api.request.complete",
      pathname: url.pathname,
      route: route.path,
      method,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return response;
  }

  try {
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      request,
      params,
      farmServerConfig.bodySizeLimit,
    );
    emitFarmEvent({
      type: "api.request.complete",
      pathname: url.pathname,
      route: route.path,
      method,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    emitFarmEvent({
      type: "api.error",
      pathname: url.pathname,
      route: route.path,
      method,
      durationMs: Date.now() - startedAt,
      error,
    });
    console.error(\`[API Error] \${url.pathname}:\`, error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
`
      : `
function matchLocalAPIRequest(_request) {
  return null;
}

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
${routeSlotImports.join("\n")}
${errorImports.join("\n")}
${metadataImageImports.join("\n")}
${middlewareImports.join("\n")}
${notFoundImport}
${apiRouteHelpersImport}
${productionRuntimeImport}
${metadataImageRuntimeImport}
${pluginRuntimeImport}
${i18nServerImport}
${docsHandlerImport}
${docsFontImport}
${docsRuntimeImport}
${markdownHandlerImport}
${appMarkdownImport}
${mdxComponentsImport}
${integrationImports}
${instrumentationImport}
${imageRuntimeImport}
${imageNodeRuntimeImport}
import { farmFontPreloadHeader } from "virtual:farm-font-runtime";
${rendererServerImports}

const farmPreloadConfig = ${JSON.stringify(config.performance.preload)};

// Custom 404 page component (if provided)
const hasCustomNotFound = ${notFoundPath ? "true" : "false"};
const CustomNotFoundComponent = ${notFoundPath ? "CustomNotFound.default || CustomNotFound" : "null"};
const farmUserConfig = ${
    configModulePath ? "(FarmUserConfigModule.default || FarmUserConfigModule)" : "null"
  };
const farmRuntimeConfigs = [${[...layerConfigValues, "farmUserConfig"].join(", ")}].filter(Boolean);
const farmResolvedRuntimeConfig = Object.assign({}, ...farmRuntimeConfigs);
const hasConfiguredRouteContext = typeof farmResolvedRuntimeConfig.context === "function";
const configuredIntegrations = Object.assign(
  {},
  ...farmRuntimeConfigs.map((runtimeConfig) => runtimeConfig.integrations || {}),
);
const serverRuntimeIntegrations = Object.fromEntries(
  Object.entries(configuredIntegrations).filter(([, integration]) =>
    integration && typeof integration === "object" && integration.serverRuntime !== false
  ),
);
const integrationRuntimeConfig = Object.assign({}, ...farmRuntimeConfigs, {
  integrations: configuredIntegrations,
});
const configuredPlugins = [
  ${hasRuntimeIntegrationConfig ? "...resolveIntegrationPlugins(serverRuntimeIntegrations)," : ""}
  ${
    hasConfiguredRuntimePlugins
      ? `...farmRuntimeConfigs.flatMap((runtimeConfig) =>
    Array.isArray(runtimeConfig.plugins) ? runtimeConfig.plugins : [],
  ),`
      : ""
  }
];
const farmPluginRuntime = ${
    hasPluginRuntime
      ? `configuredPlugins.length > 0
  ? (() => {
      const manager = new PluginManager({
        config: farmUserConfig || {},
        isDev: false,
        isProd: true,
      });
      manager.addPlugins(configuredPlugins);
      return manager;
    })()
  : null`
      : "null"
  };
const hasFarmPluginHTMLTransforms = configuredPlugins.some(
  (plugin) => plugin.render?.html || plugin.afterRender || plugin.transformHTML,
);
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
configureFarmCache(farmResolvedRuntimeConfig.cache);
const farmI18nConfig = ${JSON.stringify(config.i18n)};
const farmServerConfig = ${JSON.stringify(config.server)};
const farmThemeConfig = ${JSON.stringify(config.theme)};
_setDefaultFarmThemeConfig(farmThemeConfig);
const farmInstrumentationLifecycle = createFarmInstrumentationLifecycle(
  ${instrumentationPath ? "FarmInstrumentationModule" : "null"},
  {
    root:
      typeof globalThis.process?.cwd === "function" ? globalThis.process.cwd() : ".",
    mode: "production",
    runtime: resolveFarmInstrumentationRuntime(${JSON.stringify(preset)}),
  },
);
export const farmProductionLifecycle = createFarmProductionLifecycle({
  server: farmServerConfig,
  start: async () => {
    await farmInstrumentationLifecycle.start();
    try {
      await farmPluginRuntime?.startRuntime();
    } catch (error) {
      await farmInstrumentationLifecycle.shutdown();
      throw error;
    }
  },
  close: async (reason) => {
    try {
      await farmPluginRuntime?.closeRuntime(reason);
    } finally {
      await farmInstrumentationLifecycle.shutdown();
    }
  },
});
const farmI18nRuntime = ${
    config.i18n.enabled
      ? `createFarmI18nRuntime(farmI18nConfig, ${JSON.stringify(i18nCatalogs)})`
      : "null"
  };
${config.i18n.enabled ? "_setDefaultFarmI18nRuntime(farmI18nRuntime);" : ""}
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
      ...${JSON.stringify(farmDocsBaseConfig)},
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
      ? adapterOwnsDocsRuntime
        ? `createFarmDocsAdapterRuntimeHandler({
  ...farmDocsResolvedConfig.config,
  entry: farmDocsResolvedConfig.config?.entry || String(farmDocsResolvedConfig.entry || "/docs").replace(/^\\/+|\\/+$/g, "") || "docs",
  docsPath: farmDocsResolvedConfig.entry,
  contentDir: farmDocsResolvedConfig.contentDir || farmDocsResolvedConfig.config?.contentDir,
}, {
  rootDir: farmDocsRuntimeRoot,
  clientEntry: "/farm-client.js",
  stylesheets: ["/farm-fonts.css", "/__farm_client_css_href__"],
  resolveLayoutFonts: (pathname) =>
    resolveFarmLayoutFonts(
      getApplicableLayouts(getFarmRoutePathname(pathname)).map((layout) => layout.module),
    ),
  loadReactModule: async () => FarmDocsAdapterReact,
})`
        : `createFarmDocsHandler(farmDocsResolvedConfig, {
  root: farmDocsRuntimeRoot,
  srcDir: ${JSON.stringify(config.srcDir)},
  clientEntry: "/farm-client.js",
  fontAssets: ${JSON.stringify(farmDocsFontAssets)},
  resolveLayoutFonts: (pathname) =>
    resolveFarmLayoutFonts(
      getApplicableLayouts(getFarmRoutePathname(pathname)).map((layout) => layout.module),
    ),
  fontStylesheetHref: "/farm-fonts.css",
  globalStylesheetHref: "/assets/globals.css",
})`
      : "null"
  };
const farmDocsAPIHandler = ${
    config.docs?.enabled
      ? adapterOwnsDocsRuntime
        ? "null"
        : `createFarmDocsAPIHandler({ rootDir: farmDocsRuntimeRoot, srcDir: ${JSON.stringify(config.srcDir)}, docs: farmDocsResolvedConfig })`
      : "null"
  };

// API routes bundled at build time
const apiRoutes = [${apiRegistrations.join(",")}
];

// Page routes bundled at build time
const pageRoutes = [${pageRegistrations.join(",")}
];
const exactPageRoutes = new Map();
const patternPageRoutes = [];
for (const route of pageRoutes) {
  if (/[\\[\\]*:]/.test(route.pattern)) {
    patternPageRoutes.push(route);
  } else {
    const exactPath = normalizeRuntimePath(route.pattern);
    if (!exactPageRoutes.has(exactPath)) exactPageRoutes.set(exactPath, route);
  }
}

// Layout routes bundled at build time (sorted by depth, root first)
const layoutRoutes = [${layoutRegistrations.join(",")}
];

const routeSlots = [${routeSlotRegistrations.join(",")}
];

// Route-level error boundaries bundled at build time.
const errorRoutes = [${errorRegistrations.join(",")}
];

// Metadata image routes bundled at build time
const metadataImageRoutes = [${metadataImageRegistrations.join(",")}
];

// Redirect routes bundled at build time
const redirectRoutes = ${JSON.stringify(redirectRoutes, null, 2)};

// Legacy rewrites() entries resolved at build time for standalone parity.
const configuredRewriteRoutes = ${JSON.stringify(configuredRewriteRoutes, null, 2)};

// Legacy headers() entries resolved at build time for standalone parity.
const configuredHeaderRoutes = ${JSON.stringify(configuredHeaderRoutes, null, 2)};

function getFarmI18nSnapshot() {
  return ${config.i18n.enabled ? "getFarmI18nClientSnapshot()" : "undefined"};
}

function getFarmRoutePathname(pathname) {
  return farmI18nRuntime
    ? stripFarmLocaleFromPathname(pathname, farmI18nConfig)
    : pathname;
}

function serializeFarmInlineValue(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\\\u003c")
    .replace(/\\u2028/g, "\\\\u2028")
    .replace(/\\u2029/g, "\\\\u2029");
}

function renderFarmClientBootstrapScript(canonicalPath, selectedRouteSlots, pageProps) {
  const integrationManifest = ${
    hasRuntimeIntegrationConfig ? "getRegisteredIntegrationAPIManifest()" : "{}"
  };
  const serializedRouteSlots = serializeFarmInlineValue(selectedRouteSlots || []);
  const serializedPageProps = serializeFarmInlineValue(pageProps || {});
  let source = 'window.__FARM_PROPS__=' + serializedPageProps +
    ';window.__FARM_INTEGRATION_API_MANIFEST__=' +
    serializeFarmInlineValue(integrationManifest) +
    ';window.__FARM_ROUTE_SLOTS__=' + serializedRouteSlots + ';';
  if (typeof canonicalPath === "string" && canonicalPath.startsWith("/")) {
    const serializedPath = serializeFarmInlineValue(canonicalPath);
    source += 'if(location.pathname+location.search!==' + serializedPath + '){' +
      'history.replaceState(Object.assign({},history.state||{},{path:' + serializedPath + '}),"",' +
      serializedPath + ');}';
  }
  return '<script id="__farm_route_slots_data__" type="application/json">' +
    serializedRouteSlots +
    '</script><script>' + source + '</script>';
}

function renderFarmRendererHydrationScript() {
  return typeof ReactDOMServer.generateHydrationScript === "function"
    ? ReactDOMServer.generateHydrationScript()
    : "";
}

function escapeFarmHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function renderFarmElement(ReactDOMServer, element) {
  const streamErrors = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const normalizeChunk = function(chunk) {
    if (typeof chunk === "string") return encoder.encode(chunk);
    if (chunk instanceof Uint8Array) return chunk;
    return new Uint8Array(chunk);
  };
  const decodeChunks = function(chunks) {
    let html = "";
    for (const chunk of chunks) {
      html += decoder.decode(chunk, { stream: true });
    }
    return html + decoder.decode();
  };
  const throwStreamError = function() {
    if (streamErrors.length > 0) throw streamErrors[0];
  };

  if (typeof ReactDOMServer.renderToReadableStream === "function") {
    const stream = await ReactDOMServer.renderToReadableStream(element, {
      onError(error) {
        streamErrors.push(error);
        console.error("[Farm SSR stream]", error);
      },
    });
    const reader = stream.getReader();
    const firstResult = await reader.read();
    if (firstResult.done) {
      throwStreamError();
      return { html: "", shellHtml: "", streamErrors };
    }

    const firstChunk = normalizeChunk(firstResult.value);
    let allReady = false;
    const allReadyPromise = stream.allReady;
    if (allReadyPromise && typeof allReadyPromise.then === "function") {
      Promise.resolve(allReadyPromise).then(
        function() {
          allReady = true;
        },
        function() {},
      );
      // React resolves allReady in the same turn for a synchronous tree. A
      // suspended tree remains pending, so its already-produced shell can be
      // returned without rendering the element a second time.
      await Promise.resolve();
    }

    if (allReady) {
      const chunks = [firstChunk];
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(normalizeChunk(result.value));
      }
      throwStreamError();
      const html = decodeChunks(chunks);
      return { html, shellHtml: html, streamErrors };
    }

    let replayFirstChunk = true;
    const replayStream = new ReadableStream({
      pull(controller) {
        if (replayFirstChunk) {
          replayFirstChunk = false;
          controller.enqueue(firstChunk);
          return;
        }
        return reader.read().then(
          function(result) {
            if (result.done) controller.close();
            else controller.enqueue(normalizeChunk(result.value));
          },
          function(error) {
            controller.error(error);
          },
        );
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return {
      stream: replayStream,
      shellHtml: new TextDecoder().decode(firstChunk),
      streamErrors,
    };
  }

  if (typeof ReactDOMServer.renderToPipeableStream === "function") {
    let pipeableStream;
    let streamController;
    let streamClosed = false;
    let streamStarted = false;
    let allReady = false;
    let decisionState = "pending";
    let settleDecision;
    let rejectDecision;
    let settleComplete;
    let rejectComplete;
    const chunks = [];
    const decision = new Promise(function(resolve, reject) {
      settleDecision = resolve;
      rejectDecision = reject;
    });
    const complete = new Promise(function(resolve, reject) {
      settleComplete = resolve;
      rejectComplete = reject;
    });
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel(reason) {
        if (pipeableStream && typeof pipeableStream.abort === "function") {
          pipeableStream.abort(reason);
        }
      },
    });
    const fail = function(error) {
      if (!streamClosed) {
        streamClosed = true;
        if (decisionState === "stream") streamController.error(error);
      }
      if (decisionState === "complete") rejectComplete(error);
      else if (decisionState === "pending") rejectDecision(error);
    };
    const destination = {
      write(chunk) {
        if (streamClosed) return false;
        const normalized = normalizeChunk(chunk);
        if (streamStarted) streamController.enqueue(normalized);
        else chunks.push(normalized);
        return true;
      },
      end() {
        if (streamClosed) return;
        streamClosed = true;
        if (streamStarted) streamController.close();
        settleComplete();
      },
      on() {
        return destination;
      },
      destroy(error) {
        fail(error || new Error("React server render stream was destroyed"));
      },
    };
    pipeableStream = ReactDOMServer.renderToPipeableStream(element, {
      onShellReady() {
        try {
          pipeableStream.pipe(destination);
          queueMicrotask(function() {
            decisionState = allReady ? "complete" : "stream";
            settleDecision(decisionState);
          });
        } catch (error) {
          fail(error);
        }
      },
      onAllReady() {
        allReady = true;
      },
      onShellError: fail,
      onError(error) {
        streamErrors.push(error);
        console.error("[Farm SSR stream]", error);
      },
    });

    if ((await decision) === "complete") {
      await complete;
      throwStreamError();
      const html = decodeChunks(chunks);
      return { html, shellHtml: html, streamErrors };
    }

    streamStarted = true;
    for (const chunk of chunks) streamController.enqueue(chunk);
    if (streamClosed) streamController.close();
    return {
      stream,
      shellHtml: chunks.length > 0 ? new TextDecoder().decode(chunks[0]) : "",
      streamErrors,
    };
  }

  const html = await ReactDOMServer.renderToString(element);
  return { html, shellHtml: html, streamErrors };
}

async function renderFarmElementToString(ReactDOMServer, element) {
  const rendered = await renderFarmElement(ReactDOMServer, element);
  if (rendered.html !== undefined) return rendered.html;
  const html = await new Response(rendered.stream).text();
  if (rendered.streamErrors.length > 0) throw rendered.streamErrors[0];
  return html;
}

function createFarmDocumentStream(contentStream, prefix, suffix, onComplete) {
  const encoder = new TextEncoder();
  const reader = contentStream.getReader();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(prefix));
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.enqueue(encoder.encode(suffix));
          if (onComplete) onComplete();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function createFarmErrorDocument(html, title) {
  const escapedTitle = escapeFarmHtmlAttribute(title || "Application Error");
  const trimmedHtml = html.trim();
  const hasFullDocument = trimmedHtml.startsWith("<html") ||
    trimmedHtml.startsWith("<!DOCTYPE");

  if (!hasFullDocument) {
    return '<!DOCTYPE html>\\n<html lang="en">\\n<head>\\n' +
      '  <meta charset="utf-8">\\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1">\\n' +
      '  <link rel="icon" href="data:,">\\n' +
      '  <title>' + escapedTitle + '</title>\\n' +
      '  <link rel="stylesheet" href="/__farm_client_css_href__">\\n' +
      renderFarmRendererHydrationScript() + '\\n' +
      '</head>\\n<body>\\n' +
      '  <div id="root">' + html + '</div>\\n' +
      '  ' + renderFarmClientBootstrapScript() + '\\n' +
      '  <script type="module" src="/farm-client.js"></script>\\n' +
      '</body>\\n</html>';
  }

  let fullHtml = html;
  if (!/\\sid=["']root["']/.test(fullHtml)) {
    fullHtml = fullHtml
      .replace(/<body([^>]*)>/i, '<body$1><div id="root">')
      .replace(/<\\/body>/i, '</div></body>');
  }
  fullHtml = fullHtml
    .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/__farm_client_css_href__">')
    .replace(/<\\/head>/i, renderFarmRendererHydrationScript() + '\\n</head>')
    .replace(/<head([^>]*)>([\\s\\S]*?)<\\/head>/i, function(match, attrs, headContent) {
      return headContent.includes("<title")
        ? match
        : '<head' + attrs + '>' + headContent + '\\n  <title>' + escapedTitle + '</title>\\n</head>';
    })
    .replace(
      /<\\/body>/i,
      '  ' + renderFarmClientBootstrapScript() + '\\n' +
        '  <script type="module" src="/farm-client.js"></script>\\n</body>',
    );
  return fullHtml.trim().startsWith("<!DOCTYPE")
    ? fullHtml
    : "<!DOCTYPE html>\\n" + fullHtml;
}

function renderFarmI18nAlternateLinks(requestPath, snapshot) {
  if (!snapshot || snapshot.routing === "none") return "";
  const url = new URL(requestPath, "http://farm.local");
  const routePathname = stripFarmLocaleFromPathname(url.pathname, snapshot);
  const links = snapshot.locales.map(function(locale) {
    const href = localizeFarmPathname(routePathname, locale, snapshot);
    return '<link rel="alternate" hreflang="' + escapeFarmHtmlAttribute(locale) +
      '" href="' + escapeFarmHtmlAttribute(href) + '">';
  });
  links.push(
    '<link rel="alternate" hreflang="x-default" href="' +
      escapeFarmHtmlAttribute(
        localizeFarmPathname(routePathname, snapshot.defaultLocale, snapshot)
      ) +
      '">'
  );
  return links.join("");
}

function applyFarmI18nDocument(html, requestPath, snapshot) {
  if (!snapshot) return html;
  const locale = escapeFarmHtmlAttribute(snapshot.locale);
  const direction = escapeFarmHtmlAttribute(snapshot.direction);
  let nextHtml = html.replace(/<html([^>]*)>/i, function(_match, attributes) {
    const cleaned = attributes.replace(
      /\\s+(?:lang|dir)=(?:"[^"]*"|'[^']*'|[^\\s>]+)/gi,
      ""
    );
    return '<html' + cleaned + ' lang="' + locale + '" dir="' + direction + '">';
  });
  const runtimeMarkup =
    renderFarmI18nAlternateLinks(requestPath, snapshot) +
    '<script>window.__FARM_I18N__ = ' + serializeFarmInlineValue(snapshot) + ';</script>';
  nextHtml = nextHtml.replace(/<head([^>]*)>/i, '<head$1>' + runtimeMarkup);
  return nextHtml;
}

function appendFarmVary(headers, value) {
  const existing = headers.get("Vary");
  const values = new Set(
    (existing ? existing.split(",") : []).map(function(entry) { return entry.trim(); }).filter(Boolean)
  );
  values.add(value);
  headers.set("Vary", Array.from(values).join(", "));
}

function applyFarmI18nResponse(response, resolution) {
  if (!farmI18nRuntime || !resolution) return response;
  const headers = new Headers(response.headers);
  if (resolution.persist) {
    headers.append("Set-Cookie", createFarmLocaleCookie(resolution.locale, farmI18nConfig));
  }
  const varyHeaders = getFarmLocaleVaryHeaders(farmI18nConfig, resolution);
  for (const header of varyHeaders) appendFarmVary(headers, header);
  if (varyHeaders.length > 0) {
    headers.set("Cache-Control", "private, no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function hasOnlyValidFarmLocaleCookie(cookieHeader) {
  if (!farmI18nRuntime || !cookieHeader) return false;
  const parts = cookieHeader.split(";");
  if (parts.length !== 1) return false;

  const cookie = parts[0].trim();
  const separator = cookie.indexOf("=");
  if (separator <= 0) return false;

  let name;
  let value;
  try {
    name = decodeURIComponent(cookie.slice(0, separator).trim());
    value = decodeURIComponent(cookie.slice(separator + 1).trim());
  } catch {
    return false;
  }

  return (
    name === farmI18nConfig.cookie.name &&
    farmI18nConfig.locales.includes(value)
  );
}

function hasPrivateFarmRequestHeaders(request, farmLocaleResolution) {
  if (request.headers.get("authorization")) return true;
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return false;

  return !(
    farmLocaleResolution?.source === "url" &&
    hasOnlyValidFarmLocaleCookie(cookieHeader)
  );
}

function normalizeRuntimePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.replace(/\\/+$/, "") : pathname;
}

function splitRuntimePath(pathname) {
  return normalizeRuntimePath(pathname).split("/").filter(Boolean);
}

const farmCatchAllParamSegments = Symbol("farm.catch-all-param-segments");

function matchRuntimePathPattern(pattern, pathname) {
  const patternSegments = splitRuntimePath(pattern);
  const pathnameSegments = splitRuntimePath(pathname);
  const params = {};
  const catchAllParamSegments = {};
  Object.defineProperty(params, farmCatchAllParamSegments, {
    value: catchAllParamSegments,
  });
  let pathIndex = 0;

  for (const segment of patternSegments) {
    const optionalCatchAll = segment.match(/^\\[\\[\\.\\.\\.(.+)\\]\\]$/);
    const catchAll = segment.match(/^\\[\\.\\.\\.(.+)\\]$/);
    const dynamic = segment.match(/^\\[(.+)\\]$/);
    const namedCatchAll = segment.match(/^:([^/]+)\\*$/);
    const namedDynamic = segment.match(/^:([^/]+)$/);
    const starCatchAll = segment.match(/^\\*([^?]+)(\\?)?$/);
    const wildcard = segment === "*";

    if (optionalCatchAll || catchAll || namedCatchAll || starCatchAll || wildcard) {
      const name = wildcard
        ? "wildcard"
        : (optionalCatchAll || catchAll || namedCatchAll || starCatchAll)[1];
      const remainingSegments = pathnameSegments.slice(pathIndex).map(decodeURIComponent);
      const remaining = remainingSegments.join("/");
      if (!remaining && (catchAll || (starCatchAll && !starCatchAll[2]))) return null;
      params[name] = remaining;
      catchAllParamSegments[name] = remainingSegments;
      pathIndex = pathnameSegments.length;
      continue;
    }

    const pathnameSegment = pathnameSegments[pathIndex];
    if (pathnameSegment === undefined) return null;

    if (dynamic || namedDynamic) {
      params[(dynamic || namedDynamic)[1]] = decodeURIComponent(pathnameSegment);
      pathIndex++;
      continue;
    }

    if (segment !== pathnameSegment) return null;
    pathIndex++;
  }

  return pathIndex === pathnameSegments.length ? params : null;
}

function getMatchingErrorBoundary(pathname) {
  const pathSegments = splitRuntimePath(pathname);
  let bestMatch = null;

  for (const errorRoute of errorRoutes) {
    const patternDepth = splitRuntimePath(errorRoute.pattern).length;
    if (patternDepth > pathSegments.length) continue;
    const candidatePath = patternDepth === 0
      ? "/"
      : "/" + pathSegments.slice(0, patternDepth).join("/");
    const params = matchRuntimePathPattern(errorRoute.pattern, candidatePath);
    if (params === null) continue;

    if (!bestMatch || patternDepth > bestMatch.depth) {
      bestMatch = { route: errorRoute, params, depth: patternDepth };
    }
  }

  return bestMatch;
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

function createMetadataImageReference(match, locale) {
  const image = match.image;
  const metadata = image.sourceType === "static" ? image.staticInfo : image.module;
  const basePath = match.pagePath === "/" ? "" : match.pagePath;
  const version = image.sourceType === "static" ? "?v=" + image.staticInfo.hash : "";
  const href = basePath + "/" + image.fileName + version;

  return {
    kind: image.kind,
    href: locale ? localizeFarmHref(href, locale, farmI18nConfig) : href,
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

async function handleMetadataImageRequest(request, routePathname) {
  const url = new URL(request.url);
  const match = matchMetadataImageRequest(routePathname || url.pathname);
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

    ${
      hasGeneratedMetadataImages
        ? `return createFarmMetadataImageResponse(value, imageModule, {
      method,
      ifNoneMatch: request.headers.get("if-none-match"),
    });`
        : 'throw new Error("Generated metadata image runtime is unavailable");'
    }
  } catch (error) {
    console.error("Metadata image render failed:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function encodeRuntimePathSegment(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    function(character) {
      return "%" + character.charCodeAt(0).toString(16).toUpperCase();
    },
  );
}

function interpolateRedirectDestination(destination, params) {
  let result = destination;
  const catchAllParamSegments = params[farmCatchAllParamSegments] || {};
  for (const [key, value] of Object.entries(params)) {
    const segments = catchAllParamSegments[key];
    const encodedValue = Array.isArray(segments)
      ? segments.map(encodeRuntimePathSegment).join("/")
      : encodeRuntimePathSegment(value);
    result = result.split("[[..." + key + "]]").join(encodedValue);
    result = result.split("[..." + key + "]").join(encodedValue);
    result = result.split("[" + key + "]").join(encodedValue);
    result = result.split(":" + key + "*").join(encodedValue);
    result = result.split(":" + key).join(encodedValue);
    if (key === "wildcard") result = result.split("*").join(encodedValue);
  }
  return result;
}

function matchRedirectRoute(pathname, locale) {
  for (const redirect of redirectRoutes) {
    const params = matchRuntimePathPattern(redirect.source, pathname);
    if (!params) continue;
    const destination = interpolateRedirectDestination(redirect.destination, params);
    return {
      destination:
        locale && destination.startsWith("/") && !destination.startsWith("//")
          ? localizeFarmHref(destination, locale, farmI18nConfig)
          : destination,
      statusCode: redirect.statusCode || (redirect.permanent ? 308 : 307),
    };
  }
  return null;
}

function matchRewriteRoute(pathname, locale) {
  for (const rewrite of configuredRewriteRoutes) {
    const params = matchRuntimePathPattern(rewrite.source, pathname);
    if (!params) continue;
    const destination = interpolateRedirectDestination(rewrite.destination, params);
    return locale && destination.startsWith("/") && !destination.startsWith("//")
      ? localizeFarmHref(destination, locale, farmI18nConfig)
      : destination;
  }
  return null;
}

function createRewrittenRequest(request, destination) {
  const sourceUrl = new URL(request.url);
  const destinationUrl = new URL(destination, sourceUrl);
  if (!destinationUrl.search && sourceUrl.search) {
    destinationUrl.search = sourceUrl.search;
  }
  return new Request(destinationUrl, request);
}

function applyConfiguredResponseHeaders(response, pathname) {
  let headers;
  for (const headerRoute of configuredHeaderRoutes) {
    if (!matchRuntimePathPattern(headerRoute.source, pathname)) continue;
    for (const header of headerRoute.headers) {
      const currentValue = (headers || response.headers).get(header.key);
      if (currentValue === header.value) continue;
      if (!headers) headers = new Headers(response.headers);
      if (header.key.toLowerCase() === "link") {
        appendFarmLinkHeader(headers, header.value);
      } else {
        headers.set(header.key, header.value);
      }
    }
  }

  if (!headers) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// App middleware files bundled at build time (sorted by depth, root first)
const fileMiddlewareModules = [${middlewareRegistrations.join(",")}
];

const farmMiddlewareRunner = ${
    hasMiddlewareRuntime
      ? `createProductionMiddlewareRunner({
  config: farmUserConfig?.middleware,
  modules: fileMiddlewareModules,
  i18n: farmI18nConfig,
  server: farmServerConfig,
})`
      : "null"
  };

${apiHandlerCode}

function matchLocalIntegrationRequest(request) {
  ${
    hasServerRuntimeIntegrations
      ? `return matchIntegrationRoute(serverRuntimeIntegrations, {
    pathname: new URL(request.url).pathname,
    method: request.method,
  });`
      : "return null;"
  }
}

async function handleIntegrationRequest(request) {
  const matchedIntegrationRoute = matchLocalIntegrationRequest(request);
  if (!matchedIntegrationRoute) {
    return null;
  }

  ${
    hasServerRuntimeIntegrations
      ? `
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
  const exactRoute = exactPageRoutes.get(normalizeRuntimePath(pathname));
  if (exactRoute) return { route: exactRoute, params: {} };

  for (const route of patternPageRoutes) {
    const params = matchRuntimePathPattern(route.pattern, pathname);
    if (params !== null) return { route, params };
  }
  return null;
}

function matchesRoutePrefix(pathname, pattern) {
  if (pattern === "/") return true;
  const pathSegments = normalizeRuntimePath(pathname).split("/").filter(Boolean);
  const patternSegments = normalizeRuntimePath(pattern).split("/").filter(Boolean);
  if (patternSegments.length > pathSegments.length) return false;
  const candidate = "/" + pathSegments.slice(0, patternSegments.length).join("/");
  return matchRuntimePathPattern(pattern, candidate) !== null;
}

function routeSlotSpecificity(slot) {
  return slot.pattern.split("/").reduce(function(score, segment) {
    if (!segment) return score;
    if (segment.startsWith("[[...")) return score + 1;
    if (segment.startsWith("[...")) return score + 2;
    if (segment.startsWith("[")) return score + 3;
    return score + 10;
  }, 0);
}

function matchRouteSlots(pathname, interceptFrom) {
  const groups = new Map();
  for (const slot of routeSlots) {
    if (!matchesRoutePrefix(pathname, slot.ownerPattern)) continue;
    const key = slot.ownerPattern + ":" + slot.name;
    const entries = groups.get(key) || [];
    entries.push(slot);
    groups.set(key, entries);
  }

  const normalizedFrom =
    typeof interceptFrom === "string" && interceptFrom.startsWith("/")
      ? new URL(interceptFrom, "http://farm.local").pathname
      : null;
  const matches = [];

  for (const entries of groups.values()) {
    const candidates = entries
      .filter(function(entry) { return !entry.fallback; })
      .filter(function(entry) {
        return !entry.interception ||
          (normalizedFrom && matchesRoutePrefix(normalizedFrom, entry.ownerPattern));
      })
      .map(function(entry) {
        return {
          entry: entry,
          params: matchRuntimePathPattern(entry.pattern, pathname),
        };
      })
      .filter(function(candidate) { return candidate.params !== null; })
      .sort(function(left, right) {
        if (left.entry.interception !== right.entry.interception) {
          return left.entry.interception ? -1 : 1;
        }
        return routeSlotSpecificity(right.entry) - routeSlotSpecificity(left.entry);
      });

    if (candidates[0]) {
      matches.push({ ...candidates[0].entry, params: candidates[0].params });
      continue;
    }

    const fallback = entries.find(function(entry) { return entry.fallback; });
    if (fallback) matches.push({ ...fallback, params: {} });
  }

  return matches.sort(function(left, right) {
    const ownerDepth =
      left.ownerPattern.split("/").filter(Boolean).length -
      right.ownerPattern.split("/").filter(Boolean).length;
    return ownerDepth || left.name.localeCompare(right.name);
  });
}

function hasLocalRequestRoute(request, routePathname) {
  const pathname = new URL(request.url).pathname;
  if (matchLocalAPIRequest(request) || matchLocalIntegrationRequest(request)) {
    return true;
  }
  if (matchPageRoute(routePathname) || matchMetadataImageRequest(routePathname)) {
    return true;
  }
  if (${imageRuntime === "none" ? "false" : `pathname === ${JSON.stringify(config.images.path)}`}) {
    return true;
  }
  ${
    config.docs?.enabled
      ? `const docsPath = normalizeRuntimePath(farmDocsResolvedConfig?.entry || "/docs");
  if (
    isFarmDocsAPIRequest(pathname) ||
    docsPath === "/" ||
    pathname === docsPath ||
    pathname.startsWith(docsPath + "/")
  ) {
    return true;
  }`
      : ""
  }
  return false;
}

function getFarmPluginRequestOptions(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const routePathname = getFarmRoutePathname(pathname);
  const route = { pathname };
  const isDocsAPIRequest = ${config.docs?.enabled ? "isFarmDocsAPIRequest(pathname)" : "false"};
  const integrationMatch = ${
    hasServerRuntimeIntegrations
      ? `matchIntegrationRoute(serverRuntimeIntegrations, {
    pathname,
    method: request.method,
  })`
      : "null"
  };

  if (integrationMatch) {
    return {
      kind: "integration",
      route: {
        ...route,
        pattern: integrationMatch.route.path,
        params: integrationMatch.params,
      },
    };
  }

  const docsPath = normalizeRuntimePath(farmDocsResolvedConfig?.entry || "/docs");
  if (
    isDocsAPIRequest ||
    (farmDocsHandler && (pathname === docsPath || pathname.startsWith(docsPath + "/")))
  ) {
    return { kind: "docs", route: { ...route, pattern: docsPath } };
  }

  for (const apiRoute of apiRoutes) {
    const params = matchRuntimePathPattern(apiRoute.path, pathname);
    if (params !== null) {
      return {
        kind: "api",
        route: { ...route, pattern: apiRoute.path, params },
      };
    }
  }

  const metadataImageMatch = matchMetadataImageRequest(routePathname);
  if (metadataImageMatch) {
    return {
      kind: "asset",
      route: {
        ...route,
        pattern: metadataImageMatch.image.pattern,
        params: metadataImageMatch.params,
      },
    };
  }

  const pageMatch = matchPageRoute(routePathname);
  if (pageMatch) {
    return {
      kind: "page",
      route: {
        ...route,
        pattern: pageMatch.route.pattern,
        params: pageMatch.params,
      },
    };
  }

  if (pathname.startsWith("/api/")) {
    return { kind: "api", route };
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return { kind: "page", route };
  }

  return { kind: "request", route };
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

${
  config.docs?.enabled
    ? `async function wrapFarmDocsResponseWithLayouts(request, response) {
  if (request.method === "HEAD") return response;
  if (response.headers.get("x-farm-docs-adapter")) return response;

  const pathname = getFarmRoutePathname(new URL(request.url).pathname);
  const applicableLayouts = getApplicableLayouts(pathname);
  if (!applicableLayouts.some((layout) => layout.shouldHydrate === true)) {
    return response;
  }

  const source = await response.text();
  const bodyMatch = source.match(/<body([^>]*)>([\\s\\S]*?)<\\/body>/i);
  if (!bodyMatch) {
    return new Response(source, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const matchedRoute = matchPageRoute(pathname);
  const params = matchedRoute?.params || {};
  const hydrationStrategies = applicableLayouts.flatMap((layout) =>
    layout.shouldHydrate && layout.islandStrategy ? [layout.islandStrategy] : [],
  );
  const islandStrategy = hydrationStrategies.every(
    (strategy) => strategy === hydrationStrategies[0],
  )
    ? (hydrationStrategies[0] || "load")
    : "load";
  let wrappedElement = React.createElement("div", {
    id: "__farm_page__",
    "data-farm-client": "false",
    "data-farm-layout-client": "true",
    "data-farm-island": "page",
    "data-farm-island-strategy": islandStrategy,
    dangerouslySetInnerHTML: { __html: bodyMatch[2] },
  });

  for (let index = applicableLayouts.length - 1; index >= 0; index--) {
    const LayoutComponent = applicableLayouts[index].module.default;
    if (LayoutComponent) {
      wrappedElement = React.createElement(LayoutComponent, {
        children: wrappedElement,
        params,
      });
    }
  }

  const rootMarkup = await renderFarmElementToString(
    ReactDOMServer,
    React.createElement("div", { id: "root" }, wrappedElement),
  );
  let html = source.replace(
    bodyMatch[0],
    "<body" + bodyMatch[1] + ">" + rootMarkup + "</body>",
  );
  if (!html.includes('href="/__farm_client_css_href__"')) {
    const clientStylesheet = '  <link rel="stylesheet" href="/__farm_client_css_href__">\\n';
    const firstStyleIndex = html.search(/<style(?:\\s|>)/i);
    html =
      firstStyleIndex >= 0
        ? html.slice(0, firstStyleIndex) + clientStylesheet + html.slice(firstStyleIndex)
        : html.replace(/<[/]head>/i, clientStylesheet + "</head>");
  }
  if (!html.includes('id="__farm_route_slots_data__"')) {
    html = html.replace(/<[/]body>/i, renderFarmClientBootstrapScript() + "\\n</body>");
  }
  if (!html.includes('src="/farm-client.js"')) {
    html = html.replace(
      /<[/]body>/i,
      '  <script type="module" src="/farm-client.js"></script>\\n</body>',
    );
  }
  if (!html.includes('window._$HY')) {
    html = html.replace(/<[/]head>/i, renderFarmRendererHydrationScript() + "\\n</head>");
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}`
    : ""
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
  if (request.headers.get("x-farm-intercept-from")) return "route-interception";
  if (request.headers.get("x-farm-ppr-refresh")) return "refresh";
  if (hasConfiguredRouteContext) return "route-context";
  if (middlewareData?.size) return "middleware-data";
  if (middlewareContext?.size) return "middleware-context";
  return undefined;
}

function getPPRShellCacheKey(url, locale) {
  return createFarmCacheKey([
    "ppr",
    locale || "",
    normalizeRevalidatePath(url.pathname),
    url.search,
  ]);
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

function getRouteSharedCacheControl(routeModule, pprCanCache) {
  if (!routeModule || routeModule.dynamic === "force-dynamic") {
    return null;
  }

  const isStaticRoute =
    routeModule.ssg === true ||
    routeModule.dynamic === "force-static" ||
    routeModule.dynamic === "error";
  if (!isStaticRoute && !pprCanCache) {
    return null;
  }

  const revalidate =
    typeof routeModule.revalidate === "number" && routeModule.revalidate > 0
      ? routeModule.revalidate
      : 60;
  return "public, s-maxage=" + revalidate + ", stale-while-revalidate=300";
}

async function getCachedPPRShell(cacheKey) {
  const entry = await pprShellCache.getEntryAsync(cacheKey);
  if (!entry) {
    return null;
  }

  return entry.value.html;
}

/**
 * Main request handler - created at runtime with bundled routes
 */
async function handleFarmRequest(request) {
  const response = await ${
    config.i18n.enabled
      ? `_runWithFarmI18nRequest(
    farmI18nRuntime,
    request,
    async function(farmLocaleResolution) {
      if (
        farmLocaleResolution.redirect &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        return applyFarmI18nResponse(
          new Response(null, {
            status: 307,
            headers: { Location: farmLocaleResolution.redirect },
          }),
          farmLocaleResolution
        );
      }
      const response = await handleFarmRequestInContext(request, farmLocaleResolution);
      return applyFarmI18nResponse(response, farmLocaleResolution);
    }
  )`
      : "handleFarmRequestInContext(request, null)"
  };
  ${
    config.md?.enabled
      ? `const pathname = getFarmRoutePathname(new URL(request.url).pathname);
  if (matchPageRoute(pathname)) {
    return applyMarkdownNegotiationHeaders(response, {
      config: farmMarkdownConfig,
      pathname,
    });
  }`
      : ""
  }
  return response;
}

async function handleFarmRequestInContext(
  request,
  farmLocaleResolution,
  configuredRewriteApplied = false,
  requestStartTime = Date.now(),
) {
  let url = new URL(request.url);
  let pathname = url.pathname;
  let routePathname = getFarmRoutePathname(pathname);

  // Redirects have precedence over local routes. Configured rewrites use
  // after-files semantics so emitted page, API, integration, docs, image, and
  // metadata routes keep their normal method/status handling. Internal rewrite
  // targets re-enter this handler so middleware and request-local state observe
  // the rewritten URL; external destinations are proxied transparently.
  if (!configuredRewriteApplied) {
    const redirectMatch = matchRedirectRoute(routePathname, farmLocaleResolution?.locale);
    if (redirectMatch) {
      return new Response("Redirecting to " + redirectMatch.destination, {
        status: redirectMatch.statusCode,
        headers: { Location: redirectMatch.destination },
      });
    }

    if (
      configuredRewriteRoutes.length > 0 &&
      !hasLocalRequestRoute(request, routePathname)
    ) {
      const rewriteDestination = matchRewriteRoute(
        routePathname,
        farmLocaleResolution?.locale,
      );
      if (rewriteDestination) {
        const rewrittenRequest = createRewrittenRequest(request, rewriteDestination);
        if (new URL(rewrittenRequest.url).origin !== url.origin) {
          return globalThis.fetch(rewrittenRequest);
        }
        return _runWithCurrentRequest(rewrittenRequest, () =>
          handleFarmRequestInContext(
            rewrittenRequest,
            farmLocaleResolution,
            true,
            requestStartTime,
          )
        );
      }
    }
  }

  if (farmImageHandler && pathname === ${JSON.stringify(config.images.path)}) {
    const imageResponse = await farmImageHandler(request);
    if (imageResponse) {
      return imageResponse;
    }
  }

  ${
    hasServerRuntimeIntegrations
      ? `
  const integrationResponse = await handleIntegrationRequest(request.clone());
  if (integrationResponse) {
    return integrationResponse;
  }
  `
      : ""
  }

  ${
    config.docs?.enabled
      ? `
  if (farmDocsHandler) {
    const docsResponse = await farmDocsHandler(request.clone());
    if (docsResponse) {
      if (!docsResponse.headers.get("content-type")?.toLowerCase().includes("text/html")) {
        return docsResponse;
      }
      const wrappedDocsResponse = await wrapFarmDocsResponseWithLayouts(
        request,
        docsResponse,
      );
      const docsHeaders = new Headers(wrappedDocsResponse.headers);
      docsHeaders.set("x-farm-preload-buffered", "1");
      return new Response(wrappedDocsResponse.body, {
        status: wrappedDocsResponse.status,
        statusText: wrappedDocsResponse.statusText,
        headers: docsHeaders,
      });
    }
  }
  `
      : ""
  }

  ${
    hasMarkdownPages
      ? `
  const markdownSourceResponse = await createFarmMarkdownSourceResponse?.({
    request: request.clone(),
    config: farmMdxConfig,
    resolveSource: (targetPathname) => {
      const match = matchPageRoute(getFarmRoutePathname(targetPathname));
      return match?.route?.markdownSource || null;
    },
  });
  if (markdownSourceResponse) {
    return markdownSourceResponse;
  }
  `
      : ""
  }

  ${
    config.md?.enabled
      ? `
  if (farmMarkdownConfig?.enabled) {
    const markdownResponse = await createMarkdownMirrorResponse({
      request: request.clone(),
      config: farmMarkdownConfig,
      routeExists: (targetPathname) =>
        Boolean(matchPageRoute(getFarmRoutePathname(targetPathname))),
      renderPage: (targetRequest) => handleFarmRequest(targetRequest),
    });
    if (markdownResponse) {
      return markdownResponse;
    }
  }
  `
      : ""
  }

  ${
    hasMiddlewareRuntime
      ? `
  const requestBeforeMiddleware = request;
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
  routePathname = getFarmRoutePathname(pathname);

  // Middleware may replace the Request when it rewrites a URL. Re-enter the
  // request store so pages, layouts, and route context observe that rewritten
  // request instead of the original outer-handler value.
  const runResolvedRequest = async () => {
  `
      : `
  const middlewareData = undefined;
  const middlewareContext = undefined;
  const middlewareHeaders = undefined;
  `
  }

  ${
    apiRoutes.length > 0
      ? `
  const apiResponse = await handleAPIRequest(request.clone());
  if (apiResponse) {
    return applyProductionMiddlewareHeaders(apiResponse, middlewareHeaders);
  }
  `
      : ""
  }

  ${
    metadataImageRoutes.length > 0
      ? `
  const metadataImageResponse = await handleMetadataImageRequest(
    request.clone(),
    routePathname
  );
  if (metadataImageResponse) {
    return applyProductionMiddlewareHeaders(metadataImageResponse, middlewareHeaders);
  }
  `
      : ""
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
  const matchedRoute = matchPageRoute(routePathname);
  if (matchedRoute) {
    const { route, params } = matchedRoute;
    emitFarmEvent({ type: "route.matched", pathname, route: route.pattern, params });
    
    try {
      const pprConfig = resolvePPRConfig(route.module);
      const pprBypassReason = pprConfig.enabled
        ? getPPRShellBypassReason(request, middlewareData, middlewareContext)
        : undefined;
      const pprCanCache = pprConfig.enabled && !pprBypassReason;
      const pprCacheKey = pprCanCache
        ? getPPRShellCacheKey(url, farmLocaleResolution?.locale)
        : null;
      if (pprConfig.enabled && pprBypassReason) {
        emitFarmEvent({ type: "ppr.shell.bypass", route: pathname, reason: pprBypassReason });
        emitFarmEvent({ type: "cache.bypass", route: pathname, reason: pprBypassReason });
        if (pprBypassReason === "refresh") {
          emitFarmEvent({ type: "ppr.refresh.start", route: pathname });
        }
      }
      if (pprCacheKey) {
        const cachedPPRShell = await getCachedPPRShell(pprCacheKey);
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
              "x-farm-preload-buffered": "1",
              ...(farmFontPreloadHeader ? { "Link": farmFontPreloadHeader } : {}),
              ...getPPRHeaders("hit", pprConfig),
            },
          }), middlewareHeaders);
        }
        emitFarmEvent({ type: "ppr.shell.miss", route: pathname, key: pprCacheKey });
      }

      // Get the page component and metadata
      let PageComponent = route.module.default;
      let pageStatus = 200;
      const pageMetadata = route.module.metadata || {};
      
      // Get applicable layouts for this page
      const applicableLayouts = getApplicableLayouts(routePathname);
      const shouldHydrateLayout = applicableLayouts.some(
        (layout) => layout.shouldHydrate === true,
      );
      const hydrationStrategies = [
        ...(route.shouldHydrate && route.islandStrategy ? [route.islandStrategy] : []),
        ...applicableLayouts.flatMap((layout) =>
          layout.shouldHydrate && layout.islandStrategy ? [layout.islandStrategy] : [],
        ),
      ];
      const hydrationIslandStrategy = hydrationStrategies.every(
        (strategy) => strategy === hydrationStrategies[0],
      )
        ? (hydrationStrategies[0] || "load")
        : "load";
      const selectedRouteSlots = matchRouteSlots(
        routePathname,
        request.headers.get("x-farm-intercept-from"),
      );
      
      if (PageComponent) {
        // Parse search params - make it a resolved Promise for async components
        const searchParamsObj = Object.fromEntries(url.searchParams.entries());
        
        // Render the page component
        const routeContext = hasConfiguredRouteContext
          ? await resolveFarmRouteContext(farmResolvedRuntimeConfig, {
              request,
              params,
              search: searchParamsObj,
              path: pathname,
            })
          : undefined;
        const rawPageProps = withFarmRouteContext(
          {
            params,
            searchParams: Promise.resolve(searchParamsObj),
            path: pathname,
            ...(middlewareData?.size ? { middleware: { data: middlewareData } } : {}),
          },
          routeContext,
        );
        // Generated programmatic route modules consume app context from the
        // public context prop while source-created modules read the symbol
        // carrier above. Expose it only while resolving server route data.
        if (route.module.__farmResolveRouteProps && routeContext !== undefined) {
          Object.defineProperty(rawPageProps, "context", {
            value: routeContext,
            enumerable: true,
            configurable: true,
          });
        }
        let pageProps;
        try {
          // Resolve top-level route state before starting the HTTP stream so
          // redirects, notFound(), and failures keep their real status. Route
          // data may still contain explicit defer() values for nested Suspense.
          pageProps = route.module.__farmResolveRouteProps
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
          if (
            route.module.__farmResolveRouteProps &&
            routeContext !== undefined &&
            pageProps.context === routeContext
          ) {
            const { context: _routeContext, ...renderPageProps } = pageProps;
            pageProps = renderPageProps;
          }
        } catch (routeStateError) {
          if (isFarmRedirectError(routeStateError)) throw routeStateError;

          const routeComponents = route.module.__farmRouteComponents;
          const routeStateProps = {
            ...rawPageProps,
            search: searchParamsObj,
            searchParams: Promise.resolve(searchParamsObj),
            error: routeStateError,
          };
          if (isFarmNotFoundError(routeStateError) && routeComponents?.notFound) {
            pageStatus = 404;
            PageComponent = routeComponents.notFound;
            pageProps = routeStateProps;
          } else if (routeComponents?.error) {
            pageStatus = 500;
            PageComponent = routeComponents.error;
            pageProps = routeStateProps;
          } else {
            throw routeStateError;
          }
        }

        const renderedRouteSlots = await Promise.all(
          selectedRouteSlots.map(async function(slot) {
            const slotContext = hasConfiguredRouteContext
              ? await resolveFarmRouteContext(farmResolvedRuntimeConfig, {
                  request,
                  params: slot.params,
                  search: searchParamsObj,
                  path: pathname,
                })
              : undefined;
            const rawSlotProps = withFarmRouteContext(
              {
                params: slot.params,
                searchParams: Promise.resolve(searchParamsObj),
                path: pathname,
                ...(middlewareData?.size ? { middleware: { data: middlewareData } } : {}),
              },
              slotContext,
            );
            if (slot.module.__farmResolveRouteProps && slotContext !== undefined) {
              Object.defineProperty(rawSlotProps, "context", {
                value: slotContext,
                enumerable: true,
                configurable: true,
              });
            }

            const slotSchemas = slot.module.__farmRouteParsesProps
              ? {}
              : slot.module.__farmRouteSchemas || {};
            let slotProps = slot.module.__farmResolveRouteProps
              ? await slot.module.__farmResolveRouteProps(rawSlotProps)
              : {
                  ...rawSlotProps,
                  params: slotSchemas.params?.parse
                    ? slotSchemas.params.parse(slot.params)
                    : slot.params,
                  search: slotSchemas.search?.parse
                    ? slotSchemas.search.parse(searchParamsObj)
                    : searchParamsObj,
                  searchParams: Promise.resolve(
                    slotSchemas.search?.parse
                      ? slotSchemas.search.parse(searchParamsObj)
                      : searchParamsObj,
                  ),
                };
            if (
              slot.module.__farmResolveRouteProps &&
              slotContext !== undefined &&
              slotProps.context === slotContext
            ) {
              const { context: _slotContext, ...renderSlotProps } = slotProps;
              slotProps = renderSlotProps;
            }

            return { ...slot, props: slotProps };
          }),
        );
        const clientMiddleware = middlewareData?.size
          ? { data: Object.fromEntries(middlewareData) }
          : undefined;
        const clientPageProps = {
          params: pageProps.params,
          search: pageProps.search ?? searchParamsObj,
          searchParams: pageProps.search ?? searchParamsObj,
          ...("data" in pageProps ? { data: pageProps.data } : {}),
          ...(pageProps.__farmCanonicalPath
            ? { __farmCanonicalPath: pageProps.__farmCanonicalPath }
            : {}),
          ...(pageProps.__farmRoutePropsResolved
            ? { __farmRoutePropsResolved: true }
            : {}),
          path: pathname,
          ...(clientMiddleware ? { middleware: clientMiddleware } : {}),
        };
        const routeSlotPayload = renderedRouteSlots.map(function(slot) {
          return {
            name: slot.name,
            ownerPattern: slot.ownerPattern,
            pattern: slot.pattern,
            containerId: slot.containerId,
            interception: slot.interception,
            fallback: slot.fallback,
            props: {
              params: slot.props.params,
              search: slot.props.search || searchParamsObj,
              searchParams: slot.props.search || searchParamsObj,
              ...("data" in slot.props ? { data: slot.props.data } : {}),
              path: pathname,
              ...(clientMiddleware ? { middleware: clientMiddleware } : {}),
            },
          };
        });
        
        const renderPageElement = async () => {
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

            pageElement = React.createElement(
              "div",
              {
                id: "__farm_page__",
                "data-farm-segment": "page",
                "data-farm-client": route.shouldHydrate ? "true" : "false",
                ...(shouldHydrateLayout
                  ? { "data-farm-layout-client": "true" }
                  : {}),
                "data-farm-island": "page",
                "data-farm-island-strategy": hydrationIslandStrategy,
              },
              pageElement,
            );

            // Wrap with layouts (from innermost to outermost)
            // Layouts are sorted by depth (root first), so we process in reverse
            let wrappedElement = pageElement;
            for (let i = applicableLayouts.length - 1; i >= 0; i--) {
              const layout = applicableLayouts[i];
              const LayoutComponent = layout.module.default;
              if (LayoutComponent) {
                const slotProps = {};
                for (const slot of renderedRouteSlots) {
                  if (slot.ownerPattern !== layout.pattern) continue;
                  slotProps[slot.name] = React.createElement(
                    "div",
                    {
                      id: slot.containerId,
                      "data-farm-route-slot": slot.name,
                      "data-farm-slot-owner": slot.ownerPattern,
                    },
                    React.createElement(slot.module.default, slot.props),
                  );
                }
                wrappedElement = React.createElement(LayoutComponent, {
                  children: wrappedElement,
                  params,
                  ...slotProps,
                });
                wrappedElement = React.createElement(
                  "div",
                  {
                    "data-farm-layout-boundary": "true",
                    "data-farm-layout-pattern": layout.pattern,
                    style: { display: "contents" },
                  },
                  wrappedElement,
                );
              }
            }

          return renderFarmElement(ReactDOMServer, wrappedElement);
        };
        const renderedPage = ${
          hasMiddlewareRuntime
            ? `await _runWithMiddlewareData(middlewareData, () =>
          _runWithMiddlewareContext(middlewareContext, renderPageElement)
        )`
            : "await renderPageElement()"
        };
        
        // Collect static and generated metadata from layouts and page.
        // Later entries override earlier entries, matching the development renderer.
        let mergedMetadata = {};
        for (const layout of applicableLayouts) {
          mergedMetadata = mergeMetadata(mergedMetadata, layout.module.metadata);
          if (typeof layout.module.generateMetadata === "function") {
            mergedMetadata = mergeMetadata(
              mergedMetadata,
              await layout.module.generateMetadata({ params: pageProps.params }),
            );
          }
        }
        mergedMetadata = mergeMetadata(mergedMetadata, pageMetadata);
        if (typeof route.module.generateMetadata === "function") {
          mergedMetadata = mergeMetadata(
            mergedMetadata,
            await route.module.generateMetadata(pageProps),
          );
        }

        for (const kind of ["opengraph", "twitter"]) {
          const imageMatch = getMatchingMetadataImage(routePathname, kind);
          if (imageMatch) {
            mergedMetadata = addMetadataImageReference(
              mergedMetadata,
              createMetadataImageReference(imageMatch, farmLocaleResolution?.locale),
            );
          }
        }

        const renderedMetadata = renderMetadataHead(mergedMetadata);
        const title = renderedMetadata.title;
        const metaTags = renderedMetadata.tags;
        const hasFavicon = renderedMetadata.hasFavicon;

        const hasPrivateRequestHeaders = hasPrivateFarmRequestHeaders(
          request,
          farmLocaleResolution,
        );
        const hasRequestScopedRender = Boolean(
          pageStatus >= 400 ||
          request.headers.get("x-farm-intercept-from") ||
          hasPrivateRequestHeaders ||
          hasConfiguredRouteContext ||
          middlewareData?.size ||
          middlewareContext?.size
        );
        const sharedCacheControl = getRouteSharedCacheControl(route.module, pprCanCache);
        const responseHeaders = {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": renderedPage.stream || hasRequestScopedRender || !sharedCacheControl
            ? "private, no-store"
            : sharedCacheControl,
          ...(farmFontPreloadHeader ? { "Link": farmFontPreloadHeader } : {}),
          ...(pprConfig.enabled ? getPPRHeaders(pprCanCache ? "miss" : "bypass", pprConfig) : {}),
        };
        const farmI18nSnapshot = getFarmI18nSnapshot();
        let html = renderedPage.html;
        
        // Check if the layout already rendered a full HTML document
        const trimmedHtml = (html !== undefined ? html : renderedPage.shellHtml || "").trim();
        const hasFullDocument = trimmedHtml.startsWith('<html') || trimmedHtml.startsWith('<!DOCTYPE');

        // Stream a suspended body as soon as React's shell is ready. Full-document
        // layouts, localized documents, and cacheable PPR shells still use the
        // buffered path because they require whole-document transformation.
        if (
          pageStatus === 200 &&
          renderedPage.stream &&
          !hasFullDocument &&
          !farmI18nSnapshot &&
          !pprCacheKey
        ) {
          const farmThemeDocument = createFarmThemeDocumentParts(
            farmThemeConfig,
            farmResolvedRuntimeConfig.basePath,
            getFarmTheme(request)
          );
          const streamPrefix = '<!DOCTYPE html>\\n<html lang="en">\\n<head>\\n' +
            farmThemeDocument.head + '\\n' +
            '  <meta charset="utf-8">\\n' +
            '  <meta name="viewport" content="width=device-width, initial-scale=1">\\n' +
            (hasFavicon ? '' : '  <link rel="icon" href="data:,">\\n') +
            '  <title>' + title + '</title>' + metaTags + '\\n' +
            '  <link rel="stylesheet" href="/__farm_client_css_href__">\\n' +
            '  <link rel="modulepreload" href="/farm-client.js">\\n' +
            renderFarmRendererHydrationScript() + '\\n' +
            '</head>\\n<body>\\n  <div id="root">';
          const streamSuffix = '</div>\\n' +
            '  ' + renderFarmClientBootstrapScript(
              pageProps.__farmCanonicalPath,
              routeSlotPayload,
              clientPageProps
            ) + '\\n' +
            '  <script type="module" src="/farm-client.js"></script>\\n' +
            '</body>\\n</html>';
          const themedStreamPrefix = streamPrefix.replace(
            '<html lang="en">',
            '<html lang="en"' + farmThemeDocument.attributes + '>'
          );
          const streamedDocument = createFarmDocumentStream(
            renderedPage.stream,
            themedStreamPrefix,
            streamSuffix,
            function() {
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
                status: pageStatus,
                durationMs: Date.now() - requestStartTime,
              });
            }
          );
          return applyProductionMiddlewareHeaders(new Response(streamedDocument, {
            status: pageStatus,
            headers: { ...responseHeaders, "x-farm-preload-streaming": "1" },
          }), middlewareHeaders);
        }

        if (html === undefined) {
          html = await new Response(renderedPage.stream).text();
          if (renderedPage.streamErrors.length > 0) {
            throw renderedPage.streamErrors[0];
          }
        }
        
        let fullHtml;
        if (hasFullDocument) {
          // Layout provides full HTML structure - inject CSS and client script
          fullHtml = html
            // Inject CSS link after opening head tag or first meta tag
            .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/__farm_client_css_href__">')
            .replace(/<\\/head>/i, renderFarmRendererHydrationScript() + '\\n</head>')
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
            .replace(
              /<\\/body>/i,
              '  ' + renderFarmClientBootstrapScript(
                pageProps.__farmCanonicalPath,
                routeSlotPayload,
                clientPageProps
              ) + '\\n' +
                '  <script type="module" src="/farm-client.js"></script>\\n</body>',
            );
          
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
  <link rel="stylesheet" href="/__farm_client_css_href__">
  \${renderFarmRendererHydrationScript()}
</head>
<body>
  <div id="root">\${html}</div>
  \${renderFarmClientBootstrapScript(pageProps.__farmCanonicalPath, routeSlotPayload, clientPageProps)}
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`;
        }
        fullHtml = applyFarmI18nDocument(fullHtml, pathname, farmI18nSnapshot);
        fullHtml = applyFarmThemeDocument(
          fullHtml,
          farmThemeConfig,
          farmResolvedRuntimeConfig.basePath,
          getFarmTheme(request)
        );

        if (pageStatus === 200 && pprCacheKey && request.method.toUpperCase() !== "HEAD") {
          await pprShellCache.setAsync(
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
          status: pageStatus,
          durationMs: Date.now() - requestStartTime,
        });

        return applyProductionMiddlewareHeaders(new Response(
          fullHtml,
          { 
            status: pageStatus,
            headers: { ...responseHeaders, "x-farm-preload-buffered": "1" }
          }
        ), middlewareHeaders);
      }
    } catch (error) {
      if (isFarmRedirectError(error)) {
        const redirect = getFarmRedirectError(error);
        const redirectUrl =
          farmLocaleResolution?.locale &&
          redirect.url.startsWith("/") &&
          !redirect.url.startsWith("//")
            ? localizeFarmHref(
                redirect.url,
                farmLocaleResolution.locale,
                farmI18nConfig
              )
            : redirect.url;
        emitFarmEvent({
          type: "route.redirect",
          from: pathname,
          to: redirectUrl,
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
            Location: redirectUrl,
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
      const errorStatus = resolveDefaultErrorStatus(error);
      const errorStatusText = getDefaultErrorStatusText(errorStatus);

      const errorBoundaryMatch = getMatchingErrorBoundary(routePathname);
      if (errorBoundaryMatch?.route.module?.default) {
        try {
          const searchParamsObj = Object.fromEntries(url.searchParams.entries());
          const ErrorComponent = errorBoundaryMatch.route.module.default;
          let errorElement = React.createElement(ErrorComponent, {
            error,
            reset: function() {},
            params,
            search: searchParamsObj,
            searchParams: Promise.resolve(searchParamsObj),
            path: pathname,
            ...(middlewareData?.size ? { middleware: { data: middlewareData } } : {}),
          });

          const applicableLayouts = getApplicableLayouts(routePathname);
          for (let i = applicableLayouts.length - 1; i >= 0; i--) {
            const LayoutComponent = applicableLayouts[i].module.default;
            if (LayoutComponent) {
              errorElement = React.createElement(LayoutComponent, {
                children: errorElement,
                params,
              });
            }
          }

          const renderErrorElement = () =>
            renderFarmElementToString(ReactDOMServer, errorElement);
          const errorHtml = ${
            hasMiddlewareRuntime
              ? `await _runWithMiddlewareData(middlewareData, () =>
            _runWithMiddlewareContext(middlewareContext, renderErrorElement)
          )`
              : "await renderErrorElement()"
          };
          const errorDocument = applyFarmThemeDocument(
            applyFarmI18nDocument(
              createFarmErrorDocument(errorHtml, "Application Error"),
              pathname,
              getFarmI18nSnapshot()
            ),
            farmThemeConfig,
            farmResolvedRuntimeConfig.basePath,
            getFarmTheme(request)
          );
          emitFarmEvent({
            type: "render.complete",
            route: pathname,
            pathname,
            status: errorStatus,
            durationMs: Date.now() - requestStartTime,
          });
          return applyProductionMiddlewareHeaders(new Response(errorDocument, {
            status: errorStatus,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "private, no-store",
              "x-farm-preload-buffered": "1",
            },
          }), middlewareHeaders);
        } catch (boundaryError) {
          console.error("Route error boundary failed:", boundaryError);
        }
      }

      const fallbackHtml = createDefaultErrorMarkup({
        statusCode: errorStatus,
        statusText: errorStatusText,
        requestPath: pathname,
        method: request.method,
        development: false,
        mode: "production",
      });
      const fallbackDocument = applyFarmThemeDocument(
        applyFarmI18nDocument(
          createFarmErrorDocument(
            fallbackHtml,
            errorStatus + " - " + errorStatusText
          ),
          pathname,
          getFarmI18nSnapshot()
        ),
        farmThemeConfig,
        farmResolvedRuntimeConfig.basePath,
        getFarmTheme(request)
      );
      return applyProductionMiddlewareHeaders(new Response(
        fallbackDocument,
        {
          status: errorStatus,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store",
            "x-farm-preload-buffered": "1",
          },
        }
      ), middlewareHeaders);
    }
  }

  // 404 fallback - render proper HTML page
  emitFarmEvent({ type: "route.notFound", pathname });
  try {
    // Default 404 page component
    function Default404Page() {
      return React.createElement(React.Fragment, null,
        React.createElement("style", null, ${JSON.stringify(DEFAULT_NOT_FOUND_STYLES)}),
        React.createElement("main", {
          className: "farm-default-not-found",
          "aria-labelledby": "farm-default-not-found-title",
          "aria-describedby": "farm-default-not-found-description",
        },
          React.createElement("div", { className: "farm-default-not-found__content" },
            React.createElement("h1", {
              id: "farm-default-not-found-title",
              className: "farm-default-not-found__code",
            }, "404"),
            React.createElement("p", {
              id: "farm-default-not-found-description",
              className: "farm-default-not-found__description",
            }, "Not found"),
            React.createElement("a", {
              className: "farm-default-not-found__home",
              href: "/",
            }, "GO HOME")
          )
        )
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
    
    const html = await ReactDOMServer.renderToString(notFoundElement);
    
    // Check if layout provides full HTML document
    const trimmedHtml = html.trim();
    const hasFullDocument = trimmedHtml.startsWith('<html') || trimmedHtml.startsWith('<!DOCTYPE');
    
    let fullHtml;
    if (hasFullDocument) {
      fullHtml = html
        .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/__farm_client_css_href__">')
        .replace(/<\\/head>/i, renderFarmRendererHydrationScript() + '\\n</head>')
        .replace(
          /<\\/body>/i,
          '  ' + renderFarmClientBootstrapScript() + '\\n' +
            '  <script type="module" src="/farm-client.js"></script>\\n</body>',
        );
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
  <link rel="stylesheet" href="/__farm_client_css_href__">
  <title>404 - Page Not Found</title>
  \${renderFarmRendererHydrationScript()}
</head>
<body>
  <div id="root">\${html}</div>
  \${renderFarmClientBootstrapScript()}
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`;
    }
    fullHtml = applyFarmI18nDocument(fullHtml, pathname, getFarmI18nSnapshot());
    fullHtml = applyFarmThemeDocument(
      fullHtml,
      farmThemeConfig,
      farmResolvedRuntimeConfig.basePath,
      getFarmTheme(request)
    );
    
    emitFarmEvent({
      type: "render.complete",
      route: pathname,
      pathname,
      status: 404,
      durationMs: Date.now() - requestStartTime,
    });

    return applyProductionMiddlewareHeaders(new Response(fullHtml, {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "x-farm-preload-buffered": "1",
      }
    }), middlewareHeaders);
  } catch (error) {
    console.error("404 render error:", error);
    const fallbackDocument = applyFarmThemeDocument(
      \`<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Page Not Found</h1><p>The page \${pathname} doesn't exist.</p><a href="/">Go Home</a></body></html>\`,
      farmThemeConfig,
      farmResolvedRuntimeConfig.basePath,
      getFarmTheme(request)
    );
    return applyProductionMiddlewareHeaders(new Response(
      fallbackDocument,
      {
        status: 404,
        headers: { "Content-Type": "text/html", "x-farm-preload-buffered": "1" },
      }
    ), middlewareHeaders);
  }
  ${
    hasMiddlewareRuntime
      ? `
  };
  return request === requestBeforeMiddleware
    ? runResolvedRequest()
    : _runWithCurrentRequest(request, runResolvedRequest);
  `
      : ""
  }
}

async function handleFarmPluginRequest(request, runtimeOptions) {
  if (!farmPluginRuntime || runtimeOptions.kind !== "page") {
    return handleFarmRequest(request);
  }

  const pathname = runtimeOptions.route?.pathname || new URL(request.url).pathname;
  const routePattern = runtimeOptions.route?.pattern || null;
  const params = runtimeOptions.route?.params || {};
  const layouts = getApplicableLayouts(getFarmRoutePathname(pathname));

  await farmPluginRuntime.runHookParallel("beforeRouteMatch", {
    pathname,
    method: request.method,
  });
  await farmPluginRuntime.runHookParallel("afterRouteMatch", {
    pathname,
    matched: Boolean(routePattern),
    routePattern,
    params,
    layoutPatterns: layouts.map((layout) => layout.pattern),
  });

  const renderPayload = {
    pathname,
    method: request.method,
    routePattern,
    params,
  };
  await farmPluginRuntime.runHookParallel("beforeRender", renderPayload);

  const response = await handleFarmRequest(request);
  if (
    !hasFarmPluginHTMLTransforms ||
    !response.headers.get("content-type")?.toLowerCase().includes("text/html")
  ) {
    return response;
  }

  let html = await response.text();
  html = await farmPluginRuntime.runHookSerial("transformHTML", html);
  html = await farmPluginRuntime.runHookSerial("afterRender", html, renderPayload);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("x-farm-preload-streaming");
  headers.set("x-farm-preload-buffered", "1");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function applyFarmPreloadBudget(response, pathname) {
  const headers = new Headers(response.headers);
  const linkHeader = headers.get("Link") || "";
  const isHtml = headers.get("Content-Type")?.toLowerCase().includes("text/html");
  const isStreaming = headers.get("x-farm-preload-streaming") === "1";
  const isBuffered = headers.get("x-farm-preload-buffered") === "1";
  headers.delete("x-farm-preload-streaming");
  headers.delete("x-farm-preload-buffered");

  if (!isHtml) {
    if (!isStreaming && !isBuffered) return response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (isStreaming || !isBuffered || response.body === null) {
    const managed = manageFarmLinkHeaderPreloads(linkHeader, farmPreloadConfig);
    if (managed.value) headers.set("Link", managed.value);
    else headers.delete("Link");
    reportFarmPreloadWarnings(managed.warnings, "route " + pathname);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  const managed = manageFarmDocumentPreloads(html, linkHeader, farmPreloadConfig);
  if (managed.linkHeader) headers.set("Link", managed.linkHeader);
  else headers.delete("Link");
  if (managed.html !== html) headers.delete("Content-Length");
  reportFarmPreloadWarnings(managed.warnings, "route " + pathname);
  return new Response(managed.html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Export as Web Standard fetch API
export async function fetch(request, context) {
  const healthResponse = await farmProductionLifecycle.handleHealthRequest(request);
  if (healthResponse) return healthResponse;

  return farmProductionLifecycle.runRequest(
    () =>
      runWithFarmRequestSpan(request, async () => {
        const runtimeOptions = farmPluginRuntime ? getFarmPluginRequestOptions(request) : null;
        const runRequest = () => farmPluginRuntime
          ? farmPluginRuntime.runRuntimeRequest(
              request,
              (runtimeRequest) =>
                _runWithCurrentRequest(runtimeRequest, () =>
                  handleFarmPluginRequest(runtimeRequest, runtimeOptions)
                ),
              {
                ...runtimeOptions,
                waitUntil: typeof context?.waitUntil === "function"
                  ? context.waitUntil.bind(context)
                  : undefined,
              },
            )
          : handleFarmRequest(request);

        const response = await _runWithCurrentRequest(request, () =>
          _runWithAfterRequest(request, runRequest, context),
        );
        const pathname = new URL(request.url).pathname;
        return applyFarmPreloadBudget(applyConfiguredResponseHeaders(response, pathname), pathname);
      }),
    {
      onResponseFinished: typeof context?.onResponseFinished === "function"
        ? context.onResponseFinished
        : undefined,
    },
  );
}
export default { fetch, lifecycle: farmProductionLifecycle };
  `.trim();
}

/**
 * Build with Nitro using virtual bundle
 * Routes are now bundled in the SSR entry, so we just need to wrap the handler
 */
function matchesConfiguredRoute(source: string, pathname: string): boolean {
  const sourceSegments = source.split("/").filter(Boolean);
  const pathnameSegments = pathname.split("/").filter(Boolean);
  let pathnameIndex = 0;

  for (const sourceSegment of sourceSegments) {
    if (sourceSegment === "*" || /^:[^/]+\*$/.test(sourceSegment)) return true;

    const pathnameSegment = pathnameSegments[pathnameIndex];
    if (/^:[^/]+\?$/.test(sourceSegment)) {
      if (pathnameSegment !== undefined) pathnameIndex++;
      continue;
    }
    if (pathnameSegment === undefined) return false;
    if (!sourceSegment.startsWith(":") && sourceSegment !== pathnameSegment) return false;
    pathnameIndex++;
  }

  return pathnameIndex === pathnameSegments.length;
}

function getPrerenderRouteHeaders(
  pathname: string,
  configuredHeaderRoutes: UniversalConfiguredHeaderRoute[],
): Record<string, string> {
  const headers: Record<string, string> = {
    "cache-control": "public, max-age=0, must-revalidate",
  };
  for (const route of configuredHeaderRoutes) {
    if (!matchesConfiguredRoute(route.source, pathname)) continue;
    for (const header of route.headers) headers[header.key.toLowerCase()] = header.value;
  }
  return headers;
}

function escapeRoutePattern(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.*]/g, "\\$&");
}

function middlewarePatternMatches(pattern: string | RegExp, pathname: string): boolean {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(pathname);
  }

  if (pattern === "*" || pattern === "/(.*)") return true;
  if (pattern.endsWith("(.*)")) {
    const prefix = pattern.slice(0, -4);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }

  const segments = pattern.split("/").filter(Boolean);
  if (segments.length === 0) return pathname === "/";
  const expression = segments
    .map((segment) => {
      if (segment === "**") return "(?:/.*)?";
      if (segment === "*") return "/[^/]+";
      if (
        /^:[^/]+\*$/.test(segment) ||
        /^\[\.\.\..+\]$/.test(segment) ||
        /^\[\[\.\.\..+\]\]$/.test(segment)
      ) {
        return "(?:/.*)?";
      }
      if (/^:[^/]+\+$/.test(segment)) return "/.+";
      if (/^:[^/]+\?$/.test(segment)) return "(?:/[^/]+)?";
      if (segment.startsWith(":") || /^\[.+\]$/.test(segment)) return "/[^/]+";
      return `/${escapeRoutePattern(segment).replace(/\\\*/g, "[^/]*")}`;
    })
    .join("");
  return new RegExp(`^${expression}/?$`).test(pathname);
}

function configMiddlewareMayHandlePath(
  config: ResolvedFarmConfig["middleware"],
  pathname: string,
): boolean {
  if (!hasFarmMiddlewareConfig(config)) return false;

  const entries = (Array.isArray(config) ? config : [config]) as Array<{
    matcher?: unknown | unknown[];
    exclude?: Array<string | RegExp>;
  }>;
  return entries.some((entry) => {
    if (entry.exclude?.some((pattern) => middlewarePatternMatches(pattern, pathname))) {
      return false;
    }

    if (!entry.matcher) return true;
    const matchers = Array.isArray(entry.matcher) ? entry.matcher : [entry.matcher];
    return matchers.some((matcher) => {
      // A request-aware matcher cannot be proven safe at build time.
      if (typeof matcher === "function") return true;
      return (
        (typeof matcher === "string" || matcher instanceof RegExp) &&
        middlewarePatternMatches(matcher, pathname)
      );
    });
  });
}

function appMiddlewareMayHandlePath(
  middlewareRoutes: readonly UniversalMiddlewareRoute[],
  pathname: string,
): boolean {
  return middlewareRoutes.some((route) => {
    if (route.path === "/") return true;
    return (
      middlewarePatternMatches(route.path, pathname) ||
      middlewarePatternMatches(`${route.path}/**`, pathname)
    );
  });
}

function routePatternSpecificity(pattern: string): number {
  return pattern
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => {
      if (segment === "**" || segment.startsWith("[[...")) return score + 1;
      if (segment === "*" || segment.startsWith("[...") || /:\w+\*$/.test(segment)) {
        return score + 10;
      }
      if (/^\[.+\]$/.test(segment) || segment.startsWith(":")) return score + 50;
      return score + 100;
    }, 0);
}

function getEffectiveRouteRule(config: ResolvedFarmConfig, pathname: string) {
  return Object.entries(config.routeRules)
    .filter(([pattern]) => middlewarePatternMatches(pattern, pathname))
    .sort(([left], [right]) => routePatternSpecificity(left) - routePatternSpecificity(right))
    .reduce<Record<string, unknown>>((resolved, [, rule]) => Object.assign(resolved, rule), {});
}

function getManifestPageEntry(
  manifest: FarmRouteRuntimeManifest,
  pathname: string,
): FarmRouteRuntimeManifestEntry | undefined {
  return manifest.routes
    .filter((entry) => entry.kind === "page" && middlewarePatternMatches(entry.pattern, pathname))
    .sort(
      (left, right) =>
        routePatternSpecificity(right.pattern) - routePatternSpecificity(left.pattern),
    )[0];
}

function getPhysicalPrerenderBypassReason(options: {
  config: ResolvedFarmConfig;
  middlewareRoutes: readonly UniversalMiddlewareRoute[];
  routeRuntimeManifest: FarmRouteRuntimeManifest;
  redirectSources: readonly string[];
  rewriteSources: readonly string[];
  pathname: string;
}): string | undefined {
  const {
    config,
    middlewareRoutes,
    routeRuntimeManifest,
    redirectSources,
    rewriteSources,
    pathname,
  } = options;
  if (config.i18n.enabled) return "request-sensitive i18n";
  if (redirectSources.some((source) => middlewarePatternMatches(source, pathname))) {
    return "redirect";
  }
  if (rewriteSources.some((source) => middlewarePatternMatches(source, pathname))) {
    return "rewrite";
  }
  if (appMiddlewareMayHandlePath(middlewareRoutes, pathname)) return "app middleware";
  if (configMiddlewareMayHandlePath(config.middleware, pathname)) return "configured middleware";
  if (hasCustomFarmRouteContext(config)) return "request context";
  if (hasFarmServerRuntimePlugins(config)) return "server runtime plugin";

  const manifestEntry = getManifestPageEntry(routeRuntimeManifest, pathname);
  if (manifestEntry?.rendering === "dynamic") return "dynamic runtime manifest";
  if (
    manifestEntry &&
    (manifestEntry.runtime !== "auto" ||
      Boolean(manifestEntry.regions?.length) ||
      manifestEntry.maxDuration !== undefined)
  ) {
    return "route runtime controls";
  }

  const routeRule = getEffectiveRouteRule(config, pathname);
  if (routeRule.prerender === false || routeRule.render === "dynamic" || routeRule.ssr === true) {
    return "dynamic route rule";
  }
  if (
    (routeRule.swr !== undefined && routeRule.swr !== false) ||
    (routeRule.isr !== undefined && routeRule.isr !== false)
  ) {
    return "runtime cache route rule";
  }

  return undefined;
}

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
  configuredHeaderRoutes: UniversalConfiguredHeaderRoute[],
  nitroRuntimeResultPromise: Promise<PromiseSettledResult<FarmNitroRuntime>>,
  pluginManager?: PluginManager,
) {
  // Nitro is only needed while producing the deployment artifact. Keeping the
  // import lazy prevents this build-only dependency from leaking into an
  // application's standalone server bundle through @farm.js/core's root entry.
  const [fs, nitroRuntimeResult] = await Promise.all([
    import("fs/promises"),
    nitroRuntimeResultPromise,
  ]);
  if (nitroRuntimeResult.status === "rejected") throw nitroRuntimeResult.reason;
  const nitro = nitroRuntimeResult.value;

  const isVercel = preset === "vercel" || preset === "vercel-edge";
  const isCloudflareWorker = preset === "cloudflare-module";
  const outputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const ssrOutputDir = path.join(root, distDir, "ssr");
  const imageRuntime = resolveImageRuntime(config, preset);
  const hasGeneratedMetadataImages = Array.from(routeManager.getMetadataImages().values()).some(
    (image) => image.sourceType === "module",
  );
  const useExternalMetadataImageRuntime = shouldUseExternalMetadataImageRuntime(
    preset,
    hasGeneratedMetadataImages,
  );
  const nitroRollupExternal = (id: string) =>
    (useExternalMetadataImageRuntime && id === "@vercel/og") || isNitroRollupExternal(id);
  const ssrExternalPackages = collectSSRExternalPackages(ssrBundle);
  const copiedRuntimePackages = new Set([
    ...(imageRuntime === "node" ? ["sharp"] : []),
    ...(useExternalMetadataImageRuntime ? ["@vercel/og"] : []),
  ]);
  // Nitro normally rebundles the Vite SSR graph so its bare dependencies are
  // deployable. Skip that duplicate pass only when Farm already knows how to
  // package every remaining external; otherwise retain Nitro's proven path.
  const isPrebuiltSSRCandidate =
    preset === "node-server" &&
    [...ssrExternalPackages].every((packageName) => copiedRuntimePackages.has(packageName));

  logger.info(`📦 Nitro output directory: ${outputDir}`);
  logger.info(`📦 SSR entry file: ${ssrEntryFile}`);
  logger.info(`📦 Preset: ${preset}`);

  const ssgCollectionPromise = routeManager.collectSSGPages();
  const middlewareRoutesPromise = discoverMiddlewareRoutes(getFarmAppDirectories(config));
  // Resolved config callbacks close over already-loaded arrays, so this does
  // not re-run user discovery or fetch mutable external configuration.
  const configuredResponseRoutesPromise = Promise.all([config.redirects(), config.rewrites()]);
  const farmWorkflows = await prepareFarmWorkflowsForNitro(config);
  const farmCron = await prepareFarmCronForNitro(config);
  const [{ ssg: ssgPages }, middlewareRoutes, [configuredRedirects, configuredRewrites]] =
    await Promise.all([
      ssgCollectionPromise,
      middlewareRoutesPromise,
      configuredResponseRoutesPromise,
    ]);
  const redirectSources = [
    ...routeManager.getRedirects().map((route) => route.source),
    ...configuredRedirects.map((route: RedirectConfig) => route.source),
  ];
  const rewriteSources = configuredRewrites.map((route: RewriteConfig) => route.source);
  const prerenderRoutes: string[] = [];
  const skippedPrerenderRoutes: Array<{ pathname: string; reason: string }> = [];
  for (const page of ssgPages) {
    // Revalidated pages keep their runtime/CDN stale-while-revalidate
    // behavior. Emitting them as public files would prevent the server from
    // ever regenerating them.
    if (page.revalidate !== undefined) continue;
    if (prerenderRoutes.includes(page.urlPath)) continue;

    const reason = getPhysicalPrerenderBypassReason({
      config,
      middlewareRoutes,
      routeRuntimeManifest,
      redirectSources,
      rewriteSources,
      pathname: page.urlPath,
    });
    if (reason) {
      skippedPrerenderRoutes.push({ pathname: page.urlPath, reason });
      continue;
    }
    prerenderRoutes.push(page.urlPath);
  }
  for (const skipped of skippedPrerenderRoutes) {
    logger.info(`↪ Keeping SSG route ${skipped.pathname} server-handled (${skipped.reason})`);
  }
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

  // The client build has fully settled by now (fonts merged, output
  // validated), so the stylesheet href baked into server code can carry the
  // content hash of the bytes browsers will actually receive. Substituting in
  // memory, before any consumer, covers the disk write below as well as the
  // prebuilt-SSR copies and prerendering that reuse this bundle directly.
  const clientCssHref = await resolveHashedClientCssHref(clientOutputDir);
  for (const output of Object.values(ssrBundle)) {
    if (output.type === "chunk" && output.code.includes(FARM_CLIENT_CSS_HREF_PLACEHOLDER)) {
      output.code = output.code.replaceAll(FARM_CLIENT_CSS_HREF_PLACEHOLDER, clientCssHref);
    }
  }

  // Write SSR bundle to disk
  await fs.mkdir(ssrOutputDir, { recursive: true });

  for (const [fileName, output] of Object.entries(ssrBundle)) {
    const filePath = path.join(ssrOutputDir, fileName);
    // Ensure parent directory exists for nested chunks and emitted assets.
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, output.type === "chunk" ? output.code : output.source);
  }

  // Create the Nitro event handler adapter. Nitro accepts plain event handler
  // functions, so keep this entry dependency-free for standalone output.
  const nitroEntryPath = path.join(ssrOutputDir, "nitro-entry.mjs");

  const nitroEntryCode = `
// Farm.js Nitro Entry
// This file adapts Farm's Web fetch handler to Nitro's event handler contract.

import { useNitroApp } from 'nitro/runtime'
import handler, { farmProductionLifecycle } from './${ssrEntryFile}'

export { farmProductionLifecycle }

const farmNitroApp = useNitroApp()
farmNitroApp.hooks.hook('close', () =>
  farmProductionLifecycle.close('production-server-closed')
)

function mergeVaryHeaders(target, source) {
  const values = new Set(
    [target.get('Vary'), source]
      .filter(Boolean)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  )

  if (values.size > 0) target.set('Vary', Array.from(values).join(', '))
}

function createResponseFinishedHook(event) {
  const nodeResponse = event.node?.res
  if (!nodeResponse || typeof nodeResponse.once !== 'function') return undefined

  return (callback) => {
    if (nodeResponse.writableEnded || nodeResponse.writableFinished) {
      queueMicrotask(callback)
      return
    }

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      nodeResponse.off('finish', finish)
      nodeResponse.off('close', finish)
      callback()
    }
    nodeResponse.once('finish', finish)
    nodeResponse.once('close', finish)
  }
}

// Export the event handler for Nitro
export default async function farmNitroEventHandler(event) {
  const response = await handler.fetch(event.req, {
    waitUntil: (promise) => event.waitUntil(promise),
    onResponseFinished: createResponseFinishedHook(event),
  })

  // Nitro records asset compression negotiation on the event response. Merge
  // Farm's cache signals there so H3 preserves both sets of Vary values.
  const farmVary = response.headers.get('Vary')
  if (farmVary) mergeVaryHeaders(event.res.headers, farmVary)
  return response
}
  `.trim();

  await fs.writeFile(nitroEntryPath, nitroEntryCode);
  const farmNodeServerEntryPath =
    preset === "node-server" ? path.join(ssrOutputDir, "farm-node-server-entry.mjs") : null;
  if (farmNodeServerEntryPath) {
    await fs.writeFile(
      farmNodeServerEntryPath,
      createFarmNodeServerEntry({
        nitroEntryFile: path.basename(nitroEntryPath),
        nodeHandlerModule: resolveNitroRuntimeDependency(root, "srvx/node"),
        server: config.server,
        websocketAdapterModule: resolveNitroRuntimeDependency(root, "crossws/adapters/node"),
      }),
    );
  }
  const prebuiltSSRPlugin = createExternalSSRBundlePlugin(
    nitroEntryPath,
    ssrOutputDir,
    ssrEntryFile,
  );
  const configuredNitroRouteRules = routeRulesToNitroRouteRules(config.routeRules);
  const prerenderNitroRouteRules = Object.fromEntries(
    prerenderRoutes.map((route) => {
      const configuredRule = configuredNitroRouteRules[route] || {};
      return [
        route,
        {
          ...configuredRule,
          prerender: true,
          headers: {
            ...getPrerenderRouteHeaders(route, configuredHeaderRoutes),
            ...configuredRule.headers,
          },
        },
      ];
    }),
  );

  let nitroConfig: NitroConfig = {
    preset,
    ...(farmNodeServerEntryPath ? { entry: farmNodeServerEntryPath } : {}),
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
    ...(prerenderRoutes.length > 0
      ? {
          prerender: {
            crawlLinks: false,
            failOnError: true,
            routes: prerenderRoutes,
          },
        }
      : {}),
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
      ...configuredNitroRouteRules,
      // Exact user rules must retain their runtime settings without replacing
      // the headers and prerender marker generated for a safe physical page.
      ...prerenderNitroRouteRules,
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
        ...(useExternalMetadataImageRuntime ? ["@vercel/og"] : []),
      ],
    },
    rollupConfig: {
      external: nitroRollupExternal,
      plugins:
        hasGeneratedMetadataImages && !useExternalMetadataImageRuntime
          ? [createMetadataImageWasmPlugin()]
          : [],
    },
    // Keep the public Nitro boolean intact for build hooks. It is translated to
    // Nitro's existing esbuild pass after hooks run, avoiding a second Terser pass.
    minify: true,
    sourceMap: false, // Skip sourcemaps for faster build
  };
  const initialSSRRebundleOptions = snapshotSSRRebundleOptions(nitroConfig);

  if (pluginManager) {
    nitroConfig = await pluginManager.runHookSerial("beforeNitroBuild", nitroConfig);
  }

  const expectedServerDir = path.join(outputDir, "server");
  const customRollupKeys = Object.keys(nitroConfig.rollupConfig || {}).filter(
    (key) => key !== "external" && key !== "plugins",
  );
  const configuredEsbuild = nitroConfig.esbuild?.options;
  const hasUnsupportedEsbuildOverrides = Boolean(
    configuredEsbuild?.include !== undefined ||
    configuredEsbuild?.exclude !== undefined ||
    configuredEsbuild?.loaders !== undefined ||
    configuredEsbuild?.sourceMap,
  );
  const hasLateBuildMutationConfig = Boolean(
    Object.keys(nitroConfig.hooks || {}).length > 0 ||
    (Array.isArray(nitroConfig.modules) ? nitroConfig.modules.some(Boolean) : nitroConfig.modules),
  );
  const hasUnsupportedSSRRebundleOverrides = !isDeepStrictEqual(
    initialSSRRebundleOptions,
    snapshotSSRRebundleOptions(nitroConfig),
  );
  const requestedBuilder = nitroConfig.builder ?? process.env.NITRO_BUILDER;
  const canReusePrebuiltSSR =
    isPrebuiltSSRCandidate &&
    nitroConfig.preset === "node-server" &&
    (requestedBuilder === undefined ||
      requestedBuilder === "rollup" ||
      requestedBuilder === "rolldown") &&
    nitroConfig.sourceMap === false &&
    !hasUnsupportedEsbuildOverrides &&
    !hasLateBuildMutationConfig &&
    !hasUnsupportedSSRRebundleOverrides &&
    nitroConfig.rollupConfig?.external === nitroRollupExternal &&
    !hasRollupPlugins(nitroConfig.rollupConfig?.plugins) &&
    customRollupKeys.length === 0 &&
    path.resolve(nitroConfig.output?.serverDir || "") === path.resolve(expectedServerDir) &&
    Boolean(
      nitroConfig.handlers?.some(
        (handler) => path.resolve(handler?.handler || "") === nitroEntryPath,
      ),
    );
  const selectRolldownBuilder =
    canReusePrebuiltSSR && requestedBuilder === undefined && (await canUseRolldownBuilder());
  if (selectRolldownBuilder) nitroConfig.builder = "rolldown";
  const useRolldownBuilder =
    canReusePrebuiltSSR && (nitroConfig.builder ?? process.env.NITRO_BUILDER) === "rolldown";

  const shouldMinify = nitroConfig.minify !== false;
  const configuredEsbuildOptions = nitroConfig.esbuild?.options || {};
  const resolvedEsbuildOptions = {
    ...configuredEsbuildOptions,
    // Function-name helpers are unsafe for provider scripts that serialize a
    // function with toString(); the helper is outside the emitted script scope.
    keepNames:
      configuredEsbuildOptions.keepNames ?? !(config.docs?.enabled && config.docs.adapter?.server),
  };
  const effectiveMinify = configuredEsbuildOptions.minify ?? shouldMinify;
  const useFarmEsbuildMinifier =
    effectiveMinify &&
    nitroConfig.sourceMap === false &&
    !hasUnsupportedEsbuildOverrides &&
    !hasLateBuildMutationConfig;
  const esbuildChunkMinifier = useFarmEsbuildMinifier
    ? createEsbuildChunkMinifyPlugin(resolvedEsbuildOptions)
    : null;
  if (canReusePrebuiltSSR) {
    const configuredRollupPlugins = nitroConfig.rollupConfig?.plugins;
    nitroConfig.rollupConfig = {
      ...nitroConfig.rollupConfig,
      plugins: [
        ...(Array.isArray(configuredRollupPlugins)
          ? configuredRollupPlugins
          : configuredRollupPlugins
            ? [configuredRollupPlugins]
            : []),
        prebuiltSSRPlugin,
      ],
    };
  }

  nitroConfig.minify = useFarmEsbuildMinifier ? false : shouldMinify;
  nitroConfig.esbuild = {
    ...nitroConfig.esbuild,
    options: {
      ...resolvedEsbuildOptions,
      minify: useFarmEsbuildMinifier ? false : configuredEsbuildOptions.minify,
      keepNames: resolvedEsbuildOptions.keepNames,
      legalComments: configuredEsbuildOptions.legalComments ?? "none",
    },
  };

  // Build with Nitro
  const nitroInstance = await nitro.createNitro(nitroConfig);
  if (farmNodeServerEntryPath) {
    // The custom entry is only for the final long-running Node server. Nitro
    // derives its prerenderer config from this config, so remove the override
    // and let the nitro-prerender preset provide appFetch/closePrerenderer.
    nitroInstance.hooks.hook("prerender:config", (prerendererConfig) => {
      delete prerendererConfig.entry;
    });
  }
  await nitro.prepare(nitroInstance);
  await nitro.copyPublicAssets(nitroInstance);
  if (prerenderRoutes.length > 0 && canReusePrebuiltSSR) {
    // The prerenderer builds and immediately imports a temporary server before
    // the final Node adapter exists. Materialize the same prebuilt SSR package
    // import for that temporary server so it can render the static routes.
    nitroInstance.hooks.hook("prerender:init", (prerenderer) => {
      if (useRolldownBuilder) {
        prerenderer.hooks.hook("rollup:before", (_nitro, rollupConfig) => {
          const rolldownConfig = rollupConfig as typeof rollupConfig & {
            inject?: unknown;
            jsx?: unknown;
          };
          delete rolldownConfig.inject;
          delete rolldownConfig.jsx;
        });
      }
      prerenderer.hooks.hook("compiled", async () => {
        const prerenderServerDir = path.join(outputDir, "server");
        await copyPrebuiltSSRBundle(
          ssrBundle,
          path.join(prerenderServerDir, FARM_SSR_OUTPUT_DIR),
          {},
          false,
          fs,
        );
        await registerPrebuiltSSRPackageImport(prerenderServerDir, ssrEntryFile, fs);
      });
    });
  }
  if (esbuildChunkMinifier || useRolldownBuilder) {
    // Register after Nitro and user hooks are prepared so the minifier is the
    // final renderChunk transform, matching Nitro's Terser ordering.
    nitroInstance.hooks.hook("rollup:before", (_nitro, rollupConfig) => {
      if (useRolldownBuilder) {
        // Nitro 3 alpha still emits transform options that this Rolldown API
        // rejects. The generated native Node adapter contains neither JSX nor
        // browser-global injections, so omit both without changing its output.
        const rolldownConfig = rollupConfig as typeof rollupConfig & {
          inject?: unknown;
          jsx?: unknown;
        };
        delete rolldownConfig.inject;
        delete rolldownConfig.jsx;
      }
      if (esbuildChunkMinifier) {
        const configuredPlugins = rollupConfig.plugins;
        rollupConfig.plugins = [
          ...(Array.isArray(configuredPlugins)
            ? configuredPlugins
            : configuredPlugins
              ? [configuredPlugins]
              : []),
          esbuildChunkMinifier,
        ];
      }
    });
  }
  if (prerenderRoutes.length > 0) {
    logger.info(`📄 Pre-rendering ${prerenderRoutes.length} SSG page(s)`);
    await nitro.prerender(nitroInstance);
  }
  await nitro.build(nitroInstance);
  await nitroInstance.close();

  const copyResults = await Promise.allSettled([
    canReusePrebuiltSSR
      ? copyPrebuiltSSRBundle(
          ssrBundle,
          path.join(outputDir, "server", FARM_SSR_OUTPUT_DIR),
          configuredEsbuildOptions,
          effectiveMinify,
          fs,
        )
      : Promise.resolve(),
    imageRuntime === "node"
      ? copySharpRuntime(config, root, path.join(outputDir, "server"), fs)
      : Promise.resolve(),
    useExternalMetadataImageRuntime
      ? copyMetadataImageRuntime(root, path.join(outputDir, "server"), fs)
      : Promise.resolve(),
  ]);
  const failedCopy = copyResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedCopy) throw failedCopy.reason;

  if (canReusePrebuiltSSR) {
    await registerPrebuiltSSRPackageImport(path.join(outputDir, "server"), ssrEntryFile, fs);
    logger.info("⚡ Reused Farm's prebuilt SSR bundle for the Node output");
  }
  if (useRolldownBuilder) {
    logger.info("⚡ Built the Node adapter with Rolldown");
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

async function copyPrebuiltSSRBundle(
  ssrBundle: OutputBundle,
  targetDir: string,
  configuredEsbuildOptions: NitroEsbuildOptions,
  minify: boolean,
  fs: typeof import("fs/promises"),
): Promise<void> {
  const {
    include: _include,
    exclude: _exclude,
    sourceMap: _sourceMap,
    loaders: _loaders,
    ...configuredTransformOptions
  } = configuredEsbuildOptions;
  const hasConfiguredTransforms = Object.keys(configuredTransformOptions).some(
    (option) => option !== "minify",
  );
  const transformOptions = createEsbuildTransformOptions(
    configuredEsbuildOptions,
    minify,
    "node18",
  );
  const transform = minify || hasConfiguredTransforms ? (await import("esbuild")).transform : null;

  await fs.rm(targetDir, { recursive: true, force: true });
  await Promise.all(
    Object.entries(ssrBundle).map(async ([fileName, output]) => {
      const targetPath = path.join(targetDir, fileName);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      if (output.type === "asset") {
        await fs.writeFile(targetPath, output.source);
        return;
      }

      let code = output.code;
      if (transform) {
        const result = await transform(code, {
          ...transformOptions,
          sourcefile: fileName,
        });
        code = result.code;
      }

      await fs.writeFile(targetPath, code);
    }),
  );
}

async function registerPrebuiltSSRPackageImport(
  serverDir: string,
  ssrEntryFile: string,
  fs: typeof import("fs/promises"),
): Promise<void> {
  const packagePath = path.join(serverDir, "package.json");
  const packageJSON = await fs
    .readFile(packagePath, "utf8")
    .then((contents) => JSON.parse(contents))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return { type: "module" };
      throw error;
    });
  const existingImports =
    packageJSON.imports && typeof packageJSON.imports === "object" ? packageJSON.imports : {};
  const outputEntry = `${FARM_SSR_OUTPUT_DIR}/${ssrEntryFile}`.replace(/\\/g, "/");

  packageJSON.imports = {
    ...existingImports,
    [FARM_SSR_PACKAGE_IMPORT]: `./${outputEntry}`,
  };
  await fs.mkdir(serverDir, { recursive: true });
  await fs.writeFile(packagePath, `${JSON.stringify(packageJSON, null, 2)}\n`);
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
    // Apply the header before the filesystem handler. `continue` lets Vercel
    // serve the matching file while preserving the immutable cache policy.
    createFarmVercelImmutableAssetRoute(config.basePath),
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
  await fs.cp(docsContentDir, bundledContentDir, {
    recursive: true,
    force: true,
  });
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
): Promise<void> {
  if (config.images.provider === "none") return;

  const projectRequire = createRequire(path.join(root, "package.json"));
  let sharpRequire = projectRequire;
  if (!resolvePackageJson(projectRequire, "sharp")) {
    try {
      // Applications are not required to depend on Sharp directly. Resolve
      // Farm's optional dependency from the installed framework entry when the
      // project dependency tree does not expose it.
      sharpRequire = createRequire(projectRequire.resolve("@farm.js/core"));
    } catch {
      // The existing missing-Sharp diagnostic below remains authoritative.
    }
  }
  const copiedPackages = new Map<string, string>();
  const packageCopies = new Map<string, Promise<void>>();
  const targetNodeModules = path.join(nitroFuncDir, "node_modules");

  function copyPackage(packageName: string, parentRequire: NodeJS.Require): Promise<void> {
    const activeCopy = packageCopies.get(packageName);
    if (activeCopy) return activeCopy;

    const packageCopy = copyPackageOnce(packageName, parentRequire);
    packageCopies.set(packageName, packageCopy);
    return packageCopy;
  }

  async function copyPackageOnce(
    packageName: string,
    parentRequire: NodeJS.Require,
  ): Promise<void> {
    const packageJsonPath = resolvePackageJson(parentRequire, packageName);
    if (!packageJsonPath) return;
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    const packageDir = path.dirname(packageJsonPath);
    const targetDir = path.join(targetNodeModules, ...packageName.split("/"));
    copiedPackages.set(packageName, String(packageJson.version || "*"));

    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    const packageRequire = createRequire(packageJsonPath);
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.optionalDependencies,
    };
    await Promise.all([
      fs.cp(packageDir, targetDir, {
        recursive: true,
        force: true,
        dereference: true,
        // Reflinks make native runtime packaging nearly metadata-only on
        // supporting filesystems and transparently fall back to byte copies.
        mode: fsConstants.COPYFILE_FICLONE,
      }),
      ...Object.keys(dependencies).map((dependency) => copyPackage(dependency, packageRequire)),
    ]);
  }

  await copyPackage("sharp", sharpRequire);
  if (!copiedPackages.has("sharp")) {
    throw new Error(
      "Farm image optimization requires sharp. Reinstall dependencies without omitting optional packages.",
    );
  }

  const functionPackagePath = path.join(nitroFuncDir, "package.json");
  const functionPackage = JSON.parse(await fs.readFile(functionPackagePath, "utf8"));
  functionPackage.dependencies = {
    ...functionPackage.dependencies,
    ...Object.fromEntries([...copiedPackages].sort(([left], [right]) => left.localeCompare(right))),
  };
  await fs.writeFile(functionPackagePath, JSON.stringify(functionPackage, null, 2));
  logger.info(`🖼️  Bundled Sharp image runtime (${copiedPackages.size} packages)`);
}

async function copyMetadataImageRuntime(
  root: string,
  nitroFuncDir: string,
  fs: typeof import("fs/promises"),
): Promise<void> {
  const projectRequire = createRequire(path.join(root, "package.json"));
  let runtimeRequire = projectRequire;
  let packageJsonPath = resolvePackageJson(runtimeRequire, "@vercel/og");

  if (!packageJsonPath) {
    try {
      runtimeRequire = createRequire(projectRequire.resolve("@farm.js/core"));
      packageJsonPath = resolvePackageJson(runtimeRequire, "@vercel/og");
    } catch {
      // The missing-runtime diagnostic below remains authoritative.
    }
  }

  if (!packageJsonPath) {
    throw new Error(
      "Generated metadata images require @vercel/og. Reinstall @farm.js/core with production dependencies.",
    );
  }

  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const packageDir = path.dirname(packageJsonPath);
  const targetDir = path.join(nitroFuncDir, "node_modules", "@vercel", "og");
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(packageDir, targetDir, {
    recursive: true,
    force: true,
    dereference: true,
    mode: fsConstants.COPYFILE_FICLONE,
  });

  const functionPackagePath = path.join(nitroFuncDir, "package.json");
  const functionPackage = JSON.parse(await fs.readFile(functionPackagePath, "utf8"));
  functionPackage.dependencies = {
    ...functionPackage.dependencies,
    "@vercel/og": String(packageJson.version || "0.11.1"),
  };
  await fs.writeFile(functionPackagePath, JSON.stringify(functionPackage, null, 2));
  logger.info("🖼️  Bundled generated metadata image runtime");
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
  await fs.cp(prismaClientDir, targetClientDir, {
    recursive: true,
    force: true,
  });
  await fs.cp(generatedClientDir, targetGeneratedDir, {
    recursive: true,
    force: true,
  });

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
