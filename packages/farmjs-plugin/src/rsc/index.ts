import { loadFarmDevModule, FarmDevEnvironmentError } from "@farm.js/core/plugin";
/**
 * Farm.js RSC Plugin
 *
 * Provides React Server Components support for Farm.js.
 * When enabled, this plugin:
 * - Configures three build environments (rsc, ssr, client)
 * - Generates virtual entry files for routing, rendering, and hydration
 * - Supports server actions when experimental.serverActions is true
 * - Integrates with @vitejs/plugin-rsc for core RSC transforms
 *
 * @example
 * ```ts
 * import { defineConfig } from '@farm.js/plugin/rsc'
 *
 * export default defineConfig({
 *   srcDir: 'src',
 *   experimental: {
 *     serverComponents: true,
 *     serverActions: true,
 *   },
 * })
 * ```
 */

import {
  parseAst,
  version as viteVersion,
  type ConfigEnv,
  type Plugin,
  type UserConfig,
} from "vite";
import { init as initModuleLexer, parse as parseModuleImports } from "es-module-lexer";
import type { FarmRscPluginOptions, EntryContext } from "./types.js";
import type { FarmServerActionsConfig } from "@farm.js/core/server-action-security";
import type { FarmAPIConfig } from "@farm.js/core/api";
import type { FarmMiddlewareConfig } from "@farm.js/core/middleware";
import type { FarmServerConfig } from "@farm.js/core/internal/production-runtime";
import type { FarmLayerEntry, ResolvedFarmLayer } from "@farm.js/core/server";
import { farmEnvironmentFunctionsPlugin } from "@farm.js/core/environment/vite";
import type { FarmCacheUserConfig } from "@farm.js/core/cache";
import type { FarmI18nUserConfig } from "@farm.js/core/i18n";
import {
  farmFontImportsPlugin,
  farmImageImportsPlugin,
  generateClientCachePersistenceCode,
  getPublicFarmImageConfig,
  resolveFarmClientCacheAdapterEntry,
  resolveFarmImageConfig,
  resolveFarmImageProviderForRuntime,
  resolveFarmImageServerRuntime,
  readRouteRenderingDirectiveFromFile,
} from "@farm.js/core/vite";
import { generateRscEntry } from "./entries/rsc.js";
import { resolveMarkdownConfig, type FarmMarkdownUserConfig } from "@farm.js/core/markdown";
import type { FarmLlmsTxtUserConfig } from "@farm.js/core/internal/production-runtime";
import { generateSsrEntry } from "./entries/ssr.js";
import { generateErrorFallbackEntry } from "./entries/error-fallback.js";
import { generateClientEntry, serverFnTransportErrorClientRuntime } from "./entries/client.js";
import { transformFarmRouteActionClients } from "./route-action-transform.js";
import {
  createFarmServerFnBoundaryModule,
  isFarmServerFnBoundaryId,
  transformFarmServerFns,
} from "./server-fn-transform.js";
import { transformAutomaticOptimizedBoundaries } from "./automatic-optimized-boundary.js";
import { resolveRscBuildOutputPath } from "./build-paths.js";
import { rscPrivateClientSourcemaps } from "./client-sourcemaps.js";
import { findDocumentLayouts, findRouteFiles } from "./document-layouts.js";
import { assertRscPackageCompatibility } from "./compatibility.js";
import { sendRscDevelopmentResponse } from "./dev-response.js";
import {
  loadRscConfigPropertyModule,
  loadRscMiddlewareConfigModule,
} from "./middleware-config-module.js";
import type { FarmMCPUserConfig } from "@farm.js/core/server";
import fs from "fs/promises";
import path from "path";
import { devServableFileExists } from "../dev-static.js";
import { createDevRequestHeaders, resolveDevRequestURL } from "../dev-request.js";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// Use API and middleware plugins from @farm.js/core (require so CJS build resolves when ESM .mjs is missing)
const require_ = createRequire(import.meta.url);
const { farmApiPlugin } = require_("@farm.js/core") as typeof import("@farm.js/core");
const { FARM_VERSION } = require_(
  "@farm.js/core/version",
) as typeof import("@farm.js/core/version");
const { farmMiddlewarePlugin } = require_(
  "@farm.js/core/middleware",
) as typeof import("@farm.js/core/middleware");
const {
  resolveServerActionsConfig,
  validateServerActionRequest,
  createServerActionRequestErrorResponse,
} = require_(
  "@farm.js/core/server-action-security",
) as typeof import("@farm.js/core/server-action-security");
const { normalizeFarmDeploymentId } = require_(
  "@farm.js/core/deployment",
) as typeof import("@farm.js/core/deployment");
const {
  getFarmLayerAliases,
  getFarmSourceRoots,
  resolveFarmLayers,
  resolveFarmMCPConfig,
  resolveFarmMCPPlugin,
} = require_("@farm.js/core/server") as typeof import("@farm.js/core/server");
const {
  readNodeRequestBody,
  resolveFarmServerConfig,
  resolveFarmI18nConfig,
  createFarmRequestBodyErrorResponse,
  createDefaultErrorMarkup,
  resolveFarmLlmsTxtConfig,
} = require_(
  "@farm.js/core/internal/production-runtime",
) as typeof import("@farm.js/core/internal/production-runtime");
const { isFarmAPIPathname } = require_(
  "@farm.js/core/api/runtime",
) as typeof import("@farm.js/core/api/runtime");
const { resolveFarmAPIConfig, resolveFarmAPIServerBasePath } = require_(
  "@farm.js/core/api",
) as typeof import("@farm.js/core/api");
const { getResolvedEnv } = require_("@farm.js/core/env") as typeof import("@farm.js/core/env");

export type { FarmRscPluginOptions, EntryContext };
export { buildRscNitro, waitForRscManifest, waitForRscOutputs } from "./nitro-build.js";
import { registerRscNitroRuntimePackage } from "./nitro-build.js";
export type { BuildRscNitroOptions } from "./nitro-build.js";
export { default as nitro } from "./vite-plugin-nitro.js";
export type { NitroPluginOptions } from "./vite-plugin-nitro.js";

const PAGE_FILE = /^page\.(tsx|jsx|ts|js)$/;

type FarmImageConfig = NonNullable<Parameters<typeof resolveFarmImageConfig>[0]>;

// Extended config type for Farm.js RSC
export interface FarmRscConfig {
  srcDir?: string;
  extends?: readonly FarmLayerEntry[];
  layers?: readonly ResolvedFarmLayer[];
  outDir?: string;
  basePath?: string;
  api?: FarmAPIConfig;
  server?: FarmServerConfig;
  middleware?: FarmMiddlewareConfig;
  /** Same options as core's `images`: `<Image>` URLs and the optimizer at `images.path`. */
  images?: FarmImageConfig;
  port?: number;
  experimental?: {
    /**
     * Enable React Server Components rendering.
     * @default true
     */
    serverComponents?: boolean;
    /**
     * Enable React Server Actions and their public POST decoder.
     * @default false
     */
    serverActions?: boolean;
    /**
     * Automatically optimize eligible server-only host-element subtrees with
     * the native Strata renderer. Unsupported trees keep normal React
     * rendering; application components do not need a boundary import.
     *
     * @experimental
     * @default false
     */
    optimizedBoundary?: boolean;
  };
  debug?: boolean;
  encryptActions?: boolean;
  serverActions?: FarmServerActionsConfig;
  deploymentId?: string;
  generateBuildId?: () => string | Promise<string>;
  routesDir?: string;
  entries?: {
    rsc?: string;
    ssr?: string;
    client?: string;
  };
  /** Extra Vite plugins (e.g. rsc() with entries so client build resolves virtual:vite-rsc/client-references). */
  plugins?: any[];
  /**
   * Markdown mirrors for agents: `/page.md` and `Accept: text/markdown`, with
   * `?outline`, `?section`, `?max_tokens`, and `?actions`. Same options as core's `md`.
   * @default true
   */
  md?: FarmMarkdownUserConfig | boolean;
  /**
   * Agent-facing files. `llmsTxt` serves `/llms.txt`, an index of the app's
   * static pages that links to their Markdown mirrors, and with `full: true`
   * also `/llms-full.txt`, which inlines them. Same options as core's
   * `agent.llmsTxt`; `false` turns it off.
   * @default { llmsTxt: { full: false } }
   */
  agent?: { llmsTxt?: boolean | FarmLlmsTxtUserConfig };
  /**
   * An MCP endpoint for agents, with the same options as core's top-level
   * `mcp`. Requires `@farm.js/mcp`. Declare it directly in this config object:
   * the server reads it, and only the bindings it uses, from this file.
   * `oauth` is not supported in RSC apps yet.
   */
  mcp?: FarmMCPUserConfig;
}

/**
 * Define a Farm.js RSC configuration
 * This is the recommended way to configure your RSC app
 */
export function defineConfig(config: FarmRscConfig = {}): UserConfig {
  const port = config.port ?? 3000;
  const debug = config.debug ?? false;

  return {
    // Core Farm RSC settings
    experimental: {
      serverComponents: config.experimental?.serverComponents ?? true,
      serverActions: config.experimental?.serverActions ?? false,
      optimizedBoundary: config.experimental?.optimizedBoundary ?? false,
    },
    srcDir: config.srcDir ?? "src",
    extends: config.extends,
    layers: config.layers,
    outDir: config.outDir ?? "dist",
    basePath: config.basePath ?? "/",
    api: config.api,
    serverActions: config.serverActions,
    deploymentId: config.deploymentId,
    generateBuildId: config.generateBuildId,
    md: config.md,
    agent: config.agent,
    mcp: config.mcp,
    middleware: config.middleware,
    images: config.images,

    // Vite server configuration
    server: {
      ...config.server,
      port,
      strictPort: false,
    },

    // Custom logger to hide Vite's default startup banner
    customLogger: createFarmLogger(port, debug),

    plugins: [
      farmMiddlewarePlugin({
        srcDir: config.srcDir ?? "src",
        basePath: config.basePath ?? "/",
        // API routes in development run through this plugin's middleware, not the RSC entry's.
        middleware: config.middleware,
        debug,
      }),
      farmApiPlugin({
        srcDir: config.srcDir ?? "src",
        debug,
        bodySizeLimit: config.server?.bodySizeLimit,
        // The dev API server mounts the MCP endpoint, as core's does.
        ...(config.mcp ? { plugins: ({ root }) => resolveRscMCPPlugins(config.mcp, root) } : {}),
      }),
      // localFont() from @farm.js/core/font, with its CSS carried by the bundler: this pipeline
      // has no step that merges font CSS into a global stylesheet.
      farmFontImportsPlugin({ basePath: config.basePath ?? "/", importCss: true }),
      // Static image imports as { src, width, height }, which <Image> sizes from.
      farmImageImportsPlugin(),
      farmRsc({
        debug,
        encryptActions: config.encryptActions,
        serverActions: config.serverActions,
        deploymentId: config.deploymentId,
        routesDir: config.routesDir,
        entries: config.entries,
      }),
      ...(Array.isArray(config.plugins) ? config.plugins : []),
    ],
  } as any;
}

/**
 * Create a custom logger that shows Farm.js styled startup messages
 */
function createFarmLogger(port: number, debug: boolean) {
  const noop = (s: string) => s;
  let pc: any;
  try {
    pc = require("picocolors");
    if (typeof pc?.red !== "function") pc = null;
  } catch {
    pc = null;
  }
  if (!pc) {
    pc = {
      dim: noop,
      bold: noop,
      blue: noop,
      cyan: noop,
      green: noop,
      yellow: noop,
      red: noop,
      gray: noop,
    };
  }

  return {
    hasWarned: false,
    info(msg: string) {
      // Suppress Vite's startup banner (ready in, Local:, Network:, etc.)
      if (
        msg.includes("VITE v") ||
        msg.includes("ready in") ||
        msg.includes("Local:") ||
        msg.includes("Network:") ||
        msg.includes("press h")
      ) {
        return;
      }
      // Pass through other messages only in debug mode
      if (debug) {
        console.log(msg);
      }
    },
    warn(msg: string) {
      this.hasWarned = true;
      const prefix = pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]");
      console.warn(`${prefix} ${pc.yellow("⚠")} ${msg}`);
    },
    warnOnce(msg: string) {
      this.warn(msg);
    },
    error(msg: string) {
      const prefix = pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]");
      console.error(`${prefix} ${pc.bold(pc.red("✖"))} ${msg}`);
    },
    clearScreen() {},
    hasErrorLogged() {
      return false;
    },
  };
}

const VIRTUAL_PREFIX = "\0";
const VIRTUAL_RSC_ENTRY = "virtual:@farm.js/rsc/entry-rsc";
const VIRTUAL_SSR_ENTRY = "virtual:@farm.js/rsc/entry-ssr";
const VIRTUAL_CLIENT_ENTRY = "virtual:@farm.js/rsc/entry-client";
const VIRTUAL_HYDRATE_ENTRY = "virtual:@farm.js/rsc/hydrate";
const OPTIMIZED_BOUNDARY_ADAPTER = "@farm.js/plugin/rsc/optimized-boundary";
const STRATA_PACKAGE = "@farming-labs/strata";
const RSC_MIDDLEWARE_CONFIG_QUERY = "?farm-rsc-middleware";
const RSC_MCP_CONFIG_QUERY = "?farm-rsc-mcp";
const FARM_CORE_PACKAGE_ROOT = path.resolve(path.dirname(require_.resolve("@farm.js/core")), "..");
const FARM_CONFIG_FILENAMES = [
  "farm.config.ts",
  "farm.config.tsx",
  "farm.config.mts",
  "farm.config.cts",
  "farm.config.js",
  "farm.config.jsx",
  "farm.config.mjs",
  "farm.config.cjs",
  "config.ts",
  "config.tsx",
  "config.mts",
  "config.cts",
  "config.js",
  "config.jsx",
  "config.mjs",
  "config.cjs",
] as const;

function hasFarmMiddlewareConfig(config: FarmMiddlewareConfig | undefined): boolean {
  if (!config) return false;
  if (Array.isArray(config)) return config.length > 0;

  const entry = config as Record<string, unknown>;
  return Boolean(
    entry.matcher ||
    entry.exclude ||
    entry.runtime ||
    entry.handler ||
    (Array.isArray(entry.handlers) && entry.handlers.length > 0),
  );
}

async function findFarmConfigPath(root: string): Promise<string | null> {
  for (const fileName of FARM_CONFIG_FILENAMES) {
    const candidate = path.join(root, fileName);
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue checking supported config names.
    }
  }
  return null;
}

/** Resolves `mcp` for an RSC app, rejecting what the RSC server cannot serve yet. */
function resolveRscMCPConfig(input: FarmMCPUserConfig | undefined) {
  const config = resolveFarmMCPConfig(input);
  if (config.enabled && config.oauth) {
    throw new Error(
      "[Farm.js] mcp.oauth is not supported in RSC apps yet: the RSC server does not serve " +
        "the protected-resource metadata. Remove oauth, or validate tokens in mcp.authorize.",
    );
  }
  return config;
}

async function resolveRscMCPPlugins(input: FarmMCPUserConfig | undefined, root: string) {
  const plugin = await resolveFarmMCPPlugin(resolveRscMCPConfig(input), { root });
  return plugin ? [plugin] : [];
}

async function resolveMiddlewareConfigPaths(
  root: string,
  layers: readonly ResolvedFarmLayer[] | undefined,
): Promise<string[]> {
  const paths = (layers ?? []).flatMap((layer) =>
    layer.configFile ? [path.resolve(layer.configFile)] : [],
  );
  const projectConfigPath = await findFarmConfigPath(root);
  if (projectConfigPath) paths.push(projectConfigPath);
  return [...new Set(paths)];
}

// Vite's default config names: `defineConfig` from this package is written in one of them.
const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
] as const;

async function findViteConfigPath(root: string): Promise<string | null> {
  for (const fileName of VITE_CONFIG_FILENAMES) {
    const candidate = path.join(root, fileName);
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue checking supported config names.
    }
  }
  return null;
}

function isOptimizedBoundaryModule(id: string): boolean {
  return (
    id === OPTIMIZED_BOUNDARY_ADAPTER ||
    id === STRATA_PACKAGE ||
    id.startsWith(`${STRATA_PACKAGE}/`)
  );
}

/** The development error page for a failed RSC render: core's error page, with the real error. */
function createRscDevErrorDocument(error: unknown, method: string, pathname: string): string {
  const failure = error instanceof Error ? error : new Error(String(error));
  const markup = createDefaultErrorMarkup({
    statusCode: 500,
    requestPath: pathname,
    method,
    message: failure.message,
    errorName: failure.name,
    stack: failure.stack,
    development: true,
    mode: "development",
    farmVersion: FARM_VERSION,
    nodeVersion: process.version,
  });
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>500 · Farm.js</title></head><body>${markup}</body></html>`;
}

function resolveOptimizedBoundaryRuntimeRoot(): string {
  try {
    return path.dirname(require_.resolve(`${STRATA_PACKAGE}/package.json`));
  } catch {
    throw new Error(
      `[Farm.js] experimental.optimizedBoundary requires the bundled ${STRATA_PACKAGE} runtime. ` +
        "Reinstall @farm.js/plugin for a supported Node platform.",
    );
  }
}

// Exact-root imports in RSC application code are rewritten to focused public
// runtime subpaths. The root barrel itself also exports config/build/plugin
// surfaces and is intentionally not bundled into standalone request handlers.
// Keeping this list to published runtime entries prevents Vite, Nitro builders,
// Rolldown, and native build integrations from entering the production graph.
const CORE_RUNTIME_SUBPATHS = [
  "integrations",
  "api",
  "query/parsers",
  "query/client",
  "query/server",
  "query",
  "middleware",
  "router",
  "routes",
  "docs",
  "markdown",
  "app-markdown",
  "observability",
  "workflows",
  "cron",
  "env",
  "environment",
  "i18n/server",
  "i18n/client",
  "i18n",
  "server-fn",
  "server-fn/client",
  "server-query",
  "server-query/client",
  "server-action-security",
  "deployment",
  "client",
  "plugin/client",
  "cache",
  "deferred",
  "after",
  "navigation",
  "headers",
  "request",
  "agent-runtime",
  "image",
  "image/server",
] as const;

// These public runtime entries depend on packages that Nitro does not
// currently trace from the rewritten RSC graph. Rejecting them is preferable
// to producing an isolated server that builds successfully and then fails on
// its first request.
const CORE_UNSUPPORTED_STANDALONE_SUBPATHS = ["storage"] as const;

const CORE_RUNTIME_EXPORT_OVERRIDES: Record<string, string> = {
  api: "integrations",
  getCurrentRequest: "request",
  getFarmRedirectError: "navigation",
  isFarmNotFoundError: "navigation",
  isFarmRedirectError: "navigation",
  notFound: "navigation",
  permanentRedirect: "navigation",
  redirect: "navigation",
  usePathname: "navigation",
  useRouter: "client",
  useSearchParams: "navigation",
};

interface CoreRuntimeExportSources {
  supported: Map<string, string>;
  unsupported: Map<string, string>;
}

let coreRuntimeExportSourcesPromise: Promise<CoreRuntimeExportSources> | undefined;

function collectEsmExportNames(source: string): Set<string> {
  const names = new Set<string>();
  const ast = parseAst(source) as any;
  for (const statement of ast.body || []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    for (const specifier of statement.specifiers || []) {
      const exported = specifier.exported;
      const name = exported?.name ?? exported?.value;
      if (typeof name === "string") names.add(name);
    }
  }
  return names;
}

async function getCoreRuntimeExportSources(): Promise<CoreRuntimeExportSources> {
  if (coreRuntimeExportSourcesPromise) return coreRuntimeExportSourcesPromise;

  coreRuntimeExportSourcesPromise = (async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(FARM_CORE_PACKAGE_ROOT, "package.json"), "utf8"),
    ) as {
      exports: Record<string, { import?: string }>;
    };
    const rootEntry = manifest.exports["."]?.import;
    if (!rootEntry) throw new Error("@farm.js/core has no ESM root export");

    const rootExports = collectEsmExportNames(
      await fs.readFile(path.resolve(FARM_CORE_PACKAGE_ROOT, rootEntry), "utf8"),
    );
    const sources = new Map<string, string>();
    const unsupportedSources = new Map<string, string>();
    const exportsBySubpath = new Map<string, Set<string>>();

    for (const subpath of CORE_RUNTIME_SUBPATHS) {
      const entry = manifest.exports[`./${subpath}`]?.import;
      if (!entry) continue;
      const exportedNames = collectEsmExportNames(
        await fs.readFile(path.resolve(FARM_CORE_PACKAGE_ROOT, entry), "utf8"),
      );
      exportsBySubpath.set(subpath, exportedNames);
      for (const name of exportedNames) {
        if (rootExports.has(name)) sources.set(name, subpath);
      }
    }

    for (const subpath of CORE_UNSUPPORTED_STANDALONE_SUBPATHS) {
      const entry = manifest.exports[`./${subpath}`]?.import;
      if (!entry) continue;
      const exportedNames = collectEsmExportNames(
        await fs.readFile(path.resolve(FARM_CORE_PACKAGE_ROOT, entry), "utf8"),
      );
      for (const name of exportedNames) {
        if (rootExports.has(name)) unsupportedSources.set(name, subpath);
      }
    }

    for (const [name, subpath] of Object.entries(CORE_RUNTIME_EXPORT_OVERRIDES)) {
      if (rootExports.has(name) && exportsBySubpath.get(subpath)?.has(name)) {
        sources.set(name, subpath);
      }
    }

    return { supported: sources, unsupported: unsupportedSources };
  })();

  return coreRuntimeExportSourcesPromise;
}

function unsupportedStandaloneSubpathError(subpath: string, id: string): Error {
  return new Error(
    `[Farm.js] @farm.js/core/${subpath} is not supported in the standalone RSC runtime (${id}). ` +
      "Its external runtime dependencies are not copied into the isolated server output yet. " +
      "Importing it would create a production build that boots but fails when the module is used.",
  );
}

const CORE_ROOT_NAMED_IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*(["'])@farm.js\/core\2\s*$/;

async function rewriteCoreRuntimeImports(code: string, id: string): Promise<string | null> {
  if (!code.includes("@farm.js/core")) return null;
  await initModuleLexer;
  const [moduleImports] = parseModuleImports(code, id);
  const rootImports = moduleImports.filter(
    (moduleImport) => moduleImport.n === "@farm.js/core" && moduleImport.d === -1,
  );
  if (rootImports.length === 0) return null;

  const { supported: exportSources, unsupported: unsupportedSources } =
    await getCoreRuntimeExportSources();
  const replacements: Array<{ start: number; end: number; code: string }> = [];

  for (const rootImport of rootImports) {
    const statement = code.slice(rootImport.ss, rootImport.se);
    if (/^import\s+type\b/.test(statement)) continue;

    const namedImport = CORE_ROOT_NAMED_IMPORT_RE.exec(statement);
    if (!namedImport) {
      throw new Error(
        `[Farm.js] Unsupported @farm.js/core import syntax in ${id}. ` +
          "Standalone RSC request modules must use named imports from the root or a supported focused public subpath.",
      );
    }

    const body = namedImport[1];
    const grouped = new Map<string, string[]>();
    const specifiers = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .split(",")
      .map((specifier) => specifier.trim())
      .filter(Boolean);

    for (const specifier of specifiers) {
      if (specifier.startsWith("type ")) continue;
      const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
      if (!match) {
        throw new Error(`[Farm.js] Unsupported @farm.js/core import syntax in ${id}: ${specifier}`);
      }
      const [, imported, local = imported] = match;
      const unsupportedSubpath = unsupportedSources.get(imported);
      if (unsupportedSubpath) {
        throw unsupportedStandaloneSubpathError(unsupportedSubpath, id);
      }
      const subpath = exportSources.get(imported);
      if (!subpath) {
        throw new Error(
          `[Farm.js] The @farm.js/core root export "${imported}" is not available in the standalone RSC runtime. ` +
            "Config, plugin, Vite, build, code-generation, and framework-bootstrap APIs must stay outside application request modules.",
        );
      }
      const imports = grouped.get(subpath) || [];
      imports.push(imported === local ? imported : `${imported} as ${local}`);
      grouped.set(subpath, imports);
    }

    const replacement = Array.from(
      grouped,
      ([subpath, imports]) => `import { ${imports.join(", ")} } from "@farm.js/core/${subpath}";`,
    ).join("\n");
    const end = code[rootImport.se] === ";" ? rootImport.se + 1 : rootImport.se;
    replacements.push({ start: rootImport.ss, end, code: replacement });
  }

  if (replacements.length === 0) return null;

  let rewritten = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten =
      rewritten.slice(0, replacement.start) + replacement.code + rewritten.slice(replacement.end);
  }

  return rewritten;
}

/**
 * Farm.js RSC Plugin
 *
 * @param options - Plugin configuration options
 * @returns Array of Vite plugins
 */
export default function farmRsc(options: FarmRscPluginOptions = {}): Plugin[] {
  let rscEnabled = false;
  let actionsEnabled = false;
  let optimizedBoundaryEnabled = false;
  let bodySizeLimit = resolveFarmServerConfig(undefined).bodySizeLimit;

  // Context passed to entry generators
  let entryContext: EntryContext;
  let rscBuildRoot: string | undefined;
  const middlewareConfigModules = new Map<string, string>();
  let mcpConfigCandidates: string[] | null = null;

  // Store for debugging
  const debug = options.debug ?? false;
  const automaticDeploymentId = `build-${Date.now()}`;
  const supportsBuildAppHook = Number(viteVersion.split(".")[0]) >= 7;

  type RscApplicationBuilder = {
    environments: Record<string, { config?: { build?: { outDir?: string; assetsDir?: string } } }>;
    config?: { plugins?: readonly { name?: string }[] };
    build(environment: unknown): Promise<unknown>;
  };

  const runNitroAfterApplicationBuild = async (builder: RscApplicationBuilder) => {
    const nitroEnabled = builder.config?.plugins?.some(
      (plugin) => plugin.name === "vite-plugin-nitro",
    );
    if (!nitroEnabled || !rscBuildRoot) return;

    const { runNitroFromBuildApp } = await import("./vite-plugin-nitro.js");
    if ((globalThis as any).__FARM_NITRO_PATHS) {
      await runNitroFromBuildApp();
      return;
    }

    // Vite creates environment-specific plugin instances by default, so state
    // captured by a Rollup hook is not guaranteed to be visible here. Resolve
    // the final environment outputs directly when that state is unavailable.
    const rscBuild = builder.environments.rsc?.config?.build;
    const ssrBuild = builder.environments.ssr?.config?.build;
    const clientBuild = builder.environments.client?.config?.build;
    if (!rscBuild?.outDir || !ssrBuild?.outDir || !clientBuild?.outDir) return;

    const { buildRscNitro } = await import("./nitro-build.js");
    const root = path.resolve(rscBuildRoot);
    await buildRscNitro({
      root,
      rendererPath: resolveRscBuildOutputPath(root, rscBuild.outDir, "index.js"),
      publicDir: resolveRscBuildOutputPath(root, clientBuild.outDir),
      ssrPath: resolveRscBuildOutputPath(root, ssrBuild.outDir, "index.js"),
      assetsDir: clientBuild.assetsDir,
      preset: process.env.NITRO_PRESET || "vercel",
    });
  };

  const getColors = () => {
    try {
      const pico = require_("picocolors");
      // Use createColors(true) to force colors, overriding NO_COLOR env
      if (typeof pico?.createColors === "function") {
        return pico.createColors(true);
      }
      if (typeof pico?.green === "function") return pico;
    } catch {}
    const id = (s: string) => s;
    return {
      bold: id,
      green: id,
      dim: id,
      cyan: id,
      red: id,
      yellow: id,
      blue: id,
      white: id,
      gray: id,
    };
  };

  const logResponse = (
    method: string,
    urlPath: string,
    status: number,
    duration: number,
    tag: "PAGE" | "API" = "PAGE",
  ) => {
    const pc = getColors();
    let statusColor = pc.green;
    if (status >= 500) statusColor = pc.red;
    else if (status >= 400) statusColor = pc.yellow;
    else if (status >= 300) statusColor = pc.cyan;

    const log = [
      pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
      pc.dim("[") + pc.bold(pc.cyan(tag)) + pc.dim("]"),
      pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
      pc.gray(urlPath),
      pc.dim("-"),
      statusColor(status.toString()),
      pc.dim(`(${duration}ms)`),
    ].join(" ");
    console.log(log);
  };

  const logInfo = (_message: string) => {};
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    const msg = args[0]?.toString?.() ?? "";
    if (
      msg.includes("[FARM] ⚠ warning") ||
      msg.includes("registryPath") ||
      msg.includes("farm-registry")
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };

  return [
    farmEnvironmentFunctionsPlugin() as unknown as Plugin,
    rscPrivateClientSourcemaps(),
    {
      name: "@farm.js/plugin/rsc:middleware-config",
      enforce: "pre",

      resolveId(id) {
        if (!id.endsWith(RSC_MIDDLEWARE_CONFIG_QUERY) && !id.endsWith(RSC_MCP_CONFIG_QUERY)) {
          return null;
        }
        return id.replace(/\\/g, "/");
      },

      // The MCP config is read from the Vite config file too, whose path is
      // only known here. Entries are generated on load, after this runs.
      async configResolved(resolved) {
        if (!mcpConfigCandidates || !entryContext) return;
        const configPaths = [...mcpConfigCandidates];
        if (resolved.configFile) configPaths.push(path.resolve(resolved.configFile));
        const mcpConfigPaths: string[] = [];
        for (const configPath of new Set(configPaths)) {
          const extracted = await loadRscConfigPropertyModule(configPath, "mcp");
          if (extracted.kind === "unsupported") {
            throw new Error(
              `[Farm.js] Cannot read mcp for the RSC server from ${configPath}: ${extracted.reason}. ` +
                "Declare mcp directly in defineConfig({ mcp: ... }).",
            );
          }
          if (extracted.kind === "absent") continue;
          const moduleId = `${configPath.replace(/\\/g, "/")}${RSC_MCP_CONFIG_QUERY}`;
          middlewareConfigModules.set(moduleId, extracted.code);
          mcpConfigPaths.push(moduleId);
        }
        if (mcpConfigPaths.length === 0) {
          throw new Error(
            "[Farm.js] The RSC server could not find the mcp config. " +
              "Declare mcp directly in defineConfig({ mcp: ... }) in your Vite or Farm config file.",
          );
        }
        entryContext.mcpConfigPaths = mcpConfigPaths;
      },

      load(id) {
        return middlewareConfigModules.get(id.replace(/\\/g, "/")) ?? null;
      },
    },
    {
      name: "@farm.js/plugin/rsc:core-runtime",
      // Run after Vite/esbuild has lowered TS/JSX. es-module-lexer deliberately
      // parses JavaScript module syntax and rejects raw JSX expression text.
      enforce: "post",
      apply: "build",

      async transform(code, id, options) {
        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        const isServerEnvironment =
          options?.ssr || environmentName === "rsc" || environmentName === "ssr";
        if (!isServerEnvironment) return null;

        const rewritten = await rewriteCoreRuntimeImports(code, id);
        return rewritten ? { code: rewritten, map: null } : null;
      },

      resolveId(id, _importer, options) {
        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        const isServerEnvironment =
          options?.ssr || environmentName === "rsc" || environmentName === "ssr";
        if (isServerEnvironment && id === "@farm.js/core/storage") {
          throw unsupportedStandaloneSubpathError("storage", _importer || "unknown importer");
        }
        if (isServerEnvironment && id === "@farm.js/core") {
          throw new Error(
            "[Farm.js] Standalone RSC runtime modules must use named @farm.js/core imports. " +
              "Namespace/default imports and build-only root exports cannot be bundled safely; use a focused public subpath.",
          );
        }
        return null;
      },
    },
    {
      name: "@farm.js/plugin/rsc:config",
      enforce: "pre",

      async config(config: UserConfig, env: ConfigEnv) {
        const c = config as UserConfig & {
          experimental?: {
            serverComponents?: boolean;
            serverActions?: boolean;
            optimizedBoundary?: boolean;
          };
          srcDir?: string;
          outDir?: string;
          basePath?: string;
          api?: FarmAPIConfig;
          server?: UserConfig["server"] & FarmServerConfig;
          root?: string;
          extends?: readonly FarmLayerEntry[];
          layers?: readonly ResolvedFarmLayer[];
          serverActions?: FarmServerActionsConfig;
          deploymentId?: string;
          generateBuildId?: () => string | Promise<string>;
          cache?: FarmCacheUserConfig;
          i18n?: FarmI18nUserConfig | false;
          middleware?: FarmMiddlewareConfig;
          md?: FarmMarkdownUserConfig | boolean;
          agent?: { llmsTxt?: boolean | FarmLlmsTxtUserConfig };
          mcp?: FarmMCPUserConfig;
          images?: FarmImageConfig;
        };
        // Check if user enabled RSC in their config
        rscEnabled = c.experimental?.serverComponents === true;
        actionsEnabled = c.experimental?.serverActions === true;
        bodySizeLimit = resolveFarmServerConfig(c.server).bodySizeLimit;
        optimizedBoundaryEnabled = c.experimental?.optimizedBoundary === true;

        logInfo(`RSC enabled: ${rscEnabled}`);
        logInfo(`Actions enabled: ${actionsEnabled}`);
        logInfo(`Optimized boundary enabled: ${optimizedBoundaryEnabled}`);

        if (optimizedBoundaryEnabled && !rscEnabled) {
          throw new Error(
            "[Farm.js] experimental.optimizedBoundary requires experimental.serverComponents.",
          );
        }

        // If RSC not enabled, don't add environment config
        if (!rscEnabled) {
          return;
        }

        const root = c.root ?? process.cwd();
        assertRscPackageCompatibility(root);
        if (optimizedBoundaryEnabled) {
          registerRscNitroRuntimePackage(
            root,
            STRATA_PACKAGE,
            resolveOptimizedBoundaryRuntimeRoot(),
          );
        }
        if (c.extends?.length) {
          const layerResolution = await resolveFarmLayers(c, {
            root,
            mode: process.env.NODE_ENV === "production" ? "production" : "development",
          });
          Object.assign(c, layerResolution.config);
        }

        middlewareConfigModules.clear();
        // The config files mcp is read from at runtime; the Vite config file is
        // added once it is known, in configResolved.
        mcpConfigCandidates = resolveRscMCPConfig(c.mcp).enabled
          ? await resolveMiddlewareConfigPaths(root, c.layers)
          : null;
        const middlewareConfigPaths: string[] = [];
        if (hasFarmMiddlewareConfig(c.middleware)) {
          const configPaths = await resolveMiddlewareConfigPaths(root, c.layers);
          const viteConfigPath = await findViteConfigPath(root);
          if (viteConfigPath) configPaths.push(viteConfigPath);
          if (configPaths.length === 0) {
            throw new Error(
              "[Farm.js] RSC config middleware requires an importable farm.config or vite.config file. " +
                "Move the middleware to farm.config.ts or src/app/middleware.ts.",
            );
          }
          for (const configPath of configPaths) {
            const extracted = await loadRscMiddlewareConfigModule(configPath);
            if (extracted.kind === "unsupported") {
              throw new Error(
                `[Farm.js] Cannot extract RSC config middleware from ${configPath}: ${extracted.reason}. ` +
                  "Declare middleware directly in defineConfig({ middleware: ... }) or move it to src/app/middleware.ts.",
              );
            }
            if (extracted.kind === "absent") continue;
            const moduleId = `${configPath.replace(/\\/g, "/")}${RSC_MIDDLEWARE_CONFIG_QUERY}`;
            middlewareConfigModules.set(moduleId, extracted.code);
            middlewareConfigPaths.push(moduleId);
          }
          if (middlewareConfigPaths.length === 0) {
            throw new Error(
              "[Farm.js] RSC config middleware could not be traced to an explicit middleware property. " +
                "Declare middleware directly in defineConfig({ middleware: ... }) or move it to src/app/middleware.ts.",
            );
          }
        }

        // Read user's directory configuration
        const api = await resolveFarmAPIConfig(c.api, {
          root,
          mode: env.command === "build" ? "production" : "development",
          env: getResolvedEnv(),
        });
        const srcDir = c.srcDir ?? "src";
        const outDir = c.outDir ?? "dist";
        const deploymentId = normalizeFarmDeploymentId(
          options.deploymentId ||
            c.deploymentId ||
            process.env.FARM_DEPLOYMENT_ID ||
            process.env.VERCEL_GIT_COMMIT_SHA ||
            process.env.CF_PAGES_COMMIT_SHA ||
            (process.env.NODE_ENV === "production"
              ? ((await c.generateBuildId?.()) ?? automaticDeploymentId)
              : "development"),
        );
        rscBuildRoot = root;
        const entriesDir = path.join(root, ".farm", "rsc-entries");
        await fs.mkdir(entriesDir, { recursive: true });
        const configuredRoutesDir =
          options.routesDir === undefined ? "app" : options.routesDir.trim();
        const globalCssFile = path.resolve(root, srcDir, configuredRoutesDir, "globals.css");
        let globalCssPath: string | undefined;
        try {
          if ((await fs.stat(globalCssFile)).isFile()) {
            const rootRelativeCssPath = path.relative(root, globalCssFile).replace(/\\/g, "/");
            globalCssPath = rootRelativeCssPath.startsWith("../")
              ? `/@fs/${globalCssFile.replace(/\\/g, "/")}`
              : `/${rootRelativeCssPath}`;
          }
        } catch {
          // Global CSS is optional.
        }
        const routeRoots = getFarmSourceRoots(c).map((source) => {
          const routeSuffix = configuredRoutesDir ? `/${configuredRoutesDir}` : "";
          const projectSourceDir = source.srcDir.replace(/\\/g, "/").replace(/^\.?\//, "");
          const base = source.layer
            ? `#layers/${source.name}${routeSuffix}`
            : `/${projectSourceDir}${routeSuffix}`;
          return { name: source.name, base, glob: base };
        });
        // Each page's rendering directive and whether its source reads request state, which the
        // runtime cannot see from module exports: the same baked input core's server merges.
        // Later roots override earlier ones, as the entry's merged page map does.
        const pageRenderingDirectives: Record<string, unknown> = {};
        for (const source of getFarmSourceRoots(c)) {
          const routesRoot = path.resolve(root, source.srcDir, configuredRoutesDir);
          for (const { key, file } of await findRouteFiles(routesRoot, (name) =>
            PAGE_FILE.test(name),
          )) {
            const directive = readRouteRenderingDirectiveFromFile(file);
            if (directive) pageRenderingDirectives[key] = directive;
            else delete pageRenderingDirectives[key];
          }
        }
        // Root layouts that render <html> own the document (Next.js's root layout contract).
        const documentLayouts = [
          ...new Set(
            (
              await Promise.all(
                getFarmSourceRoots(c).map((source) =>
                  findDocumentLayouts(path.resolve(root, source.srcDir, configuredRoutesDir)),
                ),
              )
            ).flat(),
          ),
        ];
        // The same images contract as core: without Sharp, "auto" keeps original URLs
        // (provider "none") instead of pointing <Image> at an optimizer that cannot run.
        const nitroPreset = process.env.NITRO_PRESET || "vercel";
        const imageConfig = resolveFarmImageConfig(
          resolveFarmImageProviderForRuntime(c.images, {
            root,
            preset: nitroPreset,
            dev: env.command === "serve",
          }),
        );
        const publicImageConfig = getPublicFarmImageConfig(imageConfig);
        // Development always optimizes with Sharp, as core's dev server does.
        const imageRuntime =
          env.command === "serve"
            ? imageConfig.provider === "none"
              ? "none"
              : "node"
            : resolveFarmImageServerRuntime(imageConfig, nitroPreset);
        // Build context for entry generators
        entryContext = {
          documentLayouts,
          pageRenderingDirectives,
          images: {
            config: imageConfig,
            public: publicImageConfig,
            path: imageConfig.path,
            runtime: imageRuntime,
          },
          srcDir,
          outDir,
          basePath: c.basePath ?? "/",
          apiBasePath: resolveFarmAPIServerBasePath(api),
          routesDir: options.routesDir,
          globalCssPath,
          routeRoots,
          actionsEnabled,
          serverActions: resolveServerActionsConfig({
            ...c.serverActions,
            ...options.serverActions,
            allowedOrigins:
              options.serverActions?.allowedOrigins ?? c.serverActions?.allowedOrigins,
          }),
          deploymentId,
          markdown: resolveMarkdownConfig(c.md),
          // Core's default for an app without docs: llms.txt on, llms-full.txt off.
          llmsTxt: resolveFarmLlmsTxtConfig(c.agent?.llmsTxt ?? { full: false }),
          // Resolved the same way core resolves it for the config, so RSC and
          // non-RSC apps match middleware against the same pathname.
          i18n: resolveFarmI18nConfig(c.i18n, {
            root,
            mode: env.command === "serve" ? "development" : "production",
            basePath: c.basePath ?? "/",
          }),
          server: { trustProxy: resolveFarmServerConfig(c.server).trustProxy },
          middlewareConfigPaths,
          debug,
          development: env.command === "serve",
          clientCachePersistence: generateClientCachePersistenceCode(
            resolveFarmClientCacheAdapterEntry(root, c.cache),
          ),
        };

        logInfo(`srcDir: ${entryContext.srcDir}, outDir: ${entryContext.outDir}`);

        // Write real entry files so @vitejs/plugin-rsc can use file-based entries.
        // This ensures the RSC plugin runs for every environment (rsc, ssr, client) and client build/deploy works.
        const entryRscPath = path.join(entriesDir, "entry.rsc.tsx");
        const entrySsrPath = path.join(entriesDir, "entry.ssr.tsx");
        const entryClientPath = path.join(entriesDir, "entry.browser.tsx");
        await fs.writeFile(entryRscPath, generateRscEntry(entryContext));
        await fs.writeFile(entrySsrPath, generateSsrEntry(entryContext));
        await fs.writeFile(entryClientPath, generateClientEntry(entryContext));
        await fs.writeFile(
          path.join(entriesDir, "error-fallback.tsx"),
          generateErrorFallbackEntry(),
        );
        logInfo(`Wrote RSC entries to ${entriesDir}`);

        // User must add rsc({ entries: { rsc, ssr, client } }) to config.plugins so the RSC plugin
        // runs for every environment and client build can resolve virtual:vite-rsc/client-references.

        // Entry paths (relative to root) so Vite runs rsc/ssr/client builds (not index.html).
        const entryRsc = "./.farm/rsc-entries/entry.rsc.tsx";
        const entrySsr = "./.farm/rsc-entries/entry.ssr.tsx";
        const entryClient = "./.farm/rsc-entries/entry.browser.tsx";

        // Resolve @farm.js/core so Vite (and rsc/ssr envs) can load it when app code imports it (fixes "Failed to resolve entry" in dev).
        let farmCorePath: string | null = null;
        try {
          farmCorePath = path.dirname(require_.resolve("@farm.js/core/package.json"));
        } catch {
          try {
            farmCorePath = path.resolve(
              path.dirname(require_.resolve("@farm.js/core/server")),
              "..",
            );
          } catch {
            // @farm.js/core not installed or not built; core aliases are not added
          }
        }
        const layerAliases = getFarmLayerAliases(c.layers);

        // Return shared config and environments. RSC plugin (in plugins) needs to run in same
        // pipeline for client build to resolve virtual:vite-rsc/client-references.
        return {
          appType: "custom" as const,
          builder: { sharedConfigBuild: true } as any,
          define: {
            __FARM_API_BASE_URL__: JSON.stringify(api.baseURL),
            __FARM_IMAGE_CONFIG__: JSON.stringify(entryContext.images?.public),
          },
          ssr: {
            external: [
              "react",
              "react-dom",
              "react-dom/server",
              "react/jsx-runtime",
              "react/jsx-dev-runtime",
              ...(optimizedBoundaryEnabled
                ? [STRATA_PACKAGE, `${STRATA_PACKAGE}/react-server`]
                : []),
            ],
          },
          ...(optimizedBoundaryEnabled
            ? {
                optimizeDeps: {
                  exclude: [STRATA_PACKAGE, `${STRATA_PACKAGE}/react-server`],
                },
              }
            : {}),
          resolve: {
            dedupe: ["react", "react-dom", "react-server-dom-webpack"],
            alias: [
              ...Object.entries(layerAliases).map(([find, replacement]) => ({
                find,
                replacement,
              })),
              ...(farmCorePath
                ? [
                    {
                      find: /^@farm.js\/core\/middleware$/,
                      replacement: path.join(farmCorePath, "dist/middleware.mjs"),
                    },
                    {
                      find: /^@farm.js\/core\/api$/,
                      replacement: path.join(farmCorePath, "dist/api.mjs"),
                    },
                    {
                      find: /^@farm.js\/core\/server-fn$/,
                      replacement: path.join(farmCorePath, "dist/server-fn.mjs"),
                    },
                    {
                      find: /^@farm.js\/core\/server-action-security$/,
                      replacement: path.join(farmCorePath, "dist/server-action-security.mjs"),
                    },
                    {
                      find: /^@farm.js\/core\/environment$/,
                      replacement: path.join(farmCorePath, "dist/environment.mjs"),
                    },
                    {
                      find: /^@farm.js\/core\/headers$/,
                      replacement: path.join(farmCorePath, "dist/headers.mjs"),
                    },
                    ...(env.command === "serve"
                      ? [
                          {
                            find: /^@farm.js\/core$/,
                            replacement: path.join(farmCorePath, "dist/index.mjs"),
                          },
                        ]
                      : []),
                  ]
                : []),
            ],
          },
          // Vite 8 compiles with oxc, which already uses the automatic runtime;
          // setting esbuild there only prints a "both options were set" warning.
          ...(this?.meta?.rolldownVersion
            ? {}
            : { esbuild: { jsx: "automatic" as const, jsxImportSource: "react" } }),
          ...(c.layers?.length
            ? {
                server: {
                  fs: {
                    allow: [root, ...c.layers.map((layer) => layer.root)],
                  },
                },
              }
            : {}),
          environments: {
            rsc: {
              build: {
                outDir: `${outDir}/rsc`,
                copyPublicDir: false,
                rollupOptions: { input: { index: entryRsc } },
              },
              resolve: {
                conditions: ["react-server", "node", "import"],
                // Strata is a native CommonJS loader: Node must load it, not Vite's
                // module runner. ssr.external does not reach this environment.
                ...(optimizedBoundaryEnabled
                  ? { external: [STRATA_PACKAGE, `${STRATA_PACKAGE}/react-server`] }
                  : {}),
              },
            },
            ssr: {
              build: {
                outDir: `${outDir}/ssr`,
                copyPublicDir: false,
                rollupOptions: { input: { index: entrySsr } },
              },
              resolve: { conditions: ["node", "import"] },
            },
            client: {
              build: {
                outDir: `${outDir}/client`,
                rollupOptions: { input: { index: entryClient } },
              },
              resolve: { conditions: ["browser", "import"] },
              // Optimize what the browser entry needs up front. A dependency first
              // found on page load makes Vite re-optimize and reload, and until the
              // reload client components can see two React copies ("Invalid hook call").
              optimizeDeps: {
                include: [
                  "react",
                  "react/jsx-runtime",
                  "react/jsx-dev-runtime",
                  "react-dom",
                  "react-dom/client",
                  "rsc-html-stream/client",
                ],
              },
            },
          },
        };
      },
    },
    {
      name: "@farm.js/plugin/rsc:optimized-boundary",
      enforce: "pre",

      resolveId(id, importer, options) {
        if (!isOptimizedBoundaryModule(id)) return null;

        if (!optimizedBoundaryEnabled) {
          throw new Error(
            `[Farm.js] ${id} was imported by ${importer || "an unknown module"}, but ` +
              "experimental.optimizedBoundary is disabled.",
          );
        }

        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        const isServerEnvironment =
          options?.ssr || environmentName === "rsc" || environmentName === "ssr";
        if (!isServerEnvironment) {
          throw new Error(
            `[Farm.js] ${id} is server-only and cannot be imported into the client environment.`,
          );
        }

        // Strata's published entry points are native CommonJS loaders. Keep
        // them outside Vite's RSC dependency scan and let Node resolve the
        // platform package at runtime.
        if (id === STRATA_PACKAGE || id.startsWith(`${STRATA_PACKAGE}/`)) {
          return { id, external: true };
        }

        return null;
      },
    },

    {
      name: "@farm.js/plugin/rsc:automatic-optimized-boundary",
      enforce: "post",

      transform(code, id) {
        if (!rscEnabled || !optimizedBoundaryEnabled) return null;
        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        if (environmentName !== "rsc") return null;

        const result = transformAutomaticOptimizedBoundaries(code, id);
        if (!result) return null;
        if (debug) {
          console.log(
            `[Farm.js] Added ${result.boundaryCount} automatic optimized-boundary candidate${result.boundaryCount === 1 ? "" : "s"} in ${id}`,
          );
        }
        return { code: result.code, map: null };
      },
    },

    {
      name: "@farm.js/plugin/rsc:route-action-clients",
      enforce: "pre",

      transform(code, id) {
        if (!rscEnabled || !actionsEnabled) return null;
        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        if (environmentName !== "client") return null;

        const result = transformFarmRouteActionClients(code, id);
        if (!result) return null;

        return {
          code: result.code,
          map: null,
        };
      },
    },

    {
      name: "@farm.js/plugin/rsc:server-fn-actions",
      enforce: "pre",

      // The "use server" boundary for a module whose server functions were
      // found without an explicit directive. Its exports come from the source
      // file on disk, never from the request, so nothing else can be named.
      async load(id) {
        if (!rscEnabled || !actionsEnabled || !isFarmServerFnBoundaryId(id)) return null;
        const file = id.split("?", 1)[0]!;
        this.addWatchFile(file);
        const source = await fs.readFile(file, "utf8");
        return createFarmServerFnBoundaryModule(source, file) ?? "export {};\n";
      },

      transform(code, id) {
        if (!rscEnabled || !actionsEnabled || isFarmServerFnBoundaryId(id)) return null;

        const environment = (this as { environment?: { name?: string } }).environment?.name;
        const result = transformFarmServerFns(code, id, { environment: environment ?? "rsc" });
        if (!result) return null;

        return {
          code: result.code,
          map: null,
        };
      },
    },

    {
      name: "@farm.js/plugin/rsc:nitro-application-build",
      enforce: "post",
      apply: "build",

      // @vitejs/plugin-rsc owns the Vite 6 builder callback. Wrap its final
      // callback after config composition so Nitro starts only after the RSC,
      // client, and SSR outputs have all been written.
      config(config) {
        const builderConfig = (
          config as UserConfig & {
            builder?: { buildApp?: (builder: RscApplicationBuilder) => Promise<unknown> };
          }
        ).builder;
        const buildApp = builderConfig?.buildApp;
        if (typeof buildApp !== "function") return;

        return {
          builder: {
            ...builderConfig,
            async buildApp(builder: RscApplicationBuilder) {
              await buildApp(builder);
              if (!supportsBuildAppHook) {
                await runNitroAfterApplicationBuild(builder);
              }
            },
          },
        } as unknown as UserConfig;
      },

      // Vite 7+ composes application build hooks directly. Keep the Vite 6
      // wrapper above for the versions where this hook is not dispatched.
      buildApp: {
        order: "post",
        async handler(builder: RscApplicationBuilder) {
          if (supportsBuildAppHook) {
            await runNitroAfterApplicationBuild(builder);
          }
        },
      },
    } as Plugin,

    // ────────────────────────────────────────────────────────
    // VIRTUAL ENTRIES PLUGIN
    // Generates entry files dynamically based on user's project structure
    // ────────────────────────────────────────────────────────
    {
      name: "@farm.js/plugin/rsc:virtual-entries",
      enforce: "pre",

      resolveId(source: string) {
        // Mark our virtual modules with \0 prefix (Vite convention)
        if (source === VIRTUAL_RSC_ENTRY) {
          return VIRTUAL_PREFIX + VIRTUAL_RSC_ENTRY;
        }
        if (source === VIRTUAL_SSR_ENTRY) {
          return VIRTUAL_PREFIX + VIRTUAL_SSR_ENTRY;
        }
        if (source === VIRTUAL_CLIENT_ENTRY) {
          return VIRTUAL_PREFIX + VIRTUAL_CLIENT_ENTRY;
        }
        // Resolve file-based entry paths to virtual entries so we always serve generated content
        // (avoids stale .farm/rsc-entries/* on disk causing duplicate content / wrong rootContent fallback)
        if (source.includes("rsc-entries") && source.includes("entry.browser.tsx")) {
          return VIRTUAL_PREFIX + VIRTUAL_CLIENT_ENTRY;
        }
        if (source.includes("rsc-entries") && source.includes("entry.rsc.tsx")) {
          return VIRTUAL_PREFIX + VIRTUAL_RSC_ENTRY;
        }
        if (source.includes("rsc-entries") && source.includes("entry.ssr.tsx")) {
          return VIRTUAL_PREFIX + VIRTUAL_SSR_ENTRY;
        }
        // Handle dynamic hydration entries like /@rsc-hydrate/counter
        if (source.startsWith("/@rsc-hydrate/")) {
          return VIRTUAL_PREFIX + source;
        }
        return null;
      },

      load(id: string) {
        // Only generate entries if RSC is enabled
        if (!rscEnabled) {
          return null;
        }

        // Generate the appropriate entry based on the virtual module ID
        if (id === VIRTUAL_PREFIX + VIRTUAL_RSC_ENTRY) {
          logInfo("Generating RSC entry");
          return generateRscEntry(entryContext);
        }

        if (id === VIRTUAL_PREFIX + VIRTUAL_SSR_ENTRY) {
          logInfo("Generating SSR entry");
          return generateSsrEntry(entryContext);
        }

        if (id === VIRTUAL_PREFIX + VIRTUAL_CLIENT_ENTRY) {
          logInfo("Generating client entry");
          return generateClientEntry(entryContext);
        }

        // Handle dynamic hydration entries
        if (id.startsWith(VIRTUAL_PREFIX + "/@rsc-hydrate/")) {
          const pagePath = id.replace(VIRTUAL_PREFIX + "/@rsc-hydrate", "");
          const srcDir = entryContext.srcDir;
          const appSegment =
            entryContext.routesDir === undefined ? "app" : entryContext.routesDir.trim();
          const basePath = appSegment ? `/${srcDir}/${appSegment}` : `/${srcDir}`;
          const pageImportPath =
            pagePath === "/" ? `${basePath}/page.tsx` : `${basePath}${pagePath}/page.tsx`;
          const layoutImportPath = `${basePath}/layout.tsx`;
          const actionBlock = entryContext.actionsEnabled
            ? `
import { setServerCallback, encodeReply, createTemporaryReferenceSet, createFromReadableStream } from '@vitejs/plugin-rsc/browser';
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from '@farm.js/core/deployment';
${serverFnTransportErrorClientRuntime}
const farmDeploymentId = ${JSON.stringify(entryContext.deploymentId)};
setServerCallback(async (id, args) => {
  const refs = createTemporaryReferenceSet();
  const body = await encodeReply(args, { temporaryReferences: refs });
  const headers = createFarmDeploymentRequestHeaders(farmDeploymentId, {
    'x-farm-action-id': id,
    'Accept': 'text/x-component',
  });
  if (typeof body === 'string') headers.set('Content-Type', 'text/plain; charset=utf-8');
  else if (!(body instanceof FormData)) headers.set('Content-Type', 'application/octet-stream');
  const res = await fetch(location.href, {
    method: 'POST',
    headers,
    body,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (isFarmDeploymentMismatchResponse(res, farmDeploymentId)) {
    const error = createFarmDeploymentMismatchError(res, farmDeploymentId);
    globalThis.dispatchEvent?.(new CustomEvent('farm:deployment-mismatch', { detail: error }));
    throw error;
  }
  if (!res.ok) throw new Error('Server action failed: ' + res.status);
  const p = await createFromReadableStream(res.body, { temporaryReferences: refs });
  if (p?.returnValue?.ok) return p.returnValue.data;
  // This entry hydrates a single page and has no client router, so a redirect
  // from the action becomes a full document navigation.
  if (p?.returnValue?.redirect?.url) {
    location.assign(p.returnValue.redirect.url);
    return;
  }
  throw createFarmServerFnTransportError(p?.returnValue?.data);
});
`
            : "";
          // Generate a hydration entry for this page
          return `${actionBlock}
import React from 'react';
import { hydrateRoot } from 'react-dom/client';

// Import page and layout using absolute paths
import Page from '${pageImportPath}';
import Layout from '${layoutImportPath}';

// Hydrate when DOM is ready
function hydrate() {
  const root = document.getElementById('root');
  if (root) {
    const pageContent = React.createElement(Page, window.__PAGE_PROPS__ || {});
    const app = React.createElement(Layout, null, pageContent);
    hydrateRoot(root, app);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrate);
} else {
  hydrate();
}
`;
        }

        return null;
      },
    },

    // ────────────────────────────────────────────────────────
    // DEV SERVER PLUGIN
    // Handles page rendering during development
    // Middleware and API routes are handled by standalone plugins
    // ────────────────────────────────────────────────────────
    {
      name: "@farm.js/plugin/rsc:dev-server",

      configureServer(server) {
        if (!rscEnabled) {
          return;
        }

        logInfo("Dev server middleware ready");
        const serverStartTime = Date.now();
        let bannerPrinted = false;

        server.httpServer?.once("listening", () => {
          if (bannerPrinted) return;
          bannerPrinted = true;
          const elapsed = Date.now() - serverStartTime;
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address ? address.port : 3000;
          const colors = getColors();

          console.log("");
          console.log(
            `  ${colors.bold(colors.green("Farm.js"))} ${colors.dim(`v${FARM_VERSION}`)} ${colors.dim(`ready in ${elapsed}ms`)}`,
          );
          console.log("");
          console.log(
            `  ${colors.dim("➜")}  ${colors.bold("Local:")}   ${colors.cyan(`http://localhost:${port}/`)}`,
          );
          console.log(
            `  ${colors.dim("➜")}  ${colors.bold("Network:")} ${colors.dim("use --host to expose")}`,
          );
          console.log("");
        });

        return () => {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url || "/";
            const pathname = url.split("?")[0];
            const method = req.method || "GET";

            // Dotted paths only skip RSC rendering when they map to a real
            // file on disk — route segments may legitimately contain dots.
            if (
              pathname.startsWith("/@") ||
              pathname.startsWith("/__") ||
              pathname.startsWith("/node_modules") ||
              pathname.startsWith("/src/") ||
              pathname.startsWith("/api/") ||
              (pathname.includes(".") &&
                !pathname.endsWith("/") &&
                devServableFileExists(pathname, [server.config.publicDir, server.config.root]))
            ) {
              return next();
            }

            const startTime = Date.now();

            try {
              const clientEntryUrl = "/.farm/rsc-entries/entry.browser.tsx";
              const ssrEnv = server.environments.ssr;
              (globalThis as any).__VITE_RSC_LOAD_SSR__ = async () => {
                if (ssrEnv) {
                  const ssrSource =
                    (ssrEnv.config?.build as any)?.rollupOptions?.input?.index ??
                    path.join(server.config.root, ".farm/rsc-entries/entry.ssr.tsx");
                  const resolved = await ssrEnv.pluginContainer.resolveId(ssrSource);
                  if (resolved?.id) return loadFarmDevModule(server, resolved.id);
                }
                return loadFarmDevModule(server, "./.farm/rsc-entries/entry.ssr.tsx");
              };
              // When server actions are enabled, prepend an inline assignment so __viteRscCallServer
              // is always a function before any chunk runs (avoids "globalThis.__viteRscCallServer is not a function").
              const bootstrapPrefix = actionsEnabled
                ? `(function(){if(typeof globalThis.__viteRscCallServer!=='function'){globalThis.__viteRscCallServer=function(){return Promise.reject(new Error('Farm.js: server actions not ready'));}}})();\n`
                : "";
              (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__ = async () =>
                bootstrapPrefix +
                `import("/@react-refresh").then(m=>{m.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;return import("/@vite/client");}).then(()=>import(${JSON.stringify(clientEntryUrl)}));`;

              const requestUrl = resolveDevRequestURL(req);
              const isAction =
                actionsEnabled &&
                method === "POST" &&
                !isFarmAPIPathname(requestUrl.pathname, entryContext.apiBasePath) &&
                !isFarmAPIPathname(requestUrl.pathname);
              if (isAction) {
                validateServerActionRequest(
                  new Request(requestUrl, {
                    method,
                    headers: createDevRequestHeaders(req.headers),
                  }),
                  entryContext.serverActions,
                );
              }
              let body: Buffer | undefined;
              if (method !== "GET" && method !== "HEAD") {
                body = await readNodeRequestBody(
                  req,
                  isAction ? entryContext.serverActions.bodySizeLimit : bodySizeLimit,
                );
              }
              const request = new Request(requestUrl, {
                method,
                headers: createDevRequestHeaders(req.headers),
                body:
                  body && body.length > 0
                    ? (body.buffer.slice(
                        body.byteOffset,
                        body.byteOffset + body.byteLength,
                      ) as ArrayBuffer)
                    : undefined,
              });

              // Load the RSC entry in the "rsc" environment so @vitejs/plugin-rsc transforms run with this.environment.name === "rsc".
              // Never evaluate an RSC entry with SSR conditions or share its module cache.
              const rscEnv = server.environments.rsc;
              if (!rscEnv) {
                throw new FarmDevEnvironmentError(
                  '[Farm.js] The "rsc" development environment is missing. Enable @vitejs/plugin-rsc before serving RSC requests.',
                );
              }
              let rscEntry: any = null;
              if (rscEnv) {
                const rscSource =
                  (rscEnv.config?.build as any)?.rollupOptions?.input?.index ??
                  "./.farm/rsc-entries/entry.rsc.tsx";
                const root = server.config.root;
                const importer = path.join(root, "vite.config.ts");
                const absoluteRscEntry = path.resolve(
                  root,
                  ".farm",
                  "rsc-entries",
                  "entry.rsc.tsx",
                );
                const resolved =
                  (await rscEnv.pluginContainer.resolveId(rscSource, importer)) ??
                  (await rscEnv.pluginContainer.resolveId(rscSource)) ??
                  (await rscEnv.pluginContainer.resolveId(absoluteRscEntry));
                const id = resolved?.id ?? pathToFileURL(absoluteRscEntry).href;
                rscEntry = await loadFarmDevModule(server, id, "rsc");
              }
              if (!rscEntry?.default?.fetch)
                throw new Error("[Farm.js] Could not load RSC entry in rsc environment");
              const response = await rscEntry.default.fetch(request, {
                // The rebuilt Request has no socket; the default rate-limit key
                // needs the peer address, as the Nitro handler passes it.
                clientAddress: req.socket?.remoteAddress,
              });

              await sendRscDevelopmentResponse(res, response);
              const duration = Date.now() - startTime;
              logResponse(method, pathname, response.status, duration);
              return;
            } catch (rscError: any) {
              const rejection =
                createFarmRequestBodyErrorResponse(rscError) ??
                createServerActionRequestErrorResponse(rscError);
              if (rejection && !res.headersSent && !res.writableEnded && !res.destroyed) {
                await sendRscDevelopmentResponse(res, rejection);
                return;
              }
              if (res.headersSent || res.writableEnded || res.destroyed) {
                console.error("[Farm.js] RSC dev response error:", rscError);
                if (!res.destroyed)
                  res.destroy(rscError instanceof Error ? rscError : new Error(String(rscError)));
                return;
              }
              // Show the failure. Rendering another page instead (the old legacy
              // SSR fallback) served the wrong page and hid the error.
              const duration = Date.now() - startTime;
              logResponse(method, pathname, 500, duration);
              console.error(`[Farm.js] RSC render failed for ${method} ${pathname}:`, rscError);
              res.statusCode = 500;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(createRscDevErrorDocument(rscError, method, pathname));
            }
          });
        };
      },
    },

    // ────────────────────────────────────────────────────────
    // RSC CORE TRANSFORMS PLUGIN (placeholder for any configResolved logic)
    // @vitejs/plugin-rsc is now injected in the config hook above so its
    // virtual modules (e.g. virtual:vite-rsc/client-references) run in all environments.
    // ────────────────────────────────────────────────────────
    {
      name: "@farm.js/plugin/rsc:core-loader",
      enforce: "pre",
    },

    // ────────────────────────────────────────────────────────
    // HMR PLUGIN
    // Sends HMR updates when server components, middleware, or API routes change
    // ────────────────────────────────────────────────────────
    {
      name: "@farm.js/plugin/rsc:hmr",

      handleHotUpdate({ file, server, modules }) {
        if (!rscEnabled) {
          return;
        }

        const srcDir = entryContext?.srcDir || "src";
        const fileName = file.split("/").pop() || "";

        // Handle middleware changes
        if (fileName.startsWith("middleware.")) {
          logInfo(`Middleware updated: ${fileName}`);
          // Full reload for middleware changes
          server.ws.send({ type: "full-reload", path: "*" });
          return [];
        }

        // Handle API route changes
        if (file.includes("/api/") && fileName.startsWith("route.")) {
          const shortPath = file.split("/api/")[1] || file;
          logInfo(`API route updated: ${shortPath}`);
          // Invalidate modules and reload
          for (const mod of modules) {
            server.moduleGraph.invalidateModule(mod);
          }
          return [];
        }

        // Handle page/layout changes
        if (file.includes(srcDir) && (file.endsWith(".tsx") || file.endsWith(".jsx"))) {
          if (fileName.startsWith("page.") || fileName.startsWith("layout.")) {
            const shortPath = file.split(`/${srcDir}/`)[1] || file;
            logInfo(`Updated: ${shortPath}`);

            // Invalidate modules
            for (const mod of modules) {
              server.moduleGraph.invalidateModule(mod);
            }

            // Full reload for page/layout changes
            server.ws.send({ type: "full-reload", path: "*" });
            return [];
          }

          // Component changes - send HMR update
          logInfo(`HMR update: ${fileName}`);
          server.ws.send({
            type: "custom",
            event: "rsc:update",
            data: { file },
          });
        }

        return modules;
      },
    },
  ];
}
