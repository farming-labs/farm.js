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
 * import { defineConfig } from '@farmjs/plugin/rsc'
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

import { parseAst, type ConfigEnv, type Plugin, type UserConfig } from "vite";
import { init as initModuleLexer, parse as parseModuleImports } from "es-module-lexer";
import type { FarmRscPluginOptions, EntryContext } from "./types.js";
import type { FarmServerActionsConfig } from "@farmjs/core/server-action-security";
import type { FarmLayerEntry, ResolvedFarmLayer } from "@farmjs/core/server";
import { farmEnvironmentFunctionsPlugin } from "@farmjs/core/environment/vite";
import { generateRscEntry } from "./entries/rsc.js";
import { generateSsrEntry } from "./entries/ssr.js";
import { generateClientEntry } from "./entries/client.js";
import { transformFarmServerFns } from "./server-fn-transform.js";
import { resolveRscBuildOutputPath } from "./build-paths.js";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// Use API and middleware plugins from @farmjs/core (require so CJS build resolves when ESM .mjs is missing)
const require_ = createRequire(import.meta.url);
const { farmApiPlugin, farmMiddlewarePlugin } = require_(
  "@farmjs/core",
) as typeof import("@farmjs/core");
const { resolveServerActionsConfig } = require_(
  "@farmjs/core/server-action-security",
) as typeof import("@farmjs/core/server-action-security");
const { normalizeFarmDeploymentId } = require_(
  "@farmjs/core/deployment",
) as typeof import("@farmjs/core/deployment");
const { getFarmLayerAliases, getFarmSourceRoots, resolveFarmLayers } = require_(
  "@farmjs/core/server",
) as typeof import("@farmjs/core/server");

export type { FarmRscPluginOptions, EntryContext };
export { buildRscNitro, waitForRscManifest, waitForRscOutputs } from "./nitro-build.js";
export type { BuildRscNitroOptions } from "./nitro-build.js";
export { default as nitro } from "./vite-plugin-nitro.js";
export type { NitroPluginOptions } from "./vite-plugin-nitro.js";

// Extended config type for Farm.js RSC
export interface FarmRscConfig {
  srcDir?: string;
  extends?: readonly FarmLayerEntry[];
  layers?: readonly ResolvedFarmLayer[];
  outDir?: string;
  basePath?: string;
  port?: number;
  experimental?: {
    serverComponents?: boolean;
    serverActions?: boolean;
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
      serverActions: config.experimental?.serverActions ?? true,
    },
    srcDir: config.srcDir ?? "src",
    extends: config.extends,
    layers: config.layers,
    outDir: config.outDir ?? "dist",
    basePath: config.basePath ?? "/",
    serverActions: config.serverActions,
    deploymentId: config.deploymentId,
    generateBuildId: config.generateBuildId,

    // Vite server configuration
    server: {
      port,
      strictPort: false,
    },

    // Custom logger to hide Vite's default startup banner
    customLogger: createFarmLogger(port, debug),

    // Configure esbuild for JSX transformation
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
    },

    plugins: [
      farmMiddlewarePlugin({ srcDir: config.srcDir ?? "src", debug }),
      farmApiPlugin({ srcDir: config.srcDir ?? "src", debug }),
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
const VIRTUAL_RSC_ENTRY = "virtual:@farmjs/rsc/entry-rsc";
const VIRTUAL_SSR_ENTRY = "virtual:@farmjs/rsc/entry-ssr";
const VIRTUAL_CLIENT_ENTRY = "virtual:@farmjs/rsc/entry-client";
const VIRTUAL_HYDRATE_ENTRY = "virtual:@farmjs/rsc/hydrate";
const FARM_CORE_PACKAGE_ROOT = path.resolve(path.dirname(require_.resolve("@farmjs/core")), "..");

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
    if (!rootEntry) throw new Error("@farmjs/core has no ESM root export");

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
    `[Farm.js] @farmjs/core/${subpath} is not supported in the standalone RSC runtime (${id}). ` +
      "Its external runtime dependencies are not copied into the isolated server output yet. " +
      "Importing it would create a production build that boots but fails when the module is used.",
  );
}

const CORE_ROOT_NAMED_IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*(["'])@farmjs\/core\2\s*$/;

async function rewriteCoreRuntimeImports(code: string, id: string): Promise<string | null> {
  if (!code.includes("@farmjs/core")) return null;
  await initModuleLexer;
  const [moduleImports] = parseModuleImports(code, id);
  const rootImports = moduleImports.filter(
    (moduleImport) => moduleImport.n === "@farmjs/core" && moduleImport.d === -1,
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
        `[Farm.js] Unsupported @farmjs/core import syntax in ${id}. ` +
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
        throw new Error(`[Farm.js] Unsupported @farmjs/core import syntax in ${id}: ${specifier}`);
      }
      const [, imported, local = imported] = match;
      const unsupportedSubpath = unsupportedSources.get(imported);
      if (unsupportedSubpath) {
        throw unsupportedStandaloneSubpathError(unsupportedSubpath, id);
      }
      const subpath = exportSources.get(imported);
      if (!subpath) {
        throw new Error(
          `[Farm.js] The @farmjs/core root export "${imported}" is not available in the standalone RSC runtime. ` +
            "Config, plugin, Vite, build, code-generation, and framework-bootstrap APIs must stay outside application request modules.",
        );
      }
      const imports = grouped.get(subpath) || [];
      imports.push(imported === local ? imported : `${imported} as ${local}`);
      grouped.set(subpath, imports);
    }

    const replacement = Array.from(
      grouped,
      ([subpath, imports]) => `import { ${imports.join(", ")} } from "@farmjs/core/${subpath}";`,
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

  // Context passed to entry generators
  let entryContext: EntryContext;
  /** Set in config when RSC enabled; used by build plugin to run Nitro after client writeBundle. */
  let rscBuildRoot: string | undefined;

  // Store for debugging
  const debug = options.debug ?? false;
  const automaticDeploymentId = `build-${Date.now()}`;

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
    {
      name: "@farmjs/plugin/rsc:core-runtime",
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
        if (isServerEnvironment && id === "@farmjs/core/storage") {
          throw unsupportedStandaloneSubpathError("storage", _importer || "unknown importer");
        }
        if (isServerEnvironment && id === "@farmjs/core") {
          throw new Error(
            "[Farm.js] Standalone RSC runtime modules must use named @farmjs/core imports. " +
              "Namespace/default imports and build-only root exports cannot be bundled safely; use a focused public subpath.",
          );
        }
        return null;
      },
    },
    {
      name: "@farmjs/plugin/rsc:config",
      enforce: "pre",

      async config(config: UserConfig, env: ConfigEnv) {
        const c = config as UserConfig & {
          experimental?: {
            serverComponents?: boolean;
            serverActions?: boolean;
          };
          srcDir?: string;
          outDir?: string;
          basePath?: string;
          root?: string;
          extends?: readonly FarmLayerEntry[];
          layers?: readonly ResolvedFarmLayer[];
          serverActions?: FarmServerActionsConfig;
          deploymentId?: string;
          generateBuildId?: () => string | Promise<string>;
        };
        // Check if user enabled RSC in their config
        rscEnabled = c.experimental?.serverComponents === true;
        actionsEnabled = c.experimental?.serverActions === true;

        logInfo(`RSC enabled: ${rscEnabled}`);
        logInfo(`Actions enabled: ${actionsEnabled}`);

        // If RSC not enabled, don't add environment config
        if (!rscEnabled) {
          return;
        }

        const root = c.root ?? process.cwd();
        if (c.extends?.length) {
          const layerResolution = await resolveFarmLayers(c, {
            root,
            mode: process.env.NODE_ENV === "production" ? "production" : "development",
          });
          Object.assign(c, layerResolution.config);
        }

        // Read user's directory configuration
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
        // Build context for entry generators
        entryContext = {
          srcDir,
          outDir,
          basePath: c.basePath ?? "/",
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
          debug,
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
        logInfo(`Wrote RSC entries to ${entriesDir}`);

        // User must add rsc({ entries: { rsc, ssr, client } }) to config.plugins so the RSC plugin
        // runs for every environment and client build can resolve virtual:vite-rsc/client-references.

        // Entry paths (relative to root) so Vite runs rsc/ssr/client builds (not index.html).
        const entryRsc = "./.farm/rsc-entries/entry.rsc.tsx";
        const entrySsr = "./.farm/rsc-entries/entry.ssr.tsx";
        const entryClient = "./.farm/rsc-entries/entry.browser.tsx";

        // Resolve @farmjs/core so Vite (and rsc/ssr envs) can load it when app code imports it (fixes "Failed to resolve entry" in dev).
        let farmCorePath: string | null = null;
        try {
          farmCorePath = path.dirname(require_.resolve("@farmjs/core/package.json"));
        } catch {
          try {
            farmCorePath = path.resolve(
              path.dirname(require_.resolve("@farmjs/core/server")),
              "..",
            );
          } catch {
            // @farmjs/core not installed or not built; core aliases are not added
          }
        }
        const layerAliases = getFarmLayerAliases(c.layers);

        // Return shared config and environments. RSC plugin (in plugins) needs to run in same
        // pipeline for client build to resolve virtual:vite-rsc/client-references.
        return {
          appType: "custom" as const,
          builder: { sharedConfigBuild: true } as any,
          ssr: {
            external: [
              "react",
              "react-dom",
              "react-dom/server",
              "react/jsx-runtime",
              "react/jsx-dev-runtime",
            ],
          },
          resolve: {
            dedupe: ["react", "react-dom"],
            alias: [
              ...Object.entries(layerAliases).map(([find, replacement]) => ({
                find,
                replacement,
              })),
              ...(farmCorePath
                ? [
                    {
                      find: /^@farmjs\/core\/middleware$/,
                      replacement: path.join(farmCorePath, "dist/middleware.mjs"),
                    },
                    {
                      find: /^@farmjs\/core\/api$/,
                      replacement: path.join(farmCorePath, "dist/api.mjs"),
                    },
                    {
                      find: /^@farmjs\/core\/server-fn$/,
                      replacement: path.join(farmCorePath, "dist/server-fn.mjs"),
                    },
                    {
                      find: /^@farmjs\/core\/server-action-security$/,
                      replacement: path.join(farmCorePath, "dist/server-action-security.mjs"),
                    },
                    {
                      find: /^@farmjs\/core\/environment$/,
                      replacement: path.join(farmCorePath, "dist/environment.mjs"),
                    },
                    {
                      find: /^@farmjs\/core\/headers$/,
                      replacement: path.join(farmCorePath, "dist/headers.mjs"),
                    },
                    ...(env.command === "serve"
                      ? [
                          {
                            find: /^@farmjs\/core$/,
                            replacement: path.join(farmCorePath, "dist/index.mjs"),
                          },
                        ]
                      : []),
                  ]
                : []),
            ],
          },
          esbuild: {
            jsx: "automatic",
            jsxImportSource: "react",
          },
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
              resolve: { conditions: ["react-server", "node", "import"] },
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
            },
          },
        };
      },
    },

    {
      name: "@farmjs/plugin/rsc:server-fn-actions",
      enforce: "pre",

      transform(code, id) {
        if (!rscEnabled || !actionsEnabled) return null;

        const result = transformFarmServerFns(code, id);
        if (!result) return null;

        return {
          code: result.code,
          map: null,
        };
      },
    },

    // Nitro: run after all environments (like @hiogawa/vite-plugin-nitro). If the runtime supports
    // plugin buildApp order "post", this runs automatically; else use build script (see comment below).
    {
      name: "@farmjs/plugin/rsc:nitro-build",
      apply: "build",
      buildApp: {
        order: "post",
        handler: async (builder: {
          environments: Record<
            string,
            { config: { build: { outDir: string; assetsDir?: string } } }
          >;
        }) => {
          if (!rscEnabled || !rscBuildRoot || !entryContext) return;
          if ((globalThis as any).__FARM_NITRO_PLUGIN_RAN) return;
          const root = path.resolve(rscBuildRoot);
          if ((globalThis as any).__FARM_NITRO_PATHS) {
            const { runNitroFromBuildApp } = await import("./vite-plugin-nitro.js");
            await runNitroFromBuildApp();
            return;
          }
          const rscEnv = builder.environments?.rsc;
          const ssrEnv = builder.environments?.ssr;
          const clientEnv = builder.environments?.client;
          if (!rscEnv || !ssrEnv || !clientEnv) return;
          const { buildRscNitro } = await import("./nitro-build.js");
          await buildRscNitro({
            root,
            rendererPath: resolveRscBuildOutputPath(root, rscEnv.config.build.outDir, "index.js"),
            publicDir: resolveRscBuildOutputPath(root, clientEnv.config.build.outDir),
            ssrPath: resolveRscBuildOutputPath(root, ssrEnv.config.build.outDir, "index.js"),
            assetsDir: clientEnv.config.build.assetsDir,
            preset: process.env.NITRO_PRESET || "vercel",
          });
        },
      },
    } as Plugin,

    // ────────────────────────────────────────────────────────
    // VIRTUAL ENTRIES PLUGIN
    // Generates entry files dynamically based on user's project structure
    // ────────────────────────────────────────────────────────
    {
      name: "@farmjs/plugin/rsc:virtual-entries",
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
} from '@farmjs/core/deployment';
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
  const error = new Error(p?.returnValue?.data?.message || 'Server function failed');
  error.name = 'ServerActionError';
  throw error;
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
      name: "@farmjs/plugin/rsc:dev-server",

      configureServer(server) {
        if (!rscEnabled) {
          return;
        }

        logInfo("Dev server middleware ready");
        const serverStartTime = Date.now();
        let bannerPrinted = false;
        const pageCache = new Map<string, any>();

        server.httpServer?.once("listening", () => {
          if (bannerPrinted) return;
          bannerPrinted = true;
          const elapsed = Date.now() - serverStartTime;
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address ? address.port : 3000;
          const colors = getColors();

          console.log("");
          console.log(
            `  ${colors.bold(colors.green("Farm.js"))} ${colors.dim("v1.0.0")} ${colors.dim(`ready in ${elapsed}ms`)}`,
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

            if (
              pathname.startsWith("/@") ||
              pathname.startsWith("/__") ||
              pathname.startsWith("/node_modules") ||
              pathname.startsWith("/src/") ||
              pathname.startsWith("/api/") ||
              (pathname.includes(".") && !pathname.endsWith("/"))
            ) {
              return next();
            }

            const startTime = Date.now();

            try {
              const clientEntryUrl = "/.farm/rsc-entries/entry.browser.tsx";
              const ssrEnv = (server as any).environments?.ssr;
              (globalThis as any).__VITE_RSC_LOAD_SSR__ = async () => {
                if (ssrEnv) {
                  const ssrSource =
                    (ssrEnv.config?.build as any)?.rollupOptions?.input?.index ??
                    path.join(server.config.root, ".farm/rsc-entries/entry.ssr.tsx");
                  const resolved = await ssrEnv.pluginContainer.resolveId(ssrSource, undefined, {
                    ssr: true,
                  });
                  if (resolved?.id) return ssrEnv.runner.import(resolved.id);
                }
                return server.ssrLoadModule("./.farm/rsc-entries/entry.ssr.tsx");
              };
              // When server actions are enabled, prepend an inline assignment so __viteRscCallServer
              // is always a function before any chunk runs (avoids "globalThis.__viteRscCallServer is not a function").
              const bootstrapPrefix = actionsEnabled
                ? `(function(){if(typeof globalThis.__viteRscCallServer!=='function'){globalThis.__viteRscCallServer=function(){return Promise.reject(new Error('Farm.js: server actions not ready'));}}})();\n`
                : "";
              (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__ = async () =>
                bootstrapPrefix +
                `import("/@react-refresh").then(m=>{m.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;return import("/@vite/client");}).then(()=>import(${JSON.stringify(clientEntryUrl)}));`;

              const base = `http://${req.headers.host || "localhost:3000"}`;
              let body: Buffer | undefined;
              if (method === "POST") {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk as Buffer);
                body = Buffer.concat(chunks);
                // Keep as buffer so request.formData() / request.text() in RSC handler work (multipart must not be UTF-8 decoded)
              }
              const request = new Request(new URL(url, base), {
                method,
                headers: req.headers as HeadersInit,
                body:
                  method === "POST" && body && body.length > 0
                    ? (body as unknown as BodyInit)
                    : undefined,
              });

              // Load the RSC entry in the "rsc" environment so @vitejs/plugin-rsc transforms run with this.environment.name === "rsc".
              // Fallback: when Farm dev server has no rsc environment, load via main server so streaming/loading still works.
              const rscEnv = (server as any).environments?.rsc;
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
                  (await rscEnv.pluginContainer.resolveId(rscSource, importer, {
                    ssr: true,
                  })) ??
                  (await rscEnv.pluginContainer.resolveId(rscSource, undefined, { ssr: true })) ??
                  (await rscEnv.pluginContainer.resolveId(absoluteRscEntry, undefined, {
                    ssr: true,
                  }));
                const id = resolved?.id ?? pathToFileURL(absoluteRscEntry).href;
                rscEntry = await rscEnv.runner.import(id);
              }
              if (!rscEntry?.default?.fetch) {
                try {
                  rscEntry = await server.ssrLoadModule("./.farm/rsc-entries/entry.rsc.tsx");
                } catch (_) {
                  // Ignore; will fall through to legacy handler
                }
              }
              if (!rscEntry?.default?.fetch)
                throw new Error("[Farm.js] Could not load RSC entry in rsc environment");
              const response = await rscEntry.default.fetch(request);

              res.statusCode = response.status;
              response.headers.forEach((value: string, key: string) => {
                if (key.toLowerCase() !== "transfer-encoding") res.setHeader(key, value);
              });
              if (response.body) {
                const reader = response.body.getReader();
                const pump = async () => {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                  }
                  res.end();
                };
                await pump();
              } else {
                res.end();
              }
              const duration = Date.now() - startTime;
              logResponse(method, pathname, response.status, duration);
              return;
            } catch (rscError: any) {
              // RSC pipeline failed; fall back to legacy SSR for GET only
              if (method !== "GET") {
                const duration = Date.now() - startTime;
                logResponse(method, pathname, 500, duration);
                console.error("[Farm.js] RSC dev handler error:", rscError);
                res.statusCode = 500;
                res.setHeader("Content-Type", "text/html");
                res.end(
                  `<!DOCTYPE html><html><head><title>Error</title></head><body><pre>${(rscError as Error).message}</pre></body></html>`,
                );
                return;
              }
            }

            try {
              if (method !== "GET") return next();
              // Get middleware data from standalone middleware plugin
              const middlewareData = (req as any).__FARM_MIDDLEWARE_DATA__ || {};

              // Build the glob pattern for discovering routes (Farm convention: src/app when routesDir unset)
              const srcDir = entryContext.srcDir;
              const appSegment =
                entryContext.routesDir === undefined ? "app" : entryContext.routesDir.trim();
              const glob = appSegment ? `/${srcDir}/${appSegment}` : `/${srcDir}`;

              // Find matching page file
              const normalized = pathname.replace(/\/$/, "") || "/";

              // Common page file patterns
              const possiblePaths = [
                `${glob}${normalized === "/" ? "" : normalized}/page.tsx`,
                `${glob}${normalized === "/" ? "" : normalized}/page.jsx`,
                `${glob}/page.tsx`,
                `${glob}/page.jsx`,
              ];

              // Also check for dynamic routes by walking up the path
              const parts = normalized.split("/").filter(Boolean);
              for (let i = parts.length; i >= 0; i--) {
                const base = parts.slice(0, i).join("/");
                possiblePaths.push(base ? `${glob}/${base}/page.tsx` : `${glob}/page.tsx`);
                possiblePaths.push(base ? `${glob}/${base}/page.jsx` : `${glob}/page.jsx`);
              }

              let pageModule: any = null;
              let matchedPath = "";
              let layoutModule: any = null;

              // Try to find and load the page
              for (const pagePath of possiblePaths) {
                try {
                  // Convert glob path to actual file path
                  const actualPath = pagePath.startsWith("/") ? `.${pagePath}` : pagePath;

                  if (pageCache.has(pagePath)) {
                    pageModule = pageCache.get(pagePath);
                    matchedPath = pagePath;
                    break;
                  }

                  pageModule = await server.ssrLoadModule(actualPath);
                  if (pageModule?.default) {
                    pageCache.set(pagePath, pageModule);
                    matchedPath = pagePath;
                    // Page loaded successfully
                    break;
                  }
                } catch (e) {
                  // Page not found at this path, continue
                }
              }

              if (!pageModule?.default) {
                return next();
              }

              try {
                const layoutPath = `./${srcDir}${appSegment ? `/${appSegment}` : ""}/layout.tsx`;
                layoutModule = await server.ssrLoadModule(layoutPath);
              } catch {}

              const React = await import("react");
              const ReactDOMServer = await import("react-dom/server");

              const Page = pageModule.default;
              const metadata = {
                title:
                  typeof pageModule.metadata?.title === "string"
                    ? pageModule.metadata.title
                    : layoutModule?.metadata?.title,
                description:
                  typeof pageModule.metadata?.description === "string"
                    ? pageModule.metadata.description
                    : layoutModule?.metadata?.description,
              };
              const Layout = layoutModule?.default;

              // Parse URL params (basic dynamic route support)
              const params: Record<string, string> = {};
              const searchParams = Object.fromEntries(new URLSearchParams(url.split("?")[1] || ""));

              // Render the page with middleware data
              const pageProps = {
                params,
                searchParams,
                // Middleware shared data is available to pages
                middlewareData,
              };

              // Helper to check if a function is async or returns a Promise
              // We need to actually call the function to detect this reliably
              // since transpiled async functions may not be detectable by constructor
              const isAsyncFunction = (fn: any): boolean => {
                if (!fn) return false;
                // Check if it's an AsyncFunction
                if (fn.constructor?.name === "AsyncFunction") return true;
                // Check if function.toString() contains async
                try {
                  const str = fn.toString();
                  // Check for "async function" or "async (" patterns
                  if (/^async\s/.test(str) || /^async\s*\(/.test(str)) return true;
                } catch {}
                return false;
              };

              // Try to render the page - if it returns a Promise, it's async
              let pageContent;
              let isAsyncPage = isAsyncFunction(Page);

              try {
                const result = Page(pageProps);
                // Check if result is a Promise (thenable)
                if (result && typeof result.then === "function") {
                  isAsyncPage = true;
                  pageContent = await result;
                } else {
                  // If it's not a Promise, it's a React element or we need to use createElement
                  if (React.default.isValidElement(result)) {
                    pageContent = result;
                  } else {
                    pageContent = React.default.createElement(Page, pageProps);
                  }
                }
              } catch (e: any) {
                // If calling directly failed, use createElement
                pageContent = React.default.createElement(Page, pageProps);
              }

              // Check if Layout is async
              let isAsyncLayout = isAsyncFunction(Layout);

              // Wrap in layout if available
              let content = pageContent;
              if (Layout) {
                try {
                  const layoutResult = Layout({ children: pageContent });
                  if (layoutResult && typeof layoutResult.then === "function") {
                    isAsyncLayout = true;
                    content = await layoutResult;
                  } else if (React.default.isValidElement(layoutResult)) {
                    content = layoutResult;
                  } else {
                    content = React.default.createElement(Layout, null, pageContent);
                  }
                } catch (e) {
                  content = React.default.createElement(Layout, null, pageContent);
                }
              }

              // Create full HTML page
              const h = React.default.createElement;
              const isSyncPage = !isAsyncPage && !isAsyncLayout;
              // For sync pages we load preamble + vite client + hydrate in one script below; do not load vite-client in head so order is guaranteed.
              const routesDir =
                entryContext.routesDir === undefined ? "app" : entryContext.routesDir.trim();
              const routesPath = routesDir ? `/${routesDir}` : "";
              const headElements = [
                h("meta", { key: "charset", charSet: "utf-8" }),
                h("meta", {
                  key: "viewport",
                  name: "viewport",
                  content: "width=device-width, initial-scale=1",
                }),
                metadata.title
                  ? h("title", { key: "title" }, metadata.title)
                  : h("title", { key: "title" }, "Farm.js"),
                metadata.description
                  ? h("meta", {
                      key: "description",
                      name: "description",
                      content: metadata.description,
                    })
                  : null,
                h("link", {
                  key: "globals-css",
                  rel: "stylesheet",
                  href: `/${srcDir}${routesPath}/globals.css`,
                }),
                ...(isSyncPage
                  ? []
                  : [
                      h("script", {
                        key: "vite-client",
                        type: "module",
                        src: "/@vite/client",
                      }),
                    ]),
              ].filter(Boolean);

              // Create body elements
              // For async (server) pages, we don't hydrate the page itself - only client components within
              // For sync pages, we can hydrate the whole thing
              const bodyElements: any[] = [h("div", { key: "root", id: "root" }, content)];

              // Only add hydration script for sync pages (non-async)
              // When server actions are enabled, set __viteRscCallServer first so form submission works.
              if (actionsEnabled) {
                bodyElements.push(
                  h("script", {
                    key: "rsc-call-server",
                    dangerouslySetInnerHTML: {
                      __html: `(function(){if(typeof globalThis.__viteRscCallServer!=='function'){globalThis.__viteRscCallServer=function(){return Promise.reject(new Error('Farm.js: server actions not ready'));}}})();`,
                    },
                  }),
                );
              }
              // Set React refresh preamble synchronously first so "use client" components don't throw when they load.
              if (!isAsyncPage && !isAsyncLayout) {
                bodyElements.push(
                  h("script", {
                    key: "preamble-sync",
                    dangerouslySetInnerHTML: {
                      __html: `window.__vite_plugin_react_preamble_installed__=true;window.$RefreshReg$=function(){};window.$RefreshSig$=function(){return function(t){return t;}};`,
                    },
                  }),
                  h("script", {
                    key: "page-props",
                    dangerouslySetInnerHTML: {
                      __html: `window.__PAGE_PROPS__ = ${JSON.stringify(pageProps)};`,
                    },
                  }),
                  h("script", {
                    key: "hydrate",
                    type: "module",
                    dangerouslySetInnerHTML: {
                      __html: `import("/@react-refresh").then(m=>{m.default.injectIntoGlobalHook(window);return import("/@vite/client");}).then(()=>import(${JSON.stringify(`/@rsc-hydrate${normalized}`)}));`,
                    },
                  }),
                );
              } else {
                // For async pages, we need to hydrate client component islands
                // Load a minimal script that finds and hydrates "use client" components
                bodyElements.push(
                  h("script", {
                    key: "client-islands",
                    type: "module",
                    dangerouslySetInnerHTML: {
                      __html: `
// Hydrate client component islands
import '/@vite/client';

// Find all client components and hydrate them
// The actual hydration is handled by @vitejs/plugin-rsc transforms
`,
                    },
                  }),
                );
              }

              const fullPage = h(
                "html",
                { lang: "en" },
                h("head", null, ...headElements),
                h("body", null, ...bodyElements),
              );

              const html = "<!DOCTYPE html>" + ReactDOMServer.renderToString(fullPage);

              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html");
              res.end(html);

              const duration = Date.now() - startTime;
              logResponse("GET", pathname, 200, duration);
            } catch (error: any) {
              const duration = Date.now() - startTime;
              logResponse("GET", pathname, 500, duration);
              console.error(error);

              // Return error page
              res.statusCode = 500;
              res.setHeader("Content-Type", "text/html");
              res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>Error</title></head>
                <body style="font-family: system-ui; padding: 2rem; background: #1a1a2e; color: #eee;">
                  <h1 style="color: #ff6b6b;">Error</h1>
                  <pre style="background: #16213e; padding: 1rem; border-radius: 8px; overflow: auto;">${error.stack || error.message}</pre>
                </body>
                </html>
              `);
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
      name: "@farmjs/plugin/rsc:core-loader",
      enforce: "pre",
    },

    // ────────────────────────────────────────────────────────
    // HMR PLUGIN
    // Sends HMR updates when server components, middleware, or API routes change
    // ────────────────────────────────────────────────────────
    {
      name: "@farmjs/plugin/rsc:hmr",

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
