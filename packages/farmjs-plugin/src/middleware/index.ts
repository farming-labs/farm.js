/**
 * Farm.js Middleware Plugin
 *
 * Standalone middleware support that works with or without RSC.
 * Discovers and executes middleware.ts files in the source directory.
 *
 * @example
 * ```ts
 * import { farmMiddleware } from '@farmjs/plugin/middleware'
 *
 * export default defineConfig({
 *   plugins: [farmMiddleware({ srcDir: 'src' })],
 * })
 * ```
 */

import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequire } from "node:module";

// Create require for ESM compatibility
const require_ = createRequire(import.meta.url);

// Get picocolors with forced color support (to handle NO_COLOR env being set)
const getColors = () => {
  try {
    const pico = require_("picocolors");
    if (typeof pico?.createColors === "function") {
      return pico.createColors(true);
    }
    if (typeof pico?.green === "function") return pico;
  } catch {}
  const id = (s: string) => s;
  return {
    bold: id,
    dim: id,
    cyan: id,
    red: id,
    yellow: id,
    blue: id,
    white: id,
    gray: id,
    green: id,
    magenta: id,
  };
};

export interface FarmMiddlewareOptions {
  /** Source directory containing middleware files (default: 'src') */
  srcDir?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Cookie options
 */
export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
}

/**
 * Cookie management interface
 */
export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string): void;
  getAll(): Record<string, string>;
}

/**
 * Full middleware context - compatible with @farmjs/core/middleware
 */
export interface MiddlewareContext {
  // Core request/response
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  pathname: string;
  searchParams: URLSearchParams;
  method: string;

  // Route information
  params: Record<string, string>;
  route: string;

  // Parent middleware data (for cascading)
  parent?: {
    data: Map<string, any>;
    headers: Record<string, string>;
  };

  // Vite integration
  vite: {
    isDev: boolean;
    hmr: boolean;
    server?: ViteDevServer;
  };

  // Data storage between middleware and pages
  data: Map<string, any>;

  // Helpers
  headers: Map<string, string>;
  cookies: CookieJar;

  // Response state
  _handled: boolean;
  _redirectUrl?: string;
  _rewriteUrl?: string;

  // Actions
  redirect(url: string, status?: number): void;
  rewrite(url: string): void;
  json(data: any, status?: number): void;
  text(content: string, status?: number): void;
  html(content: string, status?: number): void;
}

export type MiddlewareHandler = (
  ctx: MiddlewareContext,
  next: () => Promise<void>,
) => Promise<void> | void;

export interface DiscoveredMiddleware {
  path: string;
  filePath: string;
  module:
    | MiddlewareHandler
    | { build: () => { handlers: MiddlewareHandler[] }; setBasePath?: (path: string) => void };
  config?: { matcher?: string[] };
}

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce(
    (cookies, cookie) => {
      const [name, ...rest] = cookie.split("=");
      const value = rest.join("=").trim();
      if (name && value) {
        cookies[name.trim()] = decodeURIComponent(value);
      }
      return cookies;
    },
    {} as Record<string, string>,
  );
}

/**
 * Serialize a cookie
 */
function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.maxAge) {
    cookie += `; Max-Age=${options.maxAge}`;
  }

  if (options.expires) {
    cookie += `; Expires=${options.expires.toUTCString()}`;
  }

  if (options.path) {
    cookie += `; Path=${options.path}`;
  } else {
    cookie += "; Path=/";
  }

  if (options.domain) {
    cookie += `; Domain=${options.domain}`;
  }

  if (options.secure) {
    cookie += "; Secure";
  }

  if (options.httpOnly) {
    cookie += "; HttpOnly";
  }

  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
  }

  return cookie;
}

/**
 * Create a cookie jar for managing cookies
 */
function createCookieJar(req: IncomingMessage, res: ServerResponse): CookieJar {
  const cookies = parseCookies(req.headers.cookie);
  const setCookies: string[] = [];

  return {
    get(name: string): string | undefined {
      return cookies[name];
    },

    set(name: string, value: string, options: CookieOptions = {}): void {
      cookies[name] = value;
      const cookieString = serializeCookie(name, value, options);
      setCookies.push(cookieString);
      res.setHeader("Set-Cookie", setCookies);
    },

    delete(name: string): void {
      delete cookies[name];
      const cookieString = serializeCookie(name, "", {
        maxAge: 0,
        expires: new Date(0),
      });
      setCookies.push(cookieString);
      res.setHeader("Set-Cookie", setCookies);
    },

    getAll(): Record<string, string> {
      return { ...cookies };
    },
  };
}

/**
 * Create a full middleware context
 */
function createContext(
  req: IncomingMessage,
  res: ServerResponse,
  viteServer?: ViteDevServer,
): MiddlewareContext {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const headers = new Map<string, string>();
  const data = new Map<string, any>();
  const cookies = createCookieJar(req, res);

  let handled = false;

  const ctx: MiddlewareContext = {
    request: req,
    response: res,
    url,
    pathname: url.pathname,
    searchParams: url.searchParams,
    method: req.method || "GET",
    params: {},
    route: url.pathname,
    vite: {
      isDev: process.env.NODE_ENV !== "production",
      hmr: !!viteServer?.hot,
      server: viteServer,
    },
    data,
    headers,
    cookies,
    _handled: false,

    redirect(redirectUrl: string, status = 307): void {
      if (handled) {
        console.warn("Response already sent, cannot redirect");
        return;
      }

      ctx._redirectUrl = redirectUrl;
      ctx._handled = true;
      handled = true;

      res.writeHead(status, {
        Location: redirectUrl,
        "Content-Type": "text/plain",
      });
      res.end(`Redirecting to ${redirectUrl}`);
    },

    rewrite(rewriteUrl: string): void {
      ctx._rewriteUrl = rewriteUrl;
      // Update the URL for downstream middleware
      const newUrl = new URL(rewriteUrl, `http://${req.headers.host || "localhost"}`);
      ctx.url = newUrl;
      ctx.pathname = newUrl.pathname;
      ctx.searchParams = newUrl.searchParams;
      // Update the original request URL
      req.url = rewriteUrl;
    },

    json(jsonData: any, status = 200): void {
      if (handled) {
        console.warn("Response already sent, cannot send JSON");
        return;
      }

      ctx._handled = true;
      handled = true;

      res.writeHead(status, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(jsonData));
    },

    text(content: string, status = 200): void {
      if (handled) {
        console.warn("Response already sent, cannot send text");
        return;
      }

      ctx._handled = true;
      handled = true;

      res.writeHead(status, {
        "Content-Type": "text/plain",
      });
      res.end(content);
    },

    html(content: string, status = 200): void {
      if (handled) {
        console.warn("Response already sent, cannot send HTML");
        return;
      }

      ctx._handled = true;
      handled = true;

      res.writeHead(status, {
        "Content-Type": "text/html",
      });
      res.end(content);
    },
  };

  return ctx;
}

/**
 * Farm.js Middleware Plugin
 */
export default function farmMiddleware(options: FarmMiddlewareOptions = {}): Plugin {
  const srcDir = options.srcDir ?? "src";
  const debug = options.debug ?? false;

  // Middleware cache
  let middlewareCache: Map<string, DiscoveredMiddleware> = new Map();
  let discoveryComplete = false;
  let discoveryPromise: Promise<void> | null = null;

  const log = (message: string) => {
    if (!debug) return;
    try {
      const pc = require("picocolors");
      console.log(pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]") + " " + pc.gray(message));
    } catch {
      console.log(`[FARM] ${message}`);
    }
  };

  return {
    name: "@farmjs/plugin/middleware",
    enforce: "pre",

    configureServer(server: ViteDevServer) {
      // Discover middleware
      const discoverMiddleware = async (dir: string, routePath: string = "/"): Promise<void> => {
        const fs = await import("fs");
        const path = await import("path");

        if (!fs.existsSync(dir)) return;

        // Check for middleware file
        const extensions = [".ts", ".tsx", ".js", ".jsx"];
        for (const ext of extensions) {
          const middlewareFile = path.join(dir, `middleware${ext}`);
          if (fs.existsSync(middlewareFile)) {
            try {
              const module = await server.ssrLoadModule(middlewareFile);
              if (module.default) {
                middlewareCache.set(routePath, {
                  path: routePath,
                  filePath: middlewareFile,
                  module: module.default,
                  config: module.config,
                });
                log(`Middleware discovered: ${routePath}`);
              }
            } catch (e: any) {
              log(`Middleware load failed at ${routePath}: ${e.message}`);
            }
            break;
          }
        }

        // Recursively check subdirectories
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !entry.name.startsWith("_") &&
            entry.name !== "api"
          ) {
            const subDir = path.join(dir, entry.name);
            const subRoutePath =
              routePath === "/" ? `/${entry.name}` : `${routePath}/${entry.name}`;
            await discoverMiddleware(subDir, subRoutePath);
          }
        }
      };

      // Initialize discovery
      const initializeDiscovery = async () => {
        const path = await import("path");
        const appDir = path.join(server.config.root, srcDir);
        await discoverMiddleware(appDir);
        discoveryComplete = true;
      };

      discoveryPromise = initializeDiscovery().catch((e) => {
        console.error("[FARM] Middleware discovery error:", e);
      });

      // Execute middleware chain
      const executeMiddleware = async (
        req: IncomingMessage,
        res: ServerResponse,
        pathname: string,
        sharedData?: Map<string, any>,
      ): Promise<boolean> => {
        // Wait for discovery
        if (discoveryPromise && !discoveryComplete) {
          await discoveryPromise;
        }

        // Find applicable middleware (cascading from root to specific)
        const applicable = Array.from(middlewareCache.values())
          .filter((mw) => {
            if (mw.path === "/") return true;
            return pathname.startsWith(mw.path) || pathname === mw.path;
          })
          .sort((a, b) => a.path.split("/").length - b.path.split("/").length);

        if (applicable.length === 0) return false;

        const startTime = Date.now();
        const method = req.method || "GET";

        // Log middleware execution in the same format as @farmjs/core
        const pc = getColors();
        const logMsg = [
          pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
          pc.dim("[") + pc.bold(pc.magenta("MIDDLEWARE")) + pc.dim("]"),
          pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
          pc.gray("Executing middleware: "),
          pc.gray(pathname),
          pc.dim(` (${applicable.length} middleware)`),
        ].join(" ");
        console.log(logMsg);

        // Create full middleware context
        const ctx = createContext(req, res, server);

        // Use shared data if provided
        if (sharedData) {
          for (const [key, value] of sharedData) {
            ctx.data.set(key, value);
          }
        }

        for (const mw of applicable) {
          const middleware = mw.module;

          // Handle middleware chain object (has .build method)
          if (middleware && typeof middleware === "object" && "build" in middleware) {
            if (typeof (middleware as any).setBasePath === "function") {
              (middleware as any).setBasePath(mw.path);
            }
            const built = (middleware as any).build();
            const handlers = built.handlers || [];

            let handlerIndex = 0;
            const executeNext = async (): Promise<void> => {
              if (handlerIndex < handlers.length) {
                const handler = handlers[handlerIndex++];
                await handler(ctx, executeNext);
              }
            };

            await executeNext();
          } else if (typeof middleware === "function") {
            // Plain middleware function
            await middleware(ctx, async () => {});
          }

          // Check if response was sent
          if (ctx._handled || res.headersSent || res.writableEnded) {
            return true;
          }
        }

        // Apply collected headers to response
        for (const [key, value] of ctx.headers) {
          try {
            res.setHeader(key, value);
          } catch (e) {}
        }

        // Store middleware data on request for pages to access
        (req as any).__FARM_MIDDLEWARE_DATA__ = Object.fromEntries(ctx.data);

        // Log middleware completion
        const duration = Date.now() - startTime;
        const pc2 = getColors();
        const completeLogMsg = [
          pc2.dim("[") + pc2.bold(pc2.blue("FARM")) + pc2.dim("]"),
          pc2.dim("[") + pc2.bold(pc2.magenta("MIDDLEWARE")) + pc2.dim("]"),
          pc2.dim("[") + pc2.bold(pc2.white(method.padEnd(3))) + pc2.dim("]"),
          pc2.gray("Completed"),
          pc2.gray(pathname),
          pc2.dim(`(${duration}ms)`),
        ].join(" ");
        console.log(completeLogMsg);

        return false;
      };

      // Expose middleware execution for other plugins
      (server as any).__farmMiddleware__ = {
        execute: executeMiddleware,
        getCache: () => middlewareCache,
        isReady: () => discoveryComplete,
        waitForDiscovery: () => discoveryPromise,
      };

      // Add middleware to handle requests
      return () => {
        server.middlewares.use(async (req, res, next) => {
          const url = req.url || "/";
          const pathname = url.split("?")[0];

          // Skip Vite internal requests
          if (
            pathname.startsWith("/@") ||
            pathname.startsWith("/__") ||
            pathname.startsWith("/node_modules") ||
            (pathname.includes(".") && !pathname.endsWith("/"))
          ) {
            return next();
          }

          try {
            // Execute middleware
            const middlewareData = new Map<string, any>();
            const handled = await executeMiddleware(
              req as IncomingMessage,
              res as ServerResponse,
              pathname,
              middlewareData,
            );
            if (handled) {
              return;
            }
          } catch (e) {
            console.error("[FARM] Middleware error:", e);
          }

          next();
        });
      };
    },

    async handleHotUpdate({ file, server, modules }) {
      const fileName = file.split("/").pop() || "";
      if (fileName.startsWith("middleware.")) {
        log(`Middleware updated: ${fileName}`);

        // Invalidate the module in Vite's module graph
        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        // Find and update the cached middleware
        for (const [routePath, mw] of middlewareCache.entries()) {
          if (mw.filePath === file) {
            try {
              // Reload the module
              const module = await server.ssrLoadModule(file);
              if (module.default) {
                middlewareCache.set(routePath, {
                  path: routePath,
                  filePath: file,
                  module: module.default,
                  config: module.config,
                });
                log(`Middleware reloaded: ${routePath}`);
              }
            } catch (e: any) {
              log(`Middleware reload failed: ${e.message}`);
            }
            break;
          }
        }

        // Also check if this is a new middleware file not yet in cache
        if (!Array.from(middlewareCache.values()).some((mw) => mw.filePath === file)) {
          try {
            const path = await import("path");
            const srcPath = path.join(server.config.root, srcDir);
            const relativePath = file
              .replace(srcPath, "")
              .replace(/\/middleware\.(ts|tsx|js|jsx)$/, "");
            const routePath = relativePath === "" ? "/" : relativePath;

            const module = await server.ssrLoadModule(file);
            if (module.default) {
              middlewareCache.set(routePath, {
                path: routePath,
                filePath: file,
                module: module.default,
                config: module.config,
              });
              log(`New middleware discovered: ${routePath}`);
            }
          } catch (e: any) {
            log(`New middleware load failed: ${e.message}`);
          }
        }

        server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
    },
  };
}

export { farmMiddleware };
