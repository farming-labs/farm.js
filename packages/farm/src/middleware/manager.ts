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
  FarmMiddlewareConfig,
  MiddlewareFunction,
  MiddlewareMatcher,
  MiddlewareModule,
  MiddlewareConfig,
  MiddlewareContext,
  MiddlewareResult,
} from "./types";
import { createContext } from "./context";
import { logger } from "../utils";
import { sendWebResponse } from "../server/response";
import { emitFarmEvent } from "../observability";

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

  constructor(
    appDir: string | readonly string[],
    viteServer?: ViteDevServer,
    config?: FarmMiddlewareConfig,
  ) {
    this.appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
    this.viteServer = viteServer;
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
        middlewareByPath.set(middleware.path, middleware);
      }
    }
    this.middleware = Array.from(middlewareByPath.values());

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
        const subRoutePath = path.posix.join(routePath, entry.name);
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
        // Set the base path for route-scoped middleware (when/rewrite auto-scoping)
        if (typeof (defaultExport as any).setBasePath === "function") {
          (defaultExport as any).setBasePath(routePath);
        }
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
        source: "file",
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
    const method = req.method || "GET";
    const startTime = Date.now();

    let parentData: MiddlewareContext["parent"] | undefined;
    let ctx = createContext(req, res, this.viteServer);

    if (this.globalConfig) {
      const globalMatch = this.matchesConfig(pathname, this.globalConfig, ctx);
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
        .map((mw) => ({ mw, routeMatch: this.matchRoutePath(pathname, mw.path) }))
        .filter((entry) => entry.routeMatch.matched),
    ];

    if (applicable.length === 0) {
      return false; // No middleware to run
    }
    try {
      const pc = require("picocolors");
      const middlewarePaths = applicable.map(({ mw }) => mw.path).join(", ");
      const log = [
        pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
        pc.dim("[") + pc.bold(pc.magenta("MIDDLEWARE")) + pc.dim("]"),
        pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
        pc.gray("Executing middleware: "),
        pc.gray(pathname),
        pc.dim(` (${(Date.now() - startTime).toFixed(2)}ms)`),
      ].join(" ");
      console.log(log);
    } catch {
      console.log(
        `[FARM] [MIDDLEWARE] [${method}] Executing ${pathname} (${applicable.length} middleware)`,
      );
    }

    // Execute middleware in cascade order
    for (const entry of applicable) {
      // Check matcher configuration
      const { mw, routeMatch } = entry;
      const configMatch = mw.config
        ? this.matchesConfig(pathname, mw.config, ctx)
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
        ctx = createContext(req, res, this.viteServer, parentData);
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
        emitFarmEvent({
          type: "middleware.error",
          ...middlewareEvent,
          error,
        });
        throw error;
      }

      parentData = {
        data: new Map(ctx.data),
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
    // Check exclusions
    if (config.exclude) {
      for (const pattern of config.exclude) {
        if (this.matchPattern(pattern, pathname).matched) {
          return { matched: false };
        }
      }
    }

    // Check matchers
    if (config.matcher) {
      for (const matcher of this.toMatcherList(config.matcher)) {
        if (typeof matcher === "string" || matcher instanceof RegExp) {
          const result = this.matchPattern(matcher, pathname);
          if (result.matched) {
            return result;
          }
        } else if (typeof matcher === "function") {
          return { matched: matcher(ctx) };
        }
      }
      return { matched: false };
    }

    return { matched: true };
  }

  /**
   * Match a pattern against pathname
   */
  private matchPattern(
    pattern: string | RegExp,
    pathname: string,
  ): { matched: boolean; params?: Record<string, string> } {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      const match = pattern.exec(pathname);
      return {
        matched: !!match,
        params: match?.groups ? { ...match.groups } : undefined,
      };
    }

    if (pattern === "*" || pattern === "/(.*)") {
      return { matched: true };
    }

    if (pattern.endsWith("(.*)")) {
      const prefix = pattern.slice(0, -4);
      return { matched: pathname === prefix || pathname.startsWith(`${prefix}/`) };
    }

    const { regex, params } = this.compilePathPattern(pattern);
    const match = regex.exec(pathname);
    if (!match) {
      return { matched: false };
    }

    const values: Record<string, string> = {};
    params.forEach((param, index) => {
      values[param] = decodeURIComponent(match[index + 1] || "");
    });

    return {
      matched: true,
      params: Object.keys(values).length > 0 ? values : undefined,
    };
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

  private matchRoutePath(
    pathname: string,
    middlewarePath: string,
  ): { matched: boolean; params?: Record<string, string> } {
    if (middlewarePath === "/") return { matched: true };

    const exactMatch = this.matchPattern(middlewarePath, pathname);
    if (exactMatch.matched) {
      return exactMatch;
    }

    const nestedMatch = this.matchPattern(`${middlewarePath}/:__farmRest*`, pathname);
    if (!nestedMatch.matched) {
      return { matched: false };
    }

    const params = { ...(nestedMatch.params || {}) };
    delete params.__farmRest;
    return {
      matched: true,
      params: Object.keys(params).length > 0 ? params : undefined,
    };
  }

  private toMatcherList(matcher: MiddlewareConfig["matcher"]): MiddlewareMatcher[] {
    if (!matcher) return [];
    return Array.isArray(matcher) ? matcher : [matcher];
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

  private compilePathPattern(pattern: string): { regex: RegExp; params: string[] } {
    const params: string[] = [];
    const segments = pattern.split("/").filter(Boolean);

    if (segments.length === 0) {
      return { regex: /^\/$/, params };
    }

    const parts = segments.map((segment) => {
      if (segment === "**") {
        return "(?:/.*)?";
      }

      if (segment === "*") {
        return "/[^/]+";
      }

      if (segment.startsWith(":")) {
        const { name, modifier } = this.parseColonParam(segment);
        params.push(name);

        if (modifier === "*") {
          return "(?:/(.*))?";
        }
        if (modifier === "+") {
          return "/(.+)";
        }
        return "/([^/]+)";
      }

      if (segment.startsWith("[...") && segment.endsWith("]")) {
        params.push(segment.slice(4, -1));
        return "(?:/(.*))?";
      }

      if (segment.startsWith("[") && segment.endsWith("]")) {
        params.push(segment.slice(1, -1));
        return "/([^/]+)";
      }

      return `/${this.escapeRegex(segment).replace(/\\\*/g, "[^/]*")}`;
    });

    return {
      regex: new RegExp(`^${parts.join("")}$`),
      params,
    };
  }

  private parseColonParam(segment: string): { name: string; modifier?: string } {
    const raw = segment.slice(1);
    const last = raw[raw.length - 1];
    const modifier = last === "*" || last === "+" || last === "?" ? last : undefined;
    return {
      name: modifier ? raw.slice(0, -1) : raw,
      modifier,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
}
