import { createServer as createViteServer, type ViteDevServer } from "vite";
import type { FarmConfig } from "../types";
import { farmI18nClientBridgePlugin, farmPlugin } from "../vite";
import { logger } from "../utils";
import { loadConfig, resolveConfig } from "../config";
import { PluginManager } from "../plugin";
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
import {
  createFarmClientOptimizeDepsConfig,
  createFarmClientOptimizeDepsEntries,
  mergeFarmViteConfig,
} from "./vite-config";
import { FARM_VERSION } from "../version";
import { getFarmAppDirectories } from "../layers";
import { createCliColors } from "../cli-colors";
import { createFarmThemeCssPlugin } from "../theme/vite";
import {
  createFarmInstrumentationLifecycle,
  loadFarmInstrumentation,
  resolveFarmInstrumentationFile,
  type FarmInstrumentationLifecycle,
} from "../instrumentation";
import { loadFarmRendererVitePlugins, resolveFarmRenderer } from "../renderer";

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
 * Create a Vite development server with Farm.js integration
 */
export async function createServer(config: FarmConfig = {}) {
  let pluginManager: PluginManager | null = null;
  let instrumentation: FarmInstrumentationLifecycle | null = null;
  try {
    const root = config.root || process.cwd();

    // Load farm.config.ts if it exists
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    const userConfig = await loadConfig(root, undefined, mode);

    const resolvedConfig = userConfig ? await resolveConfig(userConfig, mode) : null;
    const instrumentationConfig = resolvedConfig || config;
    const instrumentationRoot = instrumentationConfig.root || root;
    const instrumentationFile = resolveFarmInstrumentationFile(
      instrumentationRoot,
      instrumentationConfig.srcDir || "src",
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
      config: resolvedConfig || config,
      isDev: mode === "development",
      isProd: mode === "production",
    });

    // Add built-in plugins if config is available
    if (resolvedConfig) {
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

      if (resolvedConfig.plugins) {
        pluginManager.addPlugins(resolvedConfig.plugins);
      }
    }

    if (mode === "development") {
      const hasLogger = pluginManager.getPlugins().some((p) => p.name === "farm:logger");
      if (!hasLogger) {
        pluginManager.addPlugin(createLoggerPlugin());
      }
    }

    // Run config hooks
    await pluginManager.runHookParallel("init");

    let finalConfig = resolvedConfig || config;
    finalConfig = await pluginManager.runHookSerial("config", finalConfig);
    finalConfig.renderer = resolveFarmRenderer(finalConfig.renderer);
    const projectRoot = finalConfig.root || process.cwd();
    const rendererVitePlugins = await loadFarmRendererVitePlugins(
      finalConfig.renderer,
      projectRoot,
      { ssr: true },
    );

    let tailwindVitePlugin: any = undefined;
    const shouldUseProjectPostcss = hasProjectPostcssConfig(projectRoot);
    if (shouldUseProjectPostcss) {
      logger.info("📦 Using project PostCSS/Tailwind configuration");
    } else {
      try {
        const tailwindcss = (await import("@tailwindcss/vite")).default;
        tailwindVitePlugin = tailwindcss();
      } catch (error) {
        logger.warn(
          `Tailwind plugin auto-enable failed; continuing without it: ${(error as Error).message}`,
        );
      }
    }

    const server = await createViteServer(
      mergeFarmViteConfig(
        {
          root: projectRoot,
          css: shouldUseProjectPostcss ? undefined : { postcss: { plugins: [] } },
          plugins: [
            createFarmThemeCssPlugin(finalConfig.theme, finalConfig.basePath),
            ...(tailwindVitePlugin ? [tailwindVitePlugin] : []),
            ...(rendererVitePlugins as any[]),
            createDevDependencyStubsPlugin(),
            farmI18nClientBridgePlugin(),
            farmPlugin(finalConfig, pluginManager),
            farmEnvironmentFunctionsPlugin(),
            createBrandingPlugin(),
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
              "better-call",
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
        finalConfig.vite,
      ),
    );

    (server as any).__farmPluginManager = pluginManager;
    (server as any).__farmInstrumentation = instrumentation;
    const closeViteServer = server.close.bind(server);
    server.close = async () => {
      try {
        await closeViteServer();
      } finally {
        await instrumentation?.shutdown();
      }
    };
    server.httpServer?.once("close", () => {
      instrumentation?.shutdown().catch((error) => {
        logger.warn(`Instrumentation shutdown failed: ${error}`);
      });
    });

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
    if (pluginManager) {
      await pluginManager.runHookParallel("onError", {
        phase: "createServer",
        error,
      });
    }
    await instrumentation?.shutdown().catch(() => {});
    logger.error(`Failed to create server: ${error}`);
    throw error;
  }
}

/**
 * Start the development server
 */
export async function startDevServer(config: FarmConfig = {}, port?: number) {
  const server = await createServer(config);
  await server.listen(port);
  const pluginManager = (server as any).__farmPluginManager as PluginManager | undefined;
  if (pluginManager) {
    await pluginManager.startRuntime();
    server.httpServer?.once("close", () => {
      pluginManager.closeRuntime("dev-server-closed").catch(() => {});
    });
  }
  // Branding is handled by farmBrandingPlugin in vite.ts
  return server;
}
