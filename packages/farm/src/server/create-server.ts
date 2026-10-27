import type { ViteDevServer } from "vite";
import type { FarmConfig } from "../types";
import { farmI18nClientBridgePlugin, farmPlugin, farmServerOnlyEntriesPlugin } from "../vite";
import { logger } from "../utils";
import { readSchemaTables } from "../schema-owner";
import {
  isResolvedFarmConfig,
  loadConfig,
  resolveConfig,
  type FarmUserConfig,
  type ResolvedFarmConfig,
} from "../config";
import { setEnv, type EnvParser } from "../env";
import { PluginManager } from "../plugin";
import {
  closeViteDevServer,
  createFarmDevLifecyclePlugin,
  createViteDevServer,
} from "./dev-lifecycle";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";
import fs from "fs";
import path from "path";
import {
  createRedirectsPlugin,
  createHeadersPlugin,
  createRewritesPlugin,
  createCompressionPlugin,
  createLoggerPlugin,
} from "../plugins";
import { createFarmInfraAnalyticsPlugin } from "../plugins/infra-analytics";
import {
  createFarmClientOptimizeDepsConfig,
  createFarmClientOptimizeDepsEntries,
  mergeFarmViteConfig,
} from "./vite-config";
import { FARM_VERSION } from "../version";
import { getFarmAppDirectories } from "../layers";
import { createCliColors } from "../cli-colors";
import { createFarmThemeCssPlugin } from "../theme/vite";
import { loadTailwindVitePlugin } from "../build/tailwind";
import { loadFarmDocsEngine } from "../docs/engine";
import { resolveFarmImageProviderForRuntime } from "../image-runtime";
import {
  createFarmInstrumentationLifecycle,
  loadFarmInstrumentation,
  resolveFarmInstrumentationFile,
  type FarmInstrumentationLifecycle,
} from "../instrumentation";
import { isReactRenderer, loadFarmRendererVitePlugins, resolveFarmRenderer } from "../renderer";
import { createFarmReactRefreshPlugins } from "../react-refresh";

export const DEFAULT_FARM_DEV_SERVER_PORT = 3000;

// Farm.js branding plugin for createServer
function createBrandingPlugin() {
  let serverStarted = false;
  let startTime = Date.now();

  return {
    name: "farm:branding",
    enforce: "pre" as const,
    configureServer(server: ViteDevServer) {
      startTime = Date.now();

      const originalListen = server.listen.bind(server);
      server.listen = async (port?: number, ...args: any[]) => {
        const result = await originalListen(port, ...args);
        if (!serverStarted) {
          serverStarted = true;
          const elapsed = Date.now() - startTime;
          const address = server.httpServer?.address();
          const resolvedPort =
            typeof address === "object" && address
              ? address.port
              : server.config.server.port || port || 3000;

          const pc = createCliColors();
          console.log("");
          console.log(
            `  ${pc.bold(pc.green("Farm.js"))} ${pc.dim(`v${FARM_VERSION}`)} ${pc.dim(`ready in ${elapsed}ms`)}`,
          );
          console.log("");
          console.log(
            `  ${pc.dim("➜")}  ${pc.bold("Local:")}   ${pc.cyan(`http://localhost:${resolvedPort}/`)}`,
          );
          console.log(`  ${pc.dim("➜")}  ${pc.bold("Network:")} ${pc.dim("use --host to expose")}`);
          console.log("");
        }
        return result;
      };
    },
  };
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

  return candidates.some((file) => fs.existsSync(path.join(root, file)));
}

function createDevDependencyStubsPlugin() {
  const stubs: Record<string, string> = {
    "supports-color":
      "const disabled = false; export default { stdout: disabled, stderr: disabled }; export const stdout = disabled; export const stderr = disabled;",
  };

  return {
    name: "farm:dev-dependency-stubs",
    enforce: "pre" as const,
    resolveId(id: string) {
      if (id in stubs) {
        return `\0farm-dev-dependency-stub:${id}`;
      }
      return null;
    },
    load(id: string) {
      if (!id.startsWith("\0farm-dev-dependency-stub:")) {
        return null;
      }

      const moduleName = id.slice("\0farm-dev-dependency-stub:".length);
      return stubs[moduleName] || null;
    },
  };
}

/**
 * A --port flag outranks the app's config. It goes into the config, not only
 * listen(), because Vite rebuilds the server from config when it restarts (an
 * edited .env does that) and would otherwise move to the configured port.
 */
function withPortFlag(vite: FarmConfig["vite"], port: number | undefined): FarmConfig["vite"] {
  return port === undefined ? vite : { ...vite, server: { ...vite?.server, port } };
}

function inlineEnvScope(scope: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(scope || {}).map(([key, value]) => [
      key,
      typeof value === "function" ||
      (value && typeof value === "object" && "parse" in value && typeof value.parse === "function")
        ? (value as EnvParser)
        : () => value,
    ]),
  );
}

async function resolveInlineConfig(
  config: FarmConfig,
  mode: "development" | "production",
): Promise<ResolvedFarmConfig> {
  // Programmatic callers can pass resolveConfig's output. Re-resolving it would
  // parse environment values again and duplicate layer/integration plugins.
  if (isResolvedFarmConfig(config)) {
    setEnv(config.env);
    return { ...config };
  }

  // The runtime config type also permits individually resolved fields. Keep
  // their ownership and disabled state instead of treating them as user input.
  const docs = config.docs;
  const resolvedDocs =
    docs && typeof docs === "object" && "enabled" in docs && "entry" in docs && "config" in docs
      ? docs
      : undefined;
  const i18n = config.i18n;
  const resolvedI18n = i18n && "enabled" in i18n ? i18n : undefined;
  const auth = config.auth;
  const resolvedAuth =
    auth &&
    typeof auth === "object" &&
    typeof auth.emailAndPassword === "object" &&
    "enabled" in auth.emailAndPassword
      ? auth
      : undefined;
  const resolved = await resolveConfig(
    {
      ...config,
      ...(resolvedDocs ? { docs: false } : {}),
      ...(resolvedI18n ? { i18n: false } : {}),
      ...(resolvedAuth ? { auth: false } : {}),
      ...(config.layers ? { extends: [] } : {}),
      // FarmConfig also accepts literal runtime env values. Adapt only inline
      // input; file/layer config keeps the normal parser validation contract.
      env: config.env && {
        server: inlineEnvScope(config.env.server),
        public: inlineEnvScope(config.env.public),
      },
    },
    mode,
  );
  if (resolvedDocs) resolved.docs = resolvedDocs as ResolvedFarmConfig["docs"];
  if (resolvedI18n) resolved.i18n = resolvedI18n;
  if (resolvedAuth) resolved.auth = resolvedAuth as ResolvedFarmConfig["auth"];
  if (config.layers) {
    resolved.extends = config.extends || [];
    resolved.layers = [...config.layers];
  }
  return resolved;
}

/**
 * Create a Vite development server with Farm.js integration
 */
export async function createServer(
  config: FarmConfig | FarmUserConfig = {},
  options: { port?: number } = {},
) {
  let pluginManager: PluginManager | null = null;
  let instrumentation: FarmInstrumentationLifecycle | null = null;
  let server: ViteDevServer | undefined;
  let pendingViteServer: ViteDevServer | undefined;
  try {
    const root = config.root || process.cwd();

    // Load farm.config.ts if it exists
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    const userConfig = await loadConfig(root, undefined, mode);
    // experimental.serverComponents: the RSC pipeline serves the app instead of Farm's renderer.
    const rscConfig = userConfig ?? config;
    if (rscConfig.experimental?.serverComponents === true) {
      const { createFarmRscDevServer } = await import("../rsc-pipeline");
      return await createFarmRscDevServer(rscConfig, { root, port: options.port });
    }

    const resolvedConfig = userConfig
      ? await resolveConfig(userConfig, mode)
      : await resolveInlineConfig(config, mode);
    const instrumentationRoot = resolvedConfig.root;
    const instrumentationFile = resolveFarmInstrumentationFile(
      instrumentationRoot,
      resolvedConfig.srcDir,
    );
    const instrumentationModule = await loadFarmInstrumentation(
      instrumentationFile,
      instrumentationRoot,
    );
    instrumentation = createFarmInstrumentationLifecycle(instrumentationModule, {
      root: instrumentationRoot,
      mode,
      runtime: "nodejs",
    });
    await instrumentation.start();

    // Initialize plugin manager
    pluginManager = new PluginManager({
      config: resolvedConfig,
      isDev: mode === "development",
      isProd: mode === "production",
    });

    // File and inline config share the same plugin registration path.
    const redirects = await resolvedConfig.redirects();
    const headers = await resolvedConfig.headers();
    const rewrites = await resolvedConfig.rewrites();

    if (redirects.length > 0) {
      pluginManager.addPlugin(createRedirectsPlugin(redirects, { i18n: resolvedConfig.i18n }));
    }

    if (headers.length > 0) {
      pluginManager.addPlugin(createHeadersPlugin(headers, { i18n: resolvedConfig.i18n }));
    }

    if (rewrites.length > 0) {
      pluginManager.addPlugin(createRewritesPlugin(rewrites, { i18n: resolvedConfig.i18n }));
    }

    // Compression is applied by production adapters. Its hook is a no-op in
    // development, so do not put every dev response through that lifecycle.
    if (resolvedConfig.compress && mode === "production") {
      pluginManager.addPlugin(createCompressionPlugin());
    }

    pluginManager.addPlugins(resolvedConfig.plugins);

    // Only an app whose environment links it to a Farm Infra project gets this plugin.
    const infraAnalytics =
      resolvedConfig.analytics !== false ? createFarmInfraAnalyticsPlugin() : null;
    if (infraAnalytics) pluginManager.addPlugin(infraAnalytics);

    if (mode === "development") {
      const hasLogger = pluginManager.getPlugins().some((p) => p.name === "farm:logger");
      if (!hasLogger) {
        pluginManager.addPlugin(createLoggerPlugin());
      }
    }

    // Run config hooks
    await pluginManager.runHookParallel("init");

    let finalConfig: FarmConfig = resolvedConfig;
    finalConfig = await pluginManager.runHookSerial("config", finalConfig);
    finalConfig.renderer = resolveFarmRenderer(finalConfig.renderer);
    const projectRoot = finalConfig.root || process.cwd();
    finalConfig.images = resolveFarmImageProviderForRuntime(finalConfig.images, {
      root: projectRoot,
      dev: true,
    });
    if (finalConfig.docs && (finalConfig.docs === true || finalConfig.docs.enabled !== false)) {
      await loadFarmDocsEngine();
    }
    const rendererVitePlugins = await loadFarmRendererVitePlugins(
      finalConfig.renderer,
      projectRoot,
      { ssr: true },
    );
    const reactRefreshPlugins = isReactRenderer(finalConfig.renderer)
      ? await createFarmReactRefreshPlugins()
      : [];

    let tailwindVitePlugin: any = undefined;
    const shouldUseProjectPostcss = hasProjectPostcssConfig(projectRoot);
    if (shouldUseProjectPostcss) {
      logger.info("📦 Using project PostCSS/Tailwind configuration");
    } else {
      tailwindVitePlugin = await loadTailwindVitePlugin();
    }

    server = await createViteDevServer(
      mergeFarmViteConfig(
        {
          root: projectRoot,
          css: shouldUseProjectPostcss ? undefined : { postcss: { plugins: [] } },
          plugins: [
            createFarmThemeCssPlugin(finalConfig.theme, finalConfig.basePath),
            ...(tailwindVitePlugin ? [tailwindVitePlugin] : []),
            ...(rendererVitePlugins as any[]),
            ...reactRefreshPlugins,
            createDevDependencyStubsPlugin(),
            farmI18nClientBridgePlugin(),
            farmServerOnlyEntriesPlugin(),
            farmPlugin(finalConfig, pluginManager),
            farmEnvironmentFunctionsPlugin(finalConfig),
            createBrandingPlugin(),
            createFarmDevLifecyclePlugin(pluginManager, instrumentation),
          ],
          server: {
            middlewareMode: false,
            port: DEFAULT_FARM_DEV_SERVER_PORT,
            strictPort: true,
          },
          resolve: {
            // Keep framework and application modules on one renderer runtime.
            dedupe: [...(finalConfig.renderer.dedupe || [])],
          },
          optimizeDeps: {
            ...createFarmClientOptimizeDepsConfig(
              createFarmClientOptimizeDepsEntries(projectRoot, getFarmAppDirectories(finalConfig)),
              finalConfig.renderer,
            ),
            exclude: [
              "@farm.js/core/server",
              "@farm.js/core/api",
              "@farm.js/core/middleware",
              "@farm.js/core/config",
              "nitro",
              "h3",
              "vite",
              "esbuild",
              "rollup",
              "fsevents",
              "nf3",
              "zod",
              "supports-color",
              "node-fetch",
              "consola",
              "mock-aws-s3",
              "aws-sdk",
              "nock",
              "lightningcss",
              "@tailwindcss/oxide",
            ],
          },
          ssr: {
            noExternal: ["farm"],
          },
          customLogger: {
            info: () => {},
            warn: () => {},
            warnOnce: () => {},
            error: (msg) => logger.error(String(msg)),
            clearScreen: () => {},
            hasErrorLogged: () => false,
            hasWarned: false,
          },
        },
        withPortFlag(finalConfig.vite, options.port),
      ),
      (candidate) => {
        pendingViteServer = candidate;
      },
    );

    pendingViteServer = undefined;
    (server as any).__farmPluginManager = pluginManager;
    (server as any).__farmResolvedConfig = resolvedConfig;
    (server as any).__farmInstrumentation = instrumentation;
    // Update plugin manager with vite server
    pluginManager.updateContext({ config: finalConfig, viteServer: server });
    await pluginManager.setupPlugins();
    await pluginManager.runHookParallel("devServerCreated", server);

    // Run configResolved hooks
    await pluginManager.runHookParallel("configResolved", finalConfig);

    // Run buildStart hooks
    await pluginManager.runHookParallel("buildStart");

    return server;
  } catch (error) {
    // The caller never receives a server on failure, so creation owns cleanup.
    // Report secondary failures without replacing the original startup error or
    // preventing the remaining resources from being released.
    const attempt = async (operation: string, run: () => unknown) => {
      try {
        await run();
      } catch (cleanupError) {
        console.error(`Failed to ${operation} after a server creation failure:`, cleanupError);
      }
    };
    await attempt("run plugin error hooks", () =>
      pluginManager?.runHookParallel("onError", {
        phase: "createServer",
        error,
      }),
    );
    if (server) {
      // The existing close owner drains Vite, plugins, and instrumentation,
      // even when an individual shutdown step rejects.
      await attempt("close the dev server", server.close.bind(server));
    } else {
      const partialServer = pendingViteServer;
      if (partialServer) {
        await attempt("close the partially created Vite server", () =>
          closeViteDevServer(partialServer, partialServer.close.bind(partialServer)),
        );
      }
      // Construction may fail before the lifecycle wrapper is installed.
      // These owners are idempotent if a late Vite hook fails after installation.
      await attempt("close the plugin runtime", () =>
        pluginManager?.closeRuntime("dev-server-creation-failed"),
      );
      await attempt("shut down instrumentation", () => instrumentation?.shutdown());
    }
    logger.error(`Failed to create server: ${error}`);
    throw error;
  }
}

/**
 * Say, once the server is up, which plugins have table changes migrate would
 * apply. Not awaited, and loaded only when some plugin or integration owns
 * tables, so it costs nothing otherwise and can never delay startup.
 */
/** @internal Exported for tests. True when the notice was started. */
export function noticeSchemaChangesInBackground(
  config: Awaited<ReturnType<typeof resolveConfig>> | null | undefined,
): boolean {
  if (!config) return false;
  const candidates = [
    ...(config.plugins ?? []),
    ...Object.values((config.integrations ?? {}) as Record<string, unknown>),
  ];
  if (!candidates.some((candidate) => readSchemaTables(candidate))) return false;
  void import("../schema-dev-notice")
    .then(({ noticePendingSchemaChanges }) => noticePendingSchemaChanges(config as never))
    .catch(() => {});
  return true;
}

/**
 * Start the development server
 */
export async function startDevServer(config: FarmConfig | FarmUserConfig = {}, port?: number) {
  const server = await createServer(config, { port });
  const pluginManager = (server as any).__farmPluginManager as PluginManager | undefined;

  try {
    await server.listen(port);
    // Shutdown is owned by the close() installed in createServer, which awaits
    // the plugin runtime and reports failures rather than swallowing them.
    await pluginManager?.startRuntime();
    noticeSchemaChangesInBackground((server as any).__farmResolvedConfig);
  } catch (error) {
    // Creation failures are reported by createServer above. Failures in listen
    // or runtime.start need their own notification while plugin state is alive.
    try {
      await pluginManager?.runHookParallel("onError", { phase: "startDevServer", error });
    } catch (reportError) {
      console.error(
        "Failed to run plugin error hooks after a dev server start failure:",
        reportError,
      );
    }
    // createServer already opened watchers, instrumentation, and plugin
    // resources. A failure here — an occupied port is the common one — would
    // otherwise leave all of them running with no handle to close them, since
    // the caller never receives the server.
    try {
      await server.close();
    } catch (closeError) {
      logger.error(`Failed to clean up after a failed dev server start: ${closeError}`);
    }
    throw error;
  }

  // Branding is handled by farmBrandingPlugin in vite.ts
  return server;
}
