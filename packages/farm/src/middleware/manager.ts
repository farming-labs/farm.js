/**
 * Middleware Manager
 *
 * Discovers and executes middleware files in the file system
 */

import * as fs from "fs";
import * as path from "path";
import type { ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import type {
  MiddlewareFunction,
  MiddlewareModule,
  MiddlewareConfig,
  MiddlewareContext,
} from "./types";
import { createContext } from "./context";
import { logger } from "../utils";

export interface DiscoveredMiddleware {
  path: string;
  filePath: string;
  handlers: MiddlewareFunction[];
  config?: MiddlewareConfig;
}

/**
 * Middleware Manager - discovers and executes middleware
 */
export class MiddlewareManager {
  private middleware: DiscoveredMiddleware[] = [];
  private viteServer?: ViteDevServer;

  constructor(
    private appDir: string,
    viteServer?: ViteDevServer,
  ) {
    this.viteServer = viteServer;
  }

  /**
   * Discover all middleware.ts files
   */
  async discover(): Promise<void> {
    this.middleware = [];
    await this.discoverInDirectory(this.appDir, "/");

    // Sort by path depth (root first, then nested)
    this.middleware.sort((a, b) => {
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
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
  private async discoverInDirectory(dir: string, routePath: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    // Check for middleware.ts in current directory
    const middlewareFile = this.findMiddlewareFile(dir);
    if (middlewareFile) {
      const middleware = await this.loadMiddleware(middlewareFile, routePath);
      if (middleware) {
        this.middleware.push(middleware);
      }
    }

    // Recursively check subdirectories
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")) {
        const subPath = path.join(dir, entry.name);
        const subRoutePath = path.posix.join(routePath, entry.name);
        await this.discoverInDirectory(subPath, subRoutePath);
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
  private async loadMiddleware(
    filePath: string,
    routePath: string,
  ): Promise<DiscoveredMiddleware | null> {
    try {
      // Load the module
      let module: any;
      if (this.viteServer) {
        module = await this.viteServer.ssrLoadModule(filePath);
      } else {
        const fileUrl = `file://${filePath}`;
        module = await import(/* @vite-ignore */ fileUrl);
      }

      const middlewareModule = module as MiddlewareModule;

      if (!middlewareModule.default) {
        logger.warn(`Middleware file ${filePath} does not have a default export`);
        return null;
      }

      const defaultExport = middlewareModule.default;
      let handlers: MiddlewareFunction[] = [];

      // Check if it has a build method (middleware chain object)
      if (defaultExport && typeof defaultExport === "object" && "build" in defaultExport) {
        const built = (defaultExport as any).build();
        handlers = built.handlers;
      } else if (typeof defaultExport === "function") {
        // Plain middleware function
        handlers = [defaultExport as MiddlewareFunction];
      }

      return {
        path: routePath,
        filePath,
        handlers,
        config: middlewareModule.config,
      };
    } catch (error) {
      logger.error(`Failed to load middleware ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * Execute middleware for a request
   */
  async execute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Find applicable middleware (cascading from root to specific)
    const applicable = this.middleware.filter((mw) => {
      // Root middleware (/) applies to everything
      if (mw.path === "/") return true;

      // Middleware applies to its path and all sub-paths
      return pathname.startsWith(mw.path) || pathname === mw.path;
    });

    if (applicable.length === 0) {
      return false; // No middleware to run
    }

    // Create root context
    let parentData: MiddlewareContext["parent"] | undefined;
    let ctx = createContext(req, res, this.viteServer);

    // Execute middleware in cascade order
    for (const mw of applicable) {
      // Check matcher configuration
      if (mw.config?.matcher && !this.matchesConfig(pathname, mw.config)) {
        continue;
      }

      // Create new context with parent data
      if (parentData) {
        ctx = createContext(req, res, this.viteServer, parentData);
      }

      // Execute all handlers in this middleware
      let handlerIndex = 0;
      const executeNext = async (): Promise<void> => {
        if (handlerIndex < mw.handlers.length) {
          const handler = mw.handlers[handlerIndex++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();

      // If response was handled, stop
      if (ctx._handled) {
        return true;
      }

      // Prepare parent data for next middleware level
      parentData = {
        data: new Map(ctx.data),
        headers: Object.fromEntries(ctx.headers),
      };
    }

    // Apply headers from middleware context to response
    for (const [key, value] of ctx.headers) {
      res.setHeader(key, value);
    }

    (req as any).__FARM_MIDDLEWARE_DATA__ = Object.fromEntries(ctx.data);

    return false; // Continue to page rendering
  }

  /**
   * Check if pathname matches middleware config
   */
  private matchesConfig(pathname: string, config: MiddlewareConfig): boolean {
    // Check exclusions
    if (config.exclude) {
      for (const pattern of config.exclude) {
        if (this.matchPattern(pattern, pathname)) {
          return false;
        }
      }
    }

    // Check matchers
    if (config.matcher) {
      for (const matcher of config.matcher) {
        if (typeof matcher === "string" || matcher instanceof RegExp) {
          if (this.matchPattern(matcher, pathname)) {
            return true;
          }
        } else if (typeof matcher === "function") {
          // For function matchers, we'd need the full context
          // For now, allow it through
          return true;
        }
      }
      return false;
    }

    return true;
  }

  /**
   * Match a pattern against pathname
   */
  private matchPattern(pattern: string | RegExp, pathname: string): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(pathname);
    }

    // Convert glob-style pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, "__DOUBLE_STAR__")
      .replace(/\*/g, "[^/]+")
      .replace(/__DOUBLE_STAR__/g, ".*")
      .replace(/\//g, "\\/");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(pathname);
  }

  /**
   * Reload middleware (for HMR)
   */
  async reload(): Promise<void> {
    await this.discover();
  }
}
