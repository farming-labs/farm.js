/**
 * Middleware Manager
 *
 * Discovers and executes middleware files in the file system
 */

import * as fs from "fs";
import * as path from "path";
import type { ViteDevServer } from "vite";
import { toFileModuleUrl } from "../utils/file-module";
import type { IncomingMessage, ServerResponse } from "http";
import type {
  FarmMiddlewareConfig,
  MiddlewareFunction,
  MiddlewareConfig,
  MiddlewareContext,
  MiddlewareResult,
} from "./types";
import { createContext } from "./context";
import { normalizeMiddlewareModule } from "./module";
import { logger } from "../utils";
import { sendWebResponse } from "../server/response";
import { emitFarmEvent } from "../observability";
import {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
} from "../navigation-errors";
import { stripFarmLocaleFromPathname } from "../i18n/routing";
import { stripFarmBasePath } from "../base-path";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { createCliColors } from "../cli-colors";
import { appendMiddlewareRoutePath } from "./path";
import type { FarmServerConfig, ResolvedFarmServerConfig } from "../server-http";
import { resolveFarmRequestURL } from "../server/request";
import {
  compileMiddlewareConfig,
  matchesMiddlewareConfig,
  compileMiddlewareRoute,
  matchesMiddlewareRoute,
} from "./matcher";

export interface DiscoveredMiddleware {
  path: string;
  filePath: string;
  handlers: MiddlewareFunction[];
  config?: MiddlewareConfig;
  source?: "config" | "file";
}

function isMiddlewareResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/**
 * Middleware Manager - discovers and executes middleware
 */
export class MiddlewareManager {
  private middleware: DiscoveredMiddleware[] = [];
  private configMiddleware: DiscoveredMiddleware[] = [];
  private globalConfig?: MiddlewareConfig;
  private viteServer?: ViteDevServer;
  private appDirs: string[];
  private i18n?: ResolvedFarmI18nConfig;
  private server?: FarmServerConfig | ResolvedFarmServerConfig;

  constructor(
    appDir: string | readonly string[],
    viteServer?: ViteDevServer,
    config?: FarmMiddlewareConfig,
    i18n?: ResolvedFarmI18nConfig,
    server?: FarmServerConfig | ResolvedFarmServerConfig,
  ) {
    this.appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
    this.viteServer = viteServer;
    this.i18n = i18n;
    this.server = server;
    this.configure(config);
  }

  configure(config?: FarmMiddlewareConfig): void {
    this.configMiddleware = [];
    this.globalConfig = undefined;

    if (!config) return;

    const entries = Array.isArray(config) ? config : [config];

    for (const [index, entry] of entries.entries()) {
      const handlers = this.getConfigHandlers(entry);
      const middlewareConfig = this.toMiddlewareConfig(entry);
      compileMiddlewareConfig(middlewareConfig);

      if (handlers.length === 0) {
        this.globalConfig = middlewareConfig;
        continue;
      }

      this.configMiddleware.push({
        path: "/",
        filePath: `farm.config.ts#middleware-${index}`,
        handlers,
        config: middlewareConfig,
        source: "config",
      });
    }
  }

  /**
   * Discover all middleware.ts files
   */
  async discover(): Promise<void> {
    const middlewareByPath = new Map<string, DiscoveredMiddleware>();
    for (const appDir of this.appDirs) {
      const discovered: DiscoveredMiddleware[] = [];
      await this.discoverInDirectory(appDir, "/", discovered);
      for (const middleware of discovered) {
        compileMiddlewareRoute(middleware);
        middlewareByPath.set(middleware.path, middleware);
      }
    }
    this.middleware = Array.from(middlewareByPath.values());

    // Sort by path depth (root first, then nested)
    this.middleware.sort((a, b) => {
      const depthA = a.path.split("/").filter(Boolean).length;
      const depthB = b.path.split("/").filter(Boolean).length;
      return depthA - depthB;
    });

    if (process.env.FARM_VERBOSE && this.middleware.length > 0) {
      logger.success(`Discovered ${this.middleware.length} middleware files`);
      for (const mw of this.middleware) {
        logger.info(`  ${mw.path} (${mw.handlers.length} handlers)`);
      }
    }
  }

  /**
   * Recursively discover middleware files
   */
  private async discoverInDirectory(
    dir: string,
    routePath: string,
    discovered: DiscoveredMiddleware[],
  ): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    // Check for middleware.ts in current directory
    const middlewareFile = this.findMiddlewareFile(dir);
    if (middlewareFile) {
      const middleware = await this.loadMiddleware(middlewareFile, routePath);
      if (middleware) {
        discovered.push(middleware);
      }
    }

    // Recursively check subdirectories
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")) {
        const subPath = path.join(dir, entry.name);
        const subRoutePath = appendMiddlewareRoutePath(routePath, entry.name);
        await this.discoverInDirectory(subPath, subRoutePath, discovered);
      }
    }
  }

  /**
   * Find middleware file in directory
   */
  private findMiddlewareFile(dir: string): string | null {
    const extensions = [".ts", ".tsx", ".js", ".jsx"];
    for (const ext of extensions) {
      const filePath = path.join(dir, `middleware${ext}`);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    return null;
  }

  /**
   * Load a middleware file
   */
  private async loadMiddleware(filePath: string, routePath: string): Promise<DiscoveredMiddleware> {
    try {
      // Load the module
      let module: any;
      if (this.viteServer) {
        module = await this.viteServer.ssrLoadModule(filePath);
      } else {
        module = await import(/* @vite-ignore */ toFileModuleUrl(filePath));
      }

      const normalized = normalizeMiddlewareModule(module, routePath);
      if (!normalized) {
        throw new Error("must export a default handler or a named middleware handler");
      }
      if (normalized.config) {
        compileMiddlewareConfig(normalized.config);
      }

      return {
        path: routePath,
        filePath,
        handlers: normalized.handlers,
        config: normalized.config,
        source: "file",
      };
    } catch (error) {
      throw new Error(`Failed to load middleware ${filePath}: ${error}`);
    }
  }

  /**
   * Execute middleware for a request
   */
  async execute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = resolveFarmRequestURL(req, { trustProxy: this.server?.trustProxy });
    const pathname = url.pathname;
    // Match the app path page routing sees: without basePath (the locale step
    // strips it too), as the production runner does.
    const routePathname = this.i18n?.enabled
      ? stripFarmLocaleFromPathname(pathname, this.i18n)
      : stripFarmBasePath(pathname, this.i18n?.basePath ?? "/");
    const method = req.method || "GET";
    const startTime = Date.now();

    let parentData: MiddlewareContext["parent"] | undefined;
    let ctx = createContext(req, res, this.viteServer, undefined, this.server);

    if (this.globalConfig) {
      const globalMatch = this.matchesConfig(routePathname, this.globalConfig, ctx);
      if (!globalMatch.matched) {
        return false;
      }
      if (globalMatch.params) {
        ctx.params = { ...ctx.params, ...globalMatch.params };
      }
    }

    // Find applicable middleware (config entries first, then cascading files)
    const applicable: Array<{
      mw: DiscoveredMiddleware;
      routeMatch: { matched: boolean; params?: Record<string, string> };
    }> = [
      ...this.configMiddleware.map((mw) => ({ mw, routeMatch: { matched: true } })),
      ...this.middleware
        .map((mw) => ({ mw, routeMatch: matchesMiddlewareRoute(routePathname, mw) }))
        .filter((entry) => entry.routeMatch.matched),
    ];

    if (applicable.length === 0) {
      return false; // No middleware to run
    }
    const pc = createCliColors();
    const log = [
      pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
      pc.dim("[") + pc.bold(pc.magenta("MIDDLEWARE")) + pc.dim("]"),
      pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
      pc.gray("Executing middleware: "),
      pc.gray(pathname),
      pc.dim(` (${(Date.now() - startTime).toFixed(2)}ms)`),
    ].join(" ");
    console.log(log);

    // Execute middleware in cascade order
    for (const entry of applicable) {
      // Check matcher configuration
      const { mw, routeMatch } = entry;
      const configMatch = mw.config
        ? this.matchesConfig(routePathname, mw.config, ctx)
        : { matched: true };
      if (!configMatch.matched) {
        continue;
      }
      if (routeMatch.params) {
        ctx.params = { ...ctx.params, ...routeMatch.params };
      }
      if (configMatch.params) {
        ctx.params = { ...ctx.params, ...configMatch.params };
      }

      // Create new context with parent data
      if (parentData) {
        ctx = createContext(req, res, this.viteServer, parentData, this.server);
        if (routeMatch.params) {
          ctx.params = { ...ctx.params, ...routeMatch.params };
        }
        if (configMatch.params) {
          ctx.params = { ...ctx.params, ...configMatch.params };
        }
      }

      const middlewareStartTime = Date.now();
      const middlewareEvent = {
        route: mw.path,
        pathname,
        name: mw.filePath,
      };
      emitFarmEvent({ type: "middleware.start", ...middlewareEvent });

      try {
        // Execute all handlers in this middleware
        let handlerIndex = 0;
        let returnedResponse: Response | undefined;
        const executeNext = async (): Promise<MiddlewareResult> => {
          if (handlerIndex < mw.handlers.length) {
            const handler = mw.handlers[handlerIndex++];
            const result = await handler(ctx, executeNext);
            if (isMiddlewareResponse(result)) {
              returnedResponse = result;
              return result;
            }
          }
          return returnedResponse;
        };

        const result = await executeNext();
        const response = isMiddlewareResponse(result) ? result : returnedResponse;
        if (response) {
          if (!res.headersSent && !res.writableEnded) {
            for (const [key, value] of ctx.headers) {
              try {
                res.setHeader(key, value);
              } catch (error) {}
            }
          }
          emitFarmEvent({
            type: "middleware.shortCircuit",
            ...middlewareEvent,
            status: response.status,
          });
          await sendWebResponse(res, response);
          return true;
        }

        // Check if response has been sent or handled by middleware helpers.
        if (ctx._handled || res.headersSent || res.writableEnded) {
          emitFarmEvent({
            type: "middleware.shortCircuit",
            ...middlewareEvent,
            status: res.statusCode,
          });
          return true;
        }

        emitFarmEvent({
          type: "middleware.complete",
          ...middlewareEvent,
          durationMs: Date.now() - middlewareStartTime,
        });
      } catch (error) {
        // redirect() and notFound() are control flow: the caller answers them.
        emitFarmEvent(
          isFarmRedirectError(error) || isFarmNotFoundError(error)
            ? {
                type: "middleware.shortCircuit",
                ...middlewareEvent,
                status: isFarmRedirectError(error) ? getFarmRedirectError(error)!.status : 404,
              }
            : { type: "middleware.error", ...middlewareEvent, error },
        );
        throw error;
      }

      parentData = {
        data: new Map(ctx.data),
        locals: new Map(ctx.locals),
        headers: Object.fromEntries(ctx.headers),
      };
    }

    if (!res.headersSent && !res.writableEnded) {
      for (const [key, value] of ctx.headers) {
        try {
          res.setHeader(key, value);
        } catch (error) {}
      }
    }

    (req as any).__FARM_MIDDLEWARE_DATA__ = new Map(ctx.data);
    (req as any).__FARM_MIDDLEWARE_CONTEXT__ = new Map(ctx.locals);

    return false; // Continue to page rendering
  }

  /**
   * Check if pathname matches middleware config
   */
  private matchesConfig(
    pathname: string,
    config: MiddlewareConfig,
    ctx: MiddlewareContext,
  ): { matched: boolean; params?: Record<string, string> } {
    return matchesMiddlewareConfig(pathname, config, ctx);
  }

  /**
   * Reload middleware (for HMR)
   */
  async reload(): Promise<void> {
    await this.discover();
  }

  getMiddlewares(): DiscoveredMiddleware[] {
    return [...this.configMiddleware, ...this.middleware];
  }

  hasMiddleware(): boolean {
    return this.configMiddleware.length > 0 || this.middleware.length > 0;
  }

  private getConfigHandlers(
    entry:
      | MiddlewareConfig
      | (MiddlewareConfig & {
          handler?: MiddlewareFunction;
          handlers?: MiddlewareFunction[];
        }),
  ): MiddlewareFunction[] {
    const handlers: MiddlewareFunction[] = [];
    if ("handler" in entry && typeof entry.handler === "function") {
      handlers.push(entry.handler);
    }
    if ("handlers" in entry && Array.isArray(entry.handlers)) {
      handlers.push(...entry.handlers.filter((handler) => typeof handler === "function"));
    }
    return handlers;
  }

  private toMiddlewareConfig(
    entry: MiddlewareConfig & {
      handler?: MiddlewareFunction;
      handlers?: MiddlewareFunction[];
    },
  ): MiddlewareConfig {
    const { matcher, exclude, runtime } = entry;
    return { matcher, exclude, runtime };
  }
}
