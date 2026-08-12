/**
 * Farm.js API Routes Vite Plugin
 *
 * Standalone API route support that works with any Vite setup.
 * Discovers and handles route.ts files in the api directory.
 * Also supports root routes.ts for custom route definitions.
 *
 * @example
 * ```ts
 * import { farmApiPlugin } from '@farm.js/core'
 *
 * export default defineConfig({
 *   plugins: [farmApiPlugin({ srcDir: 'src' })],
 * })
 * ```
 */

import type { Plugin, ViteDevServer } from "vite";
import { API_ROUTE_METHODS, invokeAPIRouteEndpoint, matchAPIRoute } from "./route-manager";
import { sendWebResponse } from "../server/response";
import { _withAfterNodeMiddleware } from "../after";
import { isProgrammaticRoutesFileName } from "../routes-shared";
import { findProgrammaticRouteFilesInDir } from "../routes.server";
import { toViteModuleId } from "../utils";
import {
  createFarmRequestBodyErrorResponse,
  readNodeRequestBody,
  resolveFarmServerConfig,
} from "../server-http";
import { createCliColors } from "../cli-colors";

export interface FarmApiPluginOptions {
  /** Source directory containing the api folder (default: 'src') */
  srcDir?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum request body size, for example `"10mb"`. */
  bodySizeLimit?: number | string;
}

export interface ApiRoute {
  path: string;
  filePath: string;
  methods: string[];
  endpoints: Record<string, any>;
}

/**
 * Farm.js API Routes Vite Plugin
 */
export function farmApiPlugin(options: FarmApiPluginOptions = {}): Plugin {
  const srcDir = options.srcDir ?? "src";
  const debug = options.debug ?? false;
  const bodySizeLimit = resolveFarmServerConfig({
    bodySizeLimit: options.bodySizeLimit,
  }).bodySizeLimit;

  // API routes cache
  let apiRoutesCache: Map<string, ApiRoute> = new Map();
  let apiRouterHandler: ((req: Request) => Promise<Response>) | null = null;
  let discoveryComplete = false;
  let discoveryPromise: Promise<void> | null = null;

  const log = (_message: string) => {};
  const logResponse = (method: string, urlPath: string, status: number, duration: number) => {
    const pc = createCliColors();
    let statusColor = pc.green;
    if (status >= 500) statusColor = pc.red;
    else if (status >= 400) statusColor = pc.yellow;
    else if (status >= 300) statusColor = pc.cyan;

    const logMsg = [
      pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
      pc.dim("[") + pc.bold(pc.cyan("API")) + pc.dim("]"),
      pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
      pc.gray(urlPath),
      pc.dim("-"),
      statusColor(status.toString()),
      pc.dim(`(${duration}ms)`),
    ].join(" ");
    console.log(logMsg);
  };

  const addEndpoint = (
    routePath: string,
    filePath: string,
    method: string,
    endpoint: any,
  ): void => {
    const normalizedMethod = method.toUpperCase();
    const existing = apiRoutesCache.get(routePath);

    if (existing) {
      if (!existing.methods.includes(normalizedMethod)) {
        existing.methods.push(normalizedMethod);
      }
      existing.endpoints[normalizedMethod] = endpoint;
      return;
    }

    apiRoutesCache.set(routePath, {
      path: routePath,
      filePath,
      methods: [normalizedMethod],
      endpoints: { [normalizedMethod]: endpoint },
    });
  };

  // Create API router handler
  const createRouter = async (): Promise<void> => {
    const totalEndpoints = Array.from(apiRoutesCache.values()).reduce(
      (sum, route) => sum + route.methods.length,
      0,
    );

    apiRouterHandler = null;

    if (totalEndpoints > 0) {
      apiRouterHandler = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();
        const pathname = url.pathname;

        const match = matchAPIRoute(apiRoutesCache, pathname);
        if (!match) {
          return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { route, params } = match;
        const endpoint = route.endpoints[method];
        if (!endpoint) {
          return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          return await invokeAPIRouteEndpoint(endpoint, request, params, bodySizeLimit);
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      };

      log(`API router created with ${totalEndpoints} endpoints`);
    }
  };

  return {
    name: "@farm.js/core:api",
    enforce: "pre",

    configureServer(server: ViteDevServer) {
      // Discover API routes in /api directory
      const discoverFileRoutes = async (apiDir: string): Promise<void> => {
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
        apiRoutesCache.clear();

        for (const filePath of routeFiles) {
          try {
            const relativePath = path.relative(apiDir, path.dirname(filePath));
            const routePath =
              "/api/" + (relativePath === "." ? "" : relativePath.replace(/\\/g, "/"));

            const routeModule = await server.ssrLoadModule(filePath);
            const endpoints: Record<string, any> = {};
            const availableMethods: string[] = [];

            for (const method of API_ROUTE_METHODS) {
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

              for (const [exportName, exportValue] of Object.entries(routesModule)) {
                const endpoint = exportValue as any;

                if (endpoint && endpoint.__path) {
                  const routePath = endpoint.__path;
                  const method = String(endpoint.__method || "GET").toUpperCase();

                  addEndpoint(routePath, routesFile, method, endpoint);
                  log(`Root route discovered: ${method} ${routePath}`);
                }
              }
            } catch (e: any) {
              log(`Root routes.ts load failed: ${e.message}`);
            }
            break;
          }
        }
      };

      const discoverProgrammaticRoutes = async (): Promise<void> => {
        const path = await import("path");
        const srcRoot = path.join(server.config.root, srcDir);
        const routeFiles = findProgrammaticRouteFilesInDir(srcRoot);
        if (routeFiles.length === 0) return;
        const { getProgrammaticRouteManifest } = await import("../routes");

        for (const routeFile of routeFiles) {
          try {
            const routesModule = await server.ssrLoadModule(
              toViteModuleId(routeFile, server.config.root),
            );
            const manifest = getProgrammaticRouteManifest(routesModule);
            if (!manifest) continue;

            for (const definition of manifest.routes) {
              if (definition.kind !== "api") continue;

              for (const [method, endpoint] of Object.entries(definition.methods)) {
                if (endpoint) {
                  addEndpoint(definition.path, routeFile, method, endpoint);
                  log(`Programmatic route discovered: ${method} ${definition.path}`);
                }
              }
            }
          } catch (e: any) {
            log(`Programmatic routes file load failed at ${routeFile}: ${e.message}`);
          }
        }
      };

      // Initialize discovery
      const initializeDiscovery = async () => {
        const path = await import("path");
        const apiDir = path.join(server.config.root, srcDir, "api");
        log(`Discovering API routes in: ${apiDir}`);

        await discoverFileRoutes(apiDir);
        await discoverRootRoutes();
        await discoverProgrammaticRoutes();
        await createRouter();

        discoveryComplete = true;
        log(`API discovery complete: ${apiRoutesCache.size} routes found`);
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

            if (discoveryPromise && !discoveryComplete) {
              await discoveryPromise;
            }

            if (!matchAPIRoute(apiRoutesCache, pathname)) {
              return next();
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

              let body: Buffer | undefined;
              if (method !== "GET" && method !== "HEAD") {
                body = await readNodeRequestBody(req as any, bodySizeLimit);
              }

              const request = new Request(fullUrl, {
                method,
                headers,
                body: body
                  ? (body.buffer.slice(
                      body.byteOffset,
                      body.byteOffset + body.byteLength,
                    ) as ArrayBuffer)
                  : undefined,
              });

              const response = await apiRouterHandler(request);

              const duration = Date.now() - startTime;
              logResponse(method, pathname, response.status, duration);

              await sendWebResponse(res, response);
            } catch (error: any) {
              const bodyErrorResponse = createFarmRequestBodyErrorResponse(error);
              if (bodyErrorResponse) {
                await sendWebResponse(res, bodyErrorResponse);
                return;
              }
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
      if (
        fileName === "routes.ts" ||
        fileName === "routes.tsx" ||
        fileName === "routes.js" ||
        isProgrammaticRoutesFileName(fileName)
      ) {
        log(`Root routes file updated: ${fileName}`);

        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        // Clear routes from this file
        for (const [routePath, route] of apiRoutesCache) {
          if (route.filePath === file) {
            apiRoutesCache.delete(routePath);
          }
        }

        try {
          const routesModule = await server.ssrLoadModule(file);

          for (const [exportName, exportValue] of Object.entries(routesModule)) {
            const endpoint = exportValue as any;

            if (endpoint && endpoint.__path) {
              const routePath = endpoint.__path;
              const method = String(endpoint.__method || "GET").toUpperCase();

              addEndpoint(routePath, file, method, endpoint);
              log(`Root route reloaded: ${method} ${routePath}`);
            }
          }

          const { getProgrammaticRouteManifest } = await import("../routes");
          const manifest = getProgrammaticRouteManifest(routesModule);
          if (manifest) {
            for (const definition of manifest.routes) {
              if (definition.kind !== "api") continue;

              for (const [method, endpoint] of Object.entries(definition.methods)) {
                if (endpoint) {
                  addEndpoint(definition.path, file, method, endpoint);
                  log(`Programmatic route reloaded: ${method} ${definition.path}`);
                }
              }
            }
          }

          await createRouter();
          log(`API router recreated`);
        } catch (e: any) {
          log(`Root routes.ts HMR failed: ${e.message}`);
        }

        return [];
      }

      // Handle file-based route updates
      if (file.includes("/api/") && fileName.startsWith("route.")) {
        const shortPath = file.split("/api/")[1] || file;
        log(`API route updated: ${shortPath}`);

        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        let routePathToUpdate: string | null = null;
        for (const [routePath, route] of apiRoutesCache) {
          if (route.filePath === file) {
            routePathToUpdate = routePath;
            break;
          }
        }

        if (routePathToUpdate) {
          try {
            const routeModule = await server.ssrLoadModule(file);
            const endpoints: Record<string, any> = {};
            const availableMethods: string[] = [];

            for (const method of API_ROUTE_METHODS) {
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
              await createRouter();
              log(`API router recreated`);
            }
          } catch (e: any) {
            log(`API route HMR failed: ${e.message}`);
          }
        } else {
          // New route file
          try {
            const path = await import("path");
            const apiDir = path.join(server.config.root, srcDir, "api");
            const relativePath = path.relative(apiDir, path.dirname(file));
            const routePath =
              "/api/" + (relativePath === "." ? "" : relativePath.replace(/\\/g, "/"));

            const routeModule = await server.ssrLoadModule(file);
            const endpoints: Record<string, any> = {};
            const availableMethods: string[] = [];

            for (const method of API_ROUTE_METHODS) {
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
              await createRouter();
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
