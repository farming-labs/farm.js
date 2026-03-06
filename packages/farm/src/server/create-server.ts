import { createServer as createViteServer, type ViteDevServer } from "vite";
import type { FarmConfig } from "../types";
import { farmPlugin } from "../vite";
import { logger } from "../utils";
import { loadConfig, resolveConfig } from "../config";
import { PluginManager } from "../plugin";
import {
  createRedirectsPlugin,
  createHeadersPlugin,
  createRewritesPlugin,
  createEnvPlugin,
  createCompressionPlugin,
  createLoggerPlugin,
} from "../plugins";

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

          const pc = require("picocolors");
          console.log("");
          console.log(
            `  ${pc.bold(pc.green("Farm.js"))} ${pc.dim("v1.0.0")} ${pc.dim(`ready in ${elapsed}ms`)}`,
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

/**
 * Create a Vite development server with Farm.js integration
 */
export async function createServer(config: FarmConfig = {}) {
  let pluginManager: PluginManager | null = null;
  try {
    const root = config.root || process.cwd();

    // Load farm.config.ts if it exists
    const userConfig = await loadConfig(root);
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";

    const resolvedConfig = userConfig ? await resolveConfig(userConfig, mode) : null;

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
        pluginManager.addPlugin(createRedirectsPlugin(redirects));
      }

      if (headers.length > 0) {
        pluginManager.addPlugin(createHeadersPlugin(headers));
      }

      if (rewrites.length > 0) {
        pluginManager.addPlugin(createRewritesPlugin(rewrites));
      }

      if (resolvedConfig.env) {
        pluginManager.addPlugin(createEnvPlugin(resolvedConfig.env));
      }

      if (resolvedConfig.compress) {
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

    const server = await createViteServer({
      root: finalConfig.root || process.cwd(),
      plugins: [farmPlugin(finalConfig, pluginManager), createBrandingPlugin()],
      server: {
        middlewareMode: false,
      },
      optimizeDeps: {
        // Avoid Vite scanning server/native-only deps from framework internals.
        noDiscovery: true,
        include: ["react", "react-dom"],
        exclude: [
          "@farmjs/core/server",
          "@farmjs/core/api",
          "@farmjs/core/middleware",
          "@farmjs/core/config",
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
      ...resolvedConfig?.vite,
    });

    (server as any).__farmPluginManager = pluginManager;

    // Update plugin manager with vite server
    pluginManager.updateContext({ viteServer: server });
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
    logger.error(`Failed to create server: ${error}`);
    throw error;
  }
}

/**
 * Start the development server
 */
export async function startDevServer(config: FarmConfig = {}, port = 3000) {
  const server = await createServer(config);
  await server.listen(port);
  const pluginManager = (server as any).__farmPluginManager as PluginManager | undefined;
  if (pluginManager) {
    await pluginManager.runHookParallel("ready");
    server.httpServer?.once("close", () => {
      pluginManager
        .runHookParallel("shutdown", { reason: "dev-server-closed" })
        .catch(() => {});
    });
  }
  // Branding is handled by farmBrandingPlugin in vite.ts
  return server;
}
