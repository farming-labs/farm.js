/**
 * Farm.js API Routes Plugin
 *
 * Standalone API route support that works with or without RSC.
 *
 * Supports two patterns:
 * 1. File-based routing: /src/api/hello/route.ts -> /api/hello
 *    The path is auto-inferred from file location
 *
 * 2. Root routes.ts file: /src/routes.ts with explicit paths
 *    createEndpoint('/api/custom', { method: 'GET' }, handler)
 *
 * Uses better-call's createRouter for proper Zod validation and parsing.
 *
 * @example
 * ```ts
 * import { farmApi } from '@farm.js/plugin/api'
 *
 * export default defineConfig({
 *   plugins: [farmApi({ srcDir: 'src' })],
 * })
 * ```
 */

import type { Plugin, ViteDevServer } from "vite";
import { _withAfterNodeMiddleware } from "@farm.js/core/after";
import { invokeAPIRouteEndpoint } from "@farm.js/core/api/runtime";

export interface FarmApiOptions {
  /** Source directory containing the api folder (default: 'src') */
  srcDir?: string;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ApiRoute {
  path: string;
  filePath: string;
  methods: string[];
  endpoints: Record<string, any>;
}

/**
 * Farm.js API Routes Plugin
 */
export default function farmApi(options: FarmApiOptions = {}): Plugin {
  const srcDir = options.srcDir ?? "src";
  const debug = options.debug ?? false;

  // API routes cache
  let apiRoutesCache: Map<string, ApiRoute> = new Map();
  let apiRouterHandler: ((req: Request) => Promise<Response>) | null = null;
  let discoveryComplete = false;
  let discoveryPromise: Promise<void> | null = null;
  let currentServer: ViteDevServer | null = null;

  // Debug-only logging for discovery messages with [FARM] prefix
  const log = (message: string) => {
    if (!debug) return;
    try {
      const pc = require("picocolors");
      console.log(pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]") + " " + pc.gray(message));
    } catch {
      console.log(`[FARM] ${message}`);
    }
  };

  // Always log API request/response with [FARM] [API] [METHOD] format
  const logResponse = (method: string, urlPath: string, status: number, duration: number) => {
    try {
      const pc = require("picocolors");
      let statusColor = pc.green;
      if (status >= 500) statusColor = pc.red;
      else if (status >= 400) statusColor = pc.yellow;
      else if (status >= 300) statusColor = pc.cyan;

      const log = [
        pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
        pc.dim("[") + pc.bold(pc.cyan("API")) + pc.dim("]"),
        pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
        pc.gray(urlPath),
        pc.dim("-"),
        statusColor(status.toString()),
        pc.dim(`(${duration}ms)`),
      ].join(" ");
      console.log(log);
    } catch {
      console.log(`[FARM] [API] [${method}] ${urlPath} - ${status} (${duration}ms)`);
    }
  };

  // Create API router handler
  // We use direct invocation for better control over path matching
  const createBetterCallRouter = async (): Promise<void> => {
    const totalEndpoints = Array.from(apiRoutesCache.values()).reduce(
      (sum, route) => sum + route.methods.length,
      0,
    );

    if (totalEndpoints > 0) {
      // Create a handler that matches routes and invokes endpoints
      apiRouterHandler = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        const method = request.method;
        const pathname = url.pathname;

        // Find matching route
        const route = apiRoutesCache.get(pathname);
        if (!route) {
          return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const endpoint = route.endpoints[method];
        if (!endpoint) {
          return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          return await invokeAPIRouteEndpoint(endpoint, request);
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      };

      log(`better-call router created with ${totalEndpoints} endpoints`);
    }
  };

  // Fallback handler when better-call is not available
  const createFallbackHandler = (): ((req: Request) => Promise<Response>) => {
    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const method = request.method;

      // Find matching route
      const route = apiRoutesCache.get(url.pathname);
      if (!route) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const endpoint = route.endpoints[method];
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        // For fallback, call the endpoint directly (without Zod parsing)
        const result = await endpoint(request);
        if (result instanceof Response) {
          return result;
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    };
  };

  return {
    name: "@farm.js/plugin/api",
    enforce: "pre",

    configureServer(server: ViteDevServer) {
      currentServer = server;

      // Discover API routes
      const discoverAPIRoutes = async (apiDir: string): Promise<void> => {
        const fs = await import("fs");
        const path = await import("path");

        if (!fs.existsSync(apiDir)) {
          log("No api directory found");
          return;
        }

        const findRouteFiles = (dir: string): string[] => {
          const files: string[] = [];
          if (!fs.existsSync(dir)) return files;
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              files.push(...findRouteFiles(fullPath));
            } else if (
              entry.name === "route.ts" ||
              entry.name === "route.tsx" ||
              entry.name === "route.js"
            ) {
              files.push(fullPath);
            }
          }
          return files;
        };

        const routeFiles = findRouteFiles(apiDir);

        // Clear cache for rediscovery
        apiRoutesCache.clear();

        for (const filePath of routeFiles) {
          try {
            const relativePath = path.relative(apiDir, path.dirname(filePath));
            const routePath =
              "/api/" + (relativePath === "." ? "" : relativePath.replace(/\\/g, "/"));

            const routeModule = await server.ssrLoadModule(filePath);
            const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
            const endpoints: Record<string, any> = {};
            const availableMethods: string[] = [];

            for (const method of methods) {
              if (routeModule[method]) {
                availableMethods.push(method);
                endpoints[method] = routeModule[method];
              }
            }

            if (availableMethods.length > 0) {
              apiRoutesCache.set(routePath, {
                path: routePath,
                filePath,
                methods: availableMethods,
                endpoints,
              });
              log(`API route discovered: ${availableMethods.join(", ")} ${routePath}`);
            }
          } catch (e: any) {
            log(`API route load failed at ${filePath}: ${e.message}`);
          }
        }
        // Router is created after all routes are discovered (including root routes.ts)
      };

      // Discover routes from root routes.ts file
      const discoverRootRoutes = async (): Promise<void> => {
        const fs = await import("fs");
        const path = await import("path");

        const routesFiles = [
          path.join(server.config.root, srcDir, "routes.ts"),
          path.join(server.config.root, srcDir, "routes.tsx"),
          path.join(server.config.root, srcDir, "routes.js"),
        ];

        for (const routesFile of routesFiles) {
          if (fs.existsSync(routesFile)) {
            try {
              const routesModule = await server.ssrLoadModule(routesFile);

              // Look for exported endpoints with explicit paths
              for (const [exportName, exportValue] of Object.entries(routesModule)) {
                // Check both object and function exports (better-call returns functions)
                const endpoint = exportValue as any;

                if (endpoint && endpoint.__path) {
                  const routePath = endpoint.__path;
                  const method = endpoint.__method || "GET";

                  // Add to cache
                  const existing = apiRoutesCache.get(routePath);
                  if (existing) {
                    existing.methods.push(method);
                    existing.endpoints[method] = endpoint;
                  } else {
                    apiRoutesCache.set(routePath, {
                      path: routePath,
                      filePath: routesFile,
                      methods: [method],
                      endpoints: { [method]: endpoint },
                    });
                  }
                  // Root route discovery log omitted
                }
              }
            } catch (e: any) {
              log(`Root routes.ts load failed: ${e.message}`);
            }
            break; // Only load the first routes file found
          }
        }
      };

      // Initialize discovery
      const initializeDiscovery = async () => {
        const path = await import("path");
        const apiDir = path.join(server.config.root, srcDir, "api");
        await discoverAPIRoutes(apiDir);
        await discoverRootRoutes();
        await createBetterCallRouter();
        discoveryComplete = true;
      };

      discoveryPromise = initializeDiscovery().catch((e) => {
        console.error("[FARM] API discovery error:", e);
      });

      // Expose API router for other plugins
      (server as any).__farmApi__ = {
        getHandler: () => apiRouterHandler,
        getRoutes: () => apiRoutesCache,
        isReady: () => discoveryComplete,
        waitForDiscovery: () => discoveryPromise,
      };

      // Add middleware to handle API requests
      return () => {
        server.middlewares.use(
          _withAfterNodeMiddleware(async (req, res, next) => {
            const url = req.url || "/";
            const pathname = url.split("?")[0];
            const method = req.method || "GET";

            // Only handle /api/ routes
            if (!pathname.startsWith("/api/")) {
              return next();
            }

            // Wait for discovery
            if (discoveryPromise && !discoveryComplete) {
              await discoveryPromise;
            }

            if (!apiRouterHandler) {
              return next();
            }

            const startTime = Date.now();

            try {
              // Execute middleware if available
              const farmMiddleware = (server as any).__farmMiddleware__;
              if (farmMiddleware) {
                await farmMiddleware.waitForDiscovery?.();
                const middlewareData = new Map<string, any>();
                const handled = await farmMiddleware.execute(req, res, pathname, middlewareData);
                if (handled) {
                  const duration = Date.now() - startTime;
                  logResponse(method, pathname, res.statusCode || 200, duration);
                  return;
                }
              }

              // Convert Node request to Web Request
              const fullUrl = `http://${req.headers.host || "localhost:3000"}${url}`;
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (value) {
                  headers.set(key, Array.isArray(value) ? value.join(", ") : value);
                }
              }

              // Get body for non-GET requests
              let body: string | undefined;
              if (method !== "GET" && method !== "HEAD") {
                body = await new Promise<string>((resolve) => {
                  let data = "";
                  req.on("data", (chunk: any) => {
                    data += chunk;
                  });
                  req.on("end", () => {
                    resolve(data);
                  });
                });
              }

              const request = new Request(fullUrl, {
                method,
                headers,
                body: body || undefined,
              });

              const response = await apiRouterHandler(request);

              const duration = Date.now() - startTime;
              logResponse(method, pathname, response.status, duration);

              // Send response
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });

              const responseBody = await response.text();
              res.end(responseBody);
            } catch (error: any) {
              const duration = Date.now() - startTime;
              logResponse(method, pathname, 500, duration);
              console.error("[FARM] API error:", error);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
          }),
        );
      };
    },

    async handleHotUpdate({ file, server, modules }) {
      const fileName = file.split("/").pop() || "";

      // Handle root routes.ts updates
      if (fileName === "routes.ts" || fileName === "routes.tsx" || fileName === "routes.js") {
        log(`Root routes file updated: ${fileName}`);

        // Invalidate all affected modules
        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        // Clear routes that came from this file and rediscover
        for (const [routePath, route] of apiRoutesCache) {
          if (route.filePath === file) {
            apiRoutesCache.delete(routePath);
          }
        }

        try {
          const routesModule = await server.ssrLoadModule(file);

          // Look for exported endpoints with explicit paths
          // Endpoints can be functions (from better-call) or objects
          for (const [exportName, exportValue] of Object.entries(routesModule)) {
            const endpoint = exportValue as any;

            if (endpoint && endpoint.__path) {
              const routePath = endpoint.__path;
              const method = endpoint.__method || "GET";

              // Add to cache
              const existing = apiRoutesCache.get(routePath);
              if (existing) {
                existing.methods.push(method);
                existing.endpoints[method] = endpoint;
              } else {
                apiRoutesCache.set(routePath, {
                  path: routePath,
                  filePath: file,
                  methods: [method],
                  endpoints: { [method]: endpoint },
                });
              }
              log(`Root route reloaded: ${method} ${routePath}`);
            }
          }

          // Recreate better-call router
          await createBetterCallRouter();
          log(`better-call router recreated`);
        } catch (e: any) {
          log(`Root routes.ts HMR failed: ${e.message}`);
        }

        return [];
      }

      if (file.includes("/api/") && fileName.startsWith("route.")) {
        const shortPath = file.split("/api/")[1] || file;
        log(`API route updated: ${shortPath}`);

        // Invalidate all affected modules
        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        // Find the route path for this file
        let routePathToUpdate: string | null = null;
        for (const [routePath, route] of apiRoutesCache) {
          if (route.filePath === file) {
            routePathToUpdate = routePath;
            break;
          }
        }

        if (routePathToUpdate) {
          try {
            // Reload the module
            const routeModule = await server.ssrLoadModule(file);
            const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
            const endpoints: Record<string, any> = {};
            const availableMethods: string[] = [];

            for (const method of methods) {
              if (routeModule[method]) {
                availableMethods.push(method);
                endpoints[method] = routeModule[method];
              }
            }

            if (availableMethods.length > 0) {
              apiRoutesCache.set(routePathToUpdate, {
                path: routePathToUpdate,
                filePath: file,
                methods: availableMethods,
                endpoints,
              });
              log(`API route reloaded: ${routePathToUpdate}`);

              // Recreate better-call router with updated endpoints
              await createBetterCallRouter();
              log(`better-call router recreated`);
            }
          } catch (e: any) {
            log(`API route HMR failed: ${e.message}`);
          }
        } else {
          // New route file - discover it
          try {
            const path = await import("path");
            const apiDir = path.join(server.config.root, srcDir, "api");
            const relativePath = path.relative(apiDir, path.dirname(file));
            const routePath =
              "/api/" + (relativePath === "." ? "" : relativePath.replace(/\\/g, "/"));

            const routeModule = await server.ssrLoadModule(file);
            const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
            const endpoints: Record<string, any> = {};
            const availableMethods: string[] = [];

            for (const method of methods) {
              if (routeModule[method]) {
                availableMethods.push(method);
                endpoints[method] = routeModule[method];
              }
            }

            if (availableMethods.length > 0) {
              apiRoutesCache.set(routePath, {
                path: routePath,
                filePath: file,
                methods: availableMethods,
                endpoints,
              });
              log(`New API route discovered: ${routePath}`);

              // Recreate better-call router with new endpoint
              await createBetterCallRouter();
            }
          } catch (e: any) {
            log(`New API route load failed: ${e.message}`);
          }
        }

        return [];
      }
    },
  };
}

export { farmApi };
