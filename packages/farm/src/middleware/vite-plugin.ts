/**
 * Standalone Vite middleware support used by Farm's RSC and API plugins.
 */

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { MiddlewareManager } from "./manager";

export interface FarmMiddlewarePluginOptions {
  /** Source directory (default: `src`). */
  srcDir?: string;
  /** Enable debug logging. */
  debug?: boolean;
}

function getMiddlewareAppDirectory(root: string, srcDir: string): string {
  const sourceDirectory = path.join(root, srcDir);
  const appDirectory = path.join(sourceDirectory, "app");
  return fs.existsSync(appDirectory) ? appDirectory : sourceDirectory;
}

export function farmMiddlewarePlugin(options: FarmMiddlewarePluginOptions = {}): Plugin {
  const srcDir = options.srcDir ?? "src";
  let manager: MiddlewareManager | null = null;
  let discoveryComplete = false;
  let discoveryPromise: Promise<void> | null = null;

  const discover = async (server: ViteDevServer): Promise<void> => {
    manager = new MiddlewareManager(getMiddlewareAppDirectory(server.config.root, srcDir), server);
    await manager.discover();
    discoveryComplete = true;
  };

  return {
    name: "@farm.js/core:middleware",
    enforce: "pre",

    configureServer(server) {
      discoveryPromise = discover(server).catch((error) => {
        discoveryComplete = true;
        console.error("[FARM] Middleware discovery error:", error);
      });

      const execute = async (
        req: IncomingMessage,
        res: ServerResponse,
        _pathname?: string,
        sharedData?: Map<string, any>,
      ): Promise<boolean> => {
        if (discoveryPromise && !discoveryComplete) {
          await discoveryPromise;
        }

        if (!manager) {
          return false;
        }

        const handled = await manager.execute(req, res);
        const middlewareData = (req as any).__FARM_MIDDLEWARE_DATA__;
        if (sharedData && middlewareData instanceof Map) {
          for (const [key, value] of middlewareData) {
            sharedData.set(key, value);
          }
        }
        return handled;
      };

      (server as any).__farmMiddleware__ = {
        execute,
        getMiddlewares: () => manager?.getMiddlewares() ?? [],
        isReady: () => discoveryComplete,
        waitForDiscovery: () => discoveryPromise,
      };
    },

    async handleHotUpdate({ file, server, modules }) {
      if (!/^middleware\.[tj]sx?$/.test(path.basename(file))) {
        return;
      }

      for (const module of modules) {
        server.moduleGraph.invalidateModule(module);
      }

      await manager?.reload();
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    },
  };
}
