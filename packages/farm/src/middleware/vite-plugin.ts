/**
 * Farm.js Middleware Vite Plugin
 *
 * Standalone middleware support that works with any Vite setup.
 * Discovers and executes middleware.ts files at various path levels.
 *
 * @example
 * ```ts
 * import { farmMiddlewarePlugin } from '@farmjs/core'
 *
 * export default defineConfig({
 *   plugins: [farmMiddlewarePlugin({ srcDir: 'src' })],
 * })
 * ```
 */

import type { Plugin, ViteDevServer } from "vite";

export interface FarmMiddlewarePluginOptions {
  /** Source directory (default: 'src') */
  srcDir?: string;
  /** Enable debug logging */
  debug?: boolean;
}

interface MiddlewareEntry {
  path: string;
  filePath: string;
  handler: any;
}

/**
 * Farm.js Middleware Vite Plugin
 */
export function farmMiddlewarePlugin(options: FarmMiddlewarePluginOptions = {}): Plugin {
  const srcDir = options.srcDir ?? "src";
  const debug = options.debug ?? false;

  // Middleware cache
  let middlewareCache: Map<string, MiddlewareEntry> = new Map();
  let discoveryComplete = false;
  let discoveryPromise: Promise<void> | null = null;

  const log = (_message: string) => {};

  return {
    name: "@farmjs/core:middleware",
    enforce: "pre",

    configureServer(server: ViteDevServer) {
      const discoverMiddleware = async (): Promise<void> => {
        const fs = await import("fs");
        const path = await import("path");

        const appDir = path.join(server.config.root, srcDir);
        if (!fs.existsSync(appDir)) {
          log("Source directory not found");
          return;
        }

        const findMiddlewareFiles = (dir: string, basePath: string = ""): string[] => {
          const files: string[] = [];
          if (!fs.existsSync(dir)) return files;

          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
              if (entry.name === "api") continue;

              const newBasePath = basePath ? `${basePath}/${entry.name}` : entry.name;
              files.push(...findMiddlewareFiles(fullPath, newBasePath));
            } else if (
              entry.name === "middleware.ts" ||
              entry.name === "middleware.tsx" ||
              entry.name === "middleware.js"
            ) {
              files.push(fullPath);
            }
          }
          return files;
        };

        const middlewareFiles = findMiddlewareFiles(appDir);
        middlewareCache.clear();

        for (const filePath of middlewareFiles) {
          try {
            const relativePath = path.relative(appDir, path.dirname(filePath));
            // Convert path: "app/counter" -> "/counter"
            const routePath = "/" + relativePath.replace(/^app\/?/, "").replace(/\\/g, "/");

            const middlewareModule = await server.ssrLoadModule(filePath);
            const handler = middlewareModule.middleware || middlewareModule.default;

            if (handler) {
              middlewareCache.set(routePath === "/" ? "/" : routePath, {
                path: routePath,
                filePath,
                handler,
              });
              log(`Middleware discovered: ${routePath}`);
            }
          } catch (e: any) {
            log(`Middleware load failed at ${filePath}: ${e.message}`);
          }
        }

        log(`Middleware discovery complete: ${middlewareCache.size} middlewares found`);
      };

      // Execute middleware chain for a given path
      const executeMiddleware = async (
        req: any,
        res: any,
        pathname: string,
        middlewareData: Map<string, any>,
      ): Promise<boolean> => {
        const middlewaresToRun: MiddlewareEntry[] = [];

        // Collect matching middleware (from root to specific path)
        const pathParts = pathname.split("/").filter(Boolean);
        let currentPath = "/";

        // Check root middleware
        const rootMiddleware = middlewareCache.get("/");
        if (rootMiddleware) {
          middlewaresToRun.push(rootMiddleware);
        }

        // Check path-specific middleware
        for (const part of pathParts) {
          currentPath = currentPath === "/" ? `/${part}` : `${currentPath}/${part}`;
          const pathMiddleware = middlewareCache.get(currentPath);
          if (pathMiddleware) {
            middlewaresToRun.push(pathMiddleware);
          }
        }

        if (middlewaresToRun.length === 0) {
          return false;
        }

        // Execute middleware chain
        for (const middleware of middlewaresToRun) {
          try {
            const result = await middleware.handler({
              request: {
                method: req.method,
                url: req.url,
                headers: req.headers,
              },
              params: {},
              pathname,
              data: middlewareData,
              cookies: parseCookies(req.headers.cookie),
            });

            // Handle middleware result
            if (result) {
              if (result.redirect) {
                res.statusCode = result.status || 302;
                res.setHeader("Location", result.redirect);
                res.end();
                return true;
              }

              if (result.data) {
                for (const [key, value] of Object.entries(result.data)) {
                  middlewareData.set(key, value);
                }
              }

              if (result.headers) {
                for (const [key, value] of Object.entries(result.headers)) {
                  res.setHeader(key, value as string);
                }
              }
            }
          } catch (e: any) {
            log(`Middleware error at ${middleware.path}: ${e.message}`);
          }
        }

        return false;
      };

      // Initialize discovery
      discoveryPromise = discoverMiddleware()
        .then(() => {
          discoveryComplete = true;
        })
        .catch((e) => {
          console.error("[FARM] Middleware discovery error:", e);
        });

      // Expose middleware API for other plugins
      (server as any).__farmMiddleware__ = {
        getMiddlewares: () => middlewareCache,
        execute: executeMiddleware,
        isReady: () => discoveryComplete,
        waitForDiscovery: () => discoveryPromise,
      };
    },

    async handleHotUpdate({ file, server, modules }) {
      const fileName = file.split("/").pop() || "";

      if (fileName.startsWith("middleware.")) {
        log(`Middleware file updated: ${file}`);

        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        let middlewarePathToUpdate: string | null = null;
        for (const [middlewarePath, middleware] of middlewareCache) {
          if (middleware.filePath === file) {
            middlewarePathToUpdate = middlewarePath;
            break;
          }
        }

        if (middlewarePathToUpdate) {
          try {
            const middlewareModule = await server.ssrLoadModule(file);
            const handler = middlewareModule.middleware || middlewareModule.default;

            if (handler) {
              middlewareCache.set(middlewarePathToUpdate, {
                path: middlewarePathToUpdate,
                filePath: file,
                handler,
              });
              log(`Middleware reloaded: ${middlewarePathToUpdate}`);
            }
          } catch (e: any) {
            log(`Middleware HMR failed: ${e.message}`);
          }
        } else {
          // New middleware file
          try {
            const path = await import("path");
            const appDir = path.join(server.config.root, srcDir);
            const relativePath = path.relative(appDir, path.dirname(file));
            const routePath = "/" + relativePath.replace(/^app\/?/, "").replace(/\\/g, "/");

            const middlewareModule = await server.ssrLoadModule(file);
            const handler = middlewareModule.middleware || middlewareModule.default;

            if (handler) {
              middlewareCache.set(routePath === "/" ? "/" : routePath, {
                path: routePath,
                filePath: file,
                handler,
              });
              log(`New middleware discovered: ${routePath}`);
            }
          } catch (e: any) {
            log(`New middleware load failed: ${e.message}`);
          }
        }

        return [];
      }
    },
  };
}

// Helper to parse cookies
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=");
    if (name) {
      cookies[name] = rest.join("=");
    }
  });

  return cookies;
}
