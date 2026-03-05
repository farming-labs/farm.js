import type { Plugin, ViteDevServer, HmrContext } from "vite";
import type { FarmConfig } from "./types";
import { FarmApp } from "./app";
import { logger } from "./utils";
import { defaultGlobalCSS } from "./default-styles";
import type { PluginManager } from "./plugin";
import { HMRManager } from "./hmr";
import { APIRouteManager } from "./api/route-manager";
import { OpenAPIManager } from "./openapi/manager";
import { MiddlewareManager } from "./middleware/manager";
import { generateRouteTypes } from "./routing/generate-route-types";
import * as fs from "fs";
import * as path from "path";
import type { FarmUserConfig } from "./config";

interface FarmVitePluginOptions extends FarmConfig {
  openapi?: FarmUserConfig["openapi"];
}

export function farmPlugin(
  options: FarmVitePluginOptions = {},
  initialPluginManager?: PluginManager,
): Plugin {
  let farmApp: FarmApp;
  let server: ViteDevServer;
  let hmrManager: HMRManager;
  let apiRouteManager: APIRouteManager;
  let openAPIManager: OpenAPIManager | null = null;
  let middlewareManager: MiddlewareManager;
  const pluginManager: PluginManager | undefined = initialPluginManager;

  return {
    name: "farm",

    async configResolved(config) {
      // Defer initialization until Vite server is available
    },

    async configureServer(viteServer) {
      server = viteServer;

      // Store the plugin manager passed during creation
      const pm = initialPluginManager;

      farmApp = new FarmApp(
        {
          root: server.config.root,
          ...options,
        },
        server,
      );

      const globalsCSSPath = path.join(server.config.root, "src/app/globals.css");
      if (!fs.existsSync(globalsCSSPath)) {
        const appDir = path.join(server.config.root, "src/app");
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }
        fs.writeFileSync(globalsCSSPath, defaultGlobalCSS);
      }

      await farmApp.initialize();

      const farmConfig = farmApp.getConfig();
      try {
        await generateRouteTypes({
          root: farmConfig.root,
          srcDir: farmConfig.srcDir,
          suppressLintOnLink: farmConfig.suppressLintOnLink,
        });
      } catch (e) {
        if (process.env.FARM_VERBOSE)
          logger.warn("Route type generation failed: " + (e as Error).message);
      }

      const appDirSlug = path.join(farmConfig.root, farmConfig.srcDir, "app").replace(/\\/g, "/");
      const isPageFile = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        return normalized.includes(appDirSlug) && /page\.(ts|tsx|js|jsx)$/.test(normalized);
      };
      let routeTypeGenScheduled: ReturnType<typeof setTimeout> | null = null;
      const scheduleRouteTypeGen = () => {
        if (routeTypeGenScheduled) return;
        routeTypeGenScheduled = setTimeout(() => {
          routeTypeGenScheduled = null;
          generateRouteTypes({
            root: farmConfig.root,
            srcDir: farmConfig.srcDir,
            suppressLintOnLink: farmConfig.suppressLintOnLink,
          }).catch(() => {});
        }, 100);
      };
      ["add", "change", "unlink"].forEach((ev) => {
        server.watcher.on(ev as "add", (file: string) => {
          if (isPageFile(file)) scheduleRouteTypeGen();
        });
      });

      // Initialize HMR manager
      hmrManager = new HMRManager(server);

      // Initialize API route manager
      const appDir = path.join(server.config.root, "src/app");
      apiRouteManager = new APIRouteManager(appDir, server);
      await apiRouteManager.discoverRoutes();

      middlewareManager = new MiddlewareManager(appDir, server);
      await middlewareManager.discover();

      // Initialize OpenAPI manager if enabled
      if (options.openapi?.enabled) {
        openAPIManager = new OpenAPIManager(appDir, options.openapi);
        await openAPIManager.generateSpec();
        logger.success("✅ OpenAPI documentation enabled");
      }

      // Built-in terminal logging (always enabled in development, independent of logger plugin)
      const logRequest = (method: string, urlPath: string, tag: "API" | "PAGE") => {
        try {
          const pc = require("picocolors");
          const log = [
            pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.cyan(tag)) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
            tag === "API" ? pc.gray("Requesting ") : pc.gray("Loading "),
            pc.gray(urlPath),
          ].join(" ");
          console.log(log);
        } catch {
          console.log(`[FARM] [${tag}] [${method}] ${urlPath}`);
        }
      };

      const logResponse = (
        method: string,
        urlPath: string,
        status: number,
        duration: number,
        tag: "API" | "PAGE",
      ) => {
        try {
          const pc = require("picocolors");
          let statusColor = pc.green;
          if (status >= 500) statusColor = pc.red;
          else if (status >= 400) statusColor = pc.yellow;
          else if (status >= 300) statusColor = pc.cyan;

          const log = [
            pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.cyan(tag)) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
            pc.gray(urlPath),
            pc.dim("-"),
            statusColor(status.toString()),
            pc.dim(`(${duration}ms)`),
          ].join(" ");
          console.log(log);
        } catch {
          console.log(`[FARM] [${tag}] [${method}] ${urlPath} - ${status} (${duration}ms)`);
        }
      };

      // Register middleware directly (not in return function) to ensure it runs early
      server.middlewares.use(async (req, res, next) => {
        // Handle OpenAPI docs route
        if (openAPIManager && req.url === options.openapi?.route) {
          const docsHandler = openAPIManager.getDocsRouteHandler();
          return docsHandler(req, res);
        }

        // Handle API routes first
        if (req.url?.startsWith("/api/")) {
          const apiHandler = apiRouteManager.getHandler();
          if (apiHandler) {
            const startTime = Date.now();
            const method = req.method || "GET";
            const urlPath = req.url || "/";

            // Log API request
            // logRequest(method, urlPath, "API");

            try {
              // Convert Node.js request to Web Request
              const url = `http://${req.headers.host || "localhost:3000"}${req.url}`;
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (value) {
                  headers.set(key, Array.isArray(value) ? value.join(", ") : value);
                }
              }

              // Get body for POST/PUT/PATCH
              let body: string | undefined;
              if (req.method !== "GET" && req.method !== "HEAD") {
                body = await new Promise<string>((resolve) => {
                  let data = "";
                  req.on("data", (chunk) => {
                    data += chunk;
                  });
                  req.on("end", () => {
                    resolve(data);
                  });
                });
              }

              const request = new Request(url, {
                method: req.method,
                headers,
                body: body || undefined,
              });

              // Call better-call handler
              const response = await apiHandler(request);

              const duration = Date.now() - startTime;
              logResponse(method, urlPath, response.status, duration, "API");

              // Send response
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });

              const responseBody = await response.text();
              res.end(responseBody);
              return;
            } catch (error) {
              logger.error(`API route error: ${error}`);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error" }));
              return;
            }
          }
        }

        // Skip internal Vite requests
        if (
          req.url?.startsWith("/@") ||
          req.url?.startsWith("/node_modules") ||
          (req.url?.includes(".") && !req.url?.endsWith(".html"))
        ) {
          return next();
        }

        // Handle SPA page-data requests for client-side navigation
        if (req.url?.startsWith("/__farm/page-data")) {
          const urlObj = new URL(req.url, `http://${req.headers.host || "localhost:3000"}`);
          const targetPath = urlObj.searchParams.get("path") || "/";

          try {
            const routeManager = farmApp.getRouteManager();
            const match = routeManager.matchRoute(targetPath);

            if (!match) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Route not found" }));
              return;
            }

            const { route, params, layouts } = match;

            // Check if route was found
            if (!route) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Route not found" }));
              return;
            }

            // Load route module to get metadata
            const routeModule = await routeManager.loadRouteModule(route.modulePath);

            // Check if client component
            let isClientComponent = false;
            try {
              const content = fs.readFileSync(route.modulePath, "utf-8");
              isClientComponent =
                content.trimStart().startsWith("'use client'") ||
                content.trimStart().startsWith('"use client"');
            } catch {
              isClientComponent = false;
            }

            // Collect metadata from layouts and page
            let mergedMetadata: Record<string, any> = {};
            const layoutModules = await Promise.all(
              layouts.map((layout) => routeManager.loadLayoutModule(layout.modulePath)),
            );

            for (const layoutModule of layoutModules) {
              if ((layoutModule as any).metadata) {
                mergedMetadata = { ...mergedMetadata, ...(layoutModule as any).metadata };
              }
            }

            if ((routeModule as any).metadata) {
              mergedMetadata = { ...mergedMetadata, ...(routeModule as any).metadata };
            }

            // Build search params
            const targetUrl = new URL(targetPath, "http://localhost");
            const searchParams: Record<string, string> = {};
            targetUrl.searchParams.forEach((value, key) => {
              searchParams[key] = value;
            });

            // Convert absolute paths to URL paths (relative to project root)
            const projectRoot = server.config.root;
            const toUrlPath = (absolutePath: string) => {
              if (absolutePath.startsWith(projectRoot)) {
                return absolutePath.slice(projectRoot.length);
              }
              return absolutePath;
            };

            // Return page data for SPA navigation
            const pageData = {
              props: { params, searchParams },
              modulePath: toUrlPath(route.modulePath),
              isClientComponent,
              metadata: {
                title: mergedMetadata.title,
                description: mergedMetadata.description,
              },
              layoutModules: layouts.map((l) => toUrlPath(l.modulePath)),
            };

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "private, max-age=0");
            res.end(JSON.stringify(pageData));
            return;
          } catch (error) {
            console.error("[Farm.js] Page data error:", error);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "Failed to load page data",
                message: error instanceof Error ? error.message : "Unknown error",
              }),
            );
            return;
          }
        }

        const startTime = Date.now();
        const method = req.method || "GET";
        const urlPath = req.url || "/";

        // logRequest(method, urlPath, "PAGE");

        try {
          if (middlewareManager) {
            const handled = await middlewareManager.execute(req, res);
            if (handled) {
              const duration = Date.now() - startTime;
              logResponse(method, urlPath, res.statusCode || 200, duration, "PAGE");
              return; // Middleware handled the response
            }
          }

          // Run beforeRequest hooks
          if (pm) {
            await pm.runHookParallel("beforeRequest", req, res);
          }

          if (res.writableEnded) {
            // Log response if already ended
            const duration = Date.now() - startTime;
            logResponse(method, urlPath, res.statusCode || 200, duration, "PAGE");
            return;
          }

          // Intercept res.end to call afterResponse hooks and log response before response is fully sent
          const originalEnd = res.end.bind(res);
          let afterResponseCalled = false;

          res.end = ((...args: any[]) => {
            if (!afterResponseCalled && pm) {
              afterResponseCalled = true;
              // Log page response
              const duration = Date.now() - startTime;
              logResponse(method, urlPath, res.statusCode || 200, duration, "PAGE");
              // Call afterResponse synchronously before actually ending
              pm.runHookParallel("afterResponse", req, res)
                .then(() => {
                  originalEnd(...args);
                })
                .catch((err) => {
                  console.error("Error in afterResponse hook:", err);
                  originalEnd(...args);
                });
            } else {
              originalEnd(...args);
            }
          }) as any;

          // Note: __FARM_PROPS__ is set by the renderer with actual page props (params, searchParams)

          const renderer = farmApp.getServerRenderer();
          await renderer.renderPage(req as any, res as any);
        } catch (error) {
          // Log error response
          const duration = Date.now() - startTime;
          logResponse(method, urlPath, 500, duration, "PAGE");
          next(error);
        }
      });
    },

    resolveId(id) {
      if (id === "/@farm/client" || id === "/@farm/client.js") {
        return id;
      }

      if (id === "/@farm/server") {
        return id;
      }

      // Virtual manifest module - TanStack Start pattern
      if (id === "virtual:farm-manifest" || id === "/@farm/manifest") {
        return "/@farm/manifest";
      }
    },

    load(id) {
      if (id === "/@farm/client" || id === "/@farm/client.js") {
        return generateClientCode();
      }

      if (id === "/@farm/server") {
        return generateServerCode();
      }

      // Virtual manifest module - TanStack Start pattern
      // Manifest is generated at build time and inlined
      if (id === "/@farm/manifest") {
        const routeManager = farmApp?.getRouteManager();
        if (!routeManager) {
          return `
export const getManifest = () => ({
  routes: {},
  layouts: {},
  clientEntry: "/@farm/client.js",
  sharedAssets: []
});
`;
        }

        const manifest = routeManager.generateClientManifest(server.config.root);

        // Convert to full manifest format
        const fullManifest = {
          clientEntry: "/@farm/client.js",
          routes: {} as Record<string, any>,
          layouts: {} as Record<string, any>,
          sharedAssets: [
            { tag: "link", attrs: { rel: "stylesheet", href: "/src/app/globals.css" } },
          ],
        };

        // Convert routes array to object keyed by pattern
        for (const route of manifest.routes) {
          const isClient = (() => {
            try {
              const absolutePath = path.join(server.config.root, route.modulePath);
              const content = fs.readFileSync(absolutePath, "utf-8");
              return (
                content.trimStart().startsWith("'use client'") ||
                content.trimStart().startsWith('"use client"')
              );
            } catch {
              return false;
            }
          })();

          fullManifest.routes[route.pattern] = {
            modulePath: route.modulePath,
            pattern: route.pattern,
            segments: route.segments,
            isClientComponent: isClient,
            preloads: [route.modulePath], // In dev, preload is just the module
            assets: [],
          };
        }

        // Convert layouts array to object keyed by pattern
        for (const layout of manifest.layouts) {
          fullManifest.layouts[layout.pattern] = {
            modulePath: layout.modulePath,
            pattern: layout.pattern,
            preloads: [layout.modulePath],
            assets: [],
          };
        }

        return `
// Auto-generated manifest for SPA navigation (TanStack Start pattern)
// This manifest is inlined in the server bundle - no file on disk
// Client receives this via window.__FARM_MANIFEST__ in HTML
export const getManifest = () => (${JSON.stringify(fullManifest, null, 2)});
export const manifest = getManifest();
`;
      }
    },

    transform(code, id) {
      if (
        code.trimStart().startsWith("'use client'") ||
        code.trimStart().startsWith('"use client"')
      ) {
        const moduleInfo = this.getModuleInfo(id);
        if (moduleInfo) {
          (moduleInfo as any).isClientComponent = true;
        }

        // Store client component for later injection
        if (!farmApp) return;

        const clientComponents = (farmApp as any).__clientComponents__ || new Set();
        clientComponents.add(id);
        (farmApp as any).__clientComponents__ = clientComponents;

        // Add HMR support for client components
        // This ensures React re-renders when the component updates
        const hmrCode = `
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule && newModule.default && window.__FARM_REACT_ROOT__) {
      // Re-render with the new component
      const React = window.__FARM_REACT__;
      const props = window.__FARM_PROPS__ || {};
      window.__FARM_REACT_ROOT__.render(React.createElement(newModule.default, props));
      console.log('[Farm.js] ⚡ HMR update applied');
    }
  });
}
`;
        return {
          code: code + "\n" + hmrCode,
          map: null,
        };
      }

      return null;
    },

    generateBundle(options, bundle) {
      const clientManifest = generateClientManifest(bundle);
      this.emitFile({
        type: "asset",
        fileName: "farm-client-manifest.json",
        source: JSON.stringify(clientManifest, null, 2),
      });
    },

    async closeBundle() {
      // SSG: Pre-render static pages at build time
      if (!farmApp) return;

      try {
        const routeManager = farmApp.getRouteManager();
        if (!routeManager) return;

        const { ssg: ssgPages, ssr: ssrRoutes } = await routeManager.collectSSGPages();

        if (ssgPages.length === 0) {
          logger.info("No SSG pages found - all pages will use SSR");
          return;
        }

        logger.info(`Found ${ssgPages.length} SSG pages, ${ssrRoutes.length} SSR routes`);
        logger.info("Pre-rendering SSG pages...");

        const outDir = path.join(server?.config.root || process.cwd(), options.outDir || "dist");
        const clientDir = path.join(outDir, "client");

        // Pre-render each SSG page
        for (const page of ssgPages) {
          try {
            // Load the route module
            const mod = await routeManager.loadRouteModule(page.filePath);
            if (!mod?.default) continue;

            // Find matching layouts
            const { layouts } = routeManager.matchRoute(page.urlPath);
            const layoutModules = await Promise.all(
              layouts.map((l) => routeManager.loadLayoutModule(l.modulePath)),
            );

            // Render the page
            const React = await import("react");
            const { renderToString } = await import("react-dom/server");

            const PageComponent = mod.default;
            const pageProps = {
              params: page.params,
              searchParams: Promise.resolve({}),
              path: page.urlPath,
            };

            let pageElement = React.createElement(PageComponent as any, pageProps);

            // Wrap with layouts
            for (let i = layoutModules.length - 1; i >= 0; i--) {
              const layoutModule = layoutModules[i];
              const LayoutComponent = layoutModule.default;
              pageElement = React.createElement(LayoutComponent, {
                children: pageElement,
                params: page.params,
              } as any);
            }

            const html = renderToString(pageElement);

            // Generate full HTML with proper structure
            const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/assets/globals.css">
  ${page.revalidate ? `<meta name="x-farm-revalidate" content="${page.revalidate}">` : ""}
</head>
<body>
  <div id="root">${html}</div>
  <script type="module" src="/assets/client.js"></script>
</body>
</html>`;

            // Write to output directory
            const outputPath =
              page.urlPath === "/"
                ? path.join(clientDir, "index.html")
                : path.join(clientDir, page.urlPath + ".html");

            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, fullHtml);

            const revalidateInfo = page.revalidate ? ` (revalidate: ${page.revalidate}s)` : "";
            logger.success(`  ✓ ${page.urlPath}${revalidateInfo}`);
          } catch (error) {
            logger.error(`  ✗ ${page.urlPath}: ${error}`);
          }
        }

        // Write SSG manifest for server to know which pages are pre-rendered
        const manifestPath = path.join(outDir, "__ssg_manifest.json");
        fs.writeFileSync(
          manifestPath,
          JSON.stringify(
            ssgPages.map((p) => ({
              urlPath: p.urlPath,
              params: p.params,
              revalidate: p.revalidate,
            })),
            null,
            2,
          ),
        );

        logger.success(`SSG complete: ${ssgPages.length} pages pre-rendered`);
      } catch (error) {
        logger.error(`SSG build failed: ${error}`);
      }
    },

    async handleHotUpdate(ctx: HmrContext) {
      const { file, server, modules } = ctx;
      if (file.includes("/app/")) {
        // Hot reload middleware changes
        if (file.includes("middleware.")) {
          if (middlewareManager) {
            await middlewareManager.reload();
            logger.success("✅ Middleware reloaded!");
          }

          return [];
        }

        // Auto-generate types when API routes change
        if (file.includes("/api/") && file.includes("/route.")) {
          const shortPath = file.split("/app/")[1] || file;
          logger.event(`API route updated: ${shortPath} - regenerating types...`);

          // Dynamically regenerate API types
          try {
            const { APITypeGenerator } = await import("./type-generator.js");
            const { join } = await import("path");
            const { fileURLToPath } = await import("url");

            const appDir = file.substring(0, file.indexOf("/app/") + 4);
            const outputPath = join(appDir, "../lib/api.generated.ts");

            const generator = new APITypeGenerator(appDir);
            generator.generateAPIIndex(outputPath);
            logger.success("✅ API types regenerated!");

            // Regenerate OpenAPI spec if enabled
            if (openAPIManager) {
              await openAPIManager.invalidateCache();
              logger.success("✅ OpenAPI spec regenerated!");
            }
          } catch (error) {
            logger.warn(`Failed to regenerate API types: ${error}`);
          }
        }

        if (file.includes("page.") || file.includes("layout.")) {
          const shortPath = file.split("/app/")[1] || file;
          logger.event(`Updated: ${shortPath}`);

          for (const mod of modules) {
            server.moduleGraph.invalidateModule(mod);
          }

          server.ws.send({
            type: "full-reload",
            path: "*",
          });

          return [];
        }
      }

      return modules;
    },
  };
}

function generateClientCode(): string {
  return `
import React from 'react'
import { hydrateRoot, createRoot } from 'react-dom/client'

// ⭐ Farm.js SPA Client Runtime (TanStack Start pattern)
// Uses manifest-based chunk loading - NO HTML fetching!
// Manifest is inlined in HTML via window.__FARM_MANIFEST__

// Expose React for HMR
window.__FARM_REACT__ = React;

let reactRoot = null;

// Get manifest from window (inlined by server in HTML)
// Fallback to empty manifest if not available yet
const getManifest = () => window.__FARM_MANIFEST__ || { routes: {}, layouts: {}, clientEntry: '', sharedAssets: [] };

// ====== CLIENT-SIDE ROUTE MATCHING ======
// Matches URL to route using manifest (no server request!)

function matchSegment(urlSegment, routeSegment) {
  if (!routeSegment.isDynamic) {
    return urlSegment === routeSegment.segment ? {} : null;
  }
  if (routeSegment.isCatchAll) {
    return { [routeSegment.segment]: urlSegment };
  }
  return { [routeSegment.segment]: urlSegment };
}

function matchRoute(pathname, routeSegments) {
  const normalizedPath = pathname === '/' ? '' : pathname.replace(/^\\//, '').replace(/\\/$/, '');
  const pathSegments = normalizedPath ? normalizedPath.split('/') : [];
  
  // Handle catch-all routes
  const hasCatchAll = routeSegments.some(s => s.isCatchAll);
  
  if (!hasCatchAll && pathSegments.length !== routeSegments.length) {
    return null;
  }
  
  const params = {};
  
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i];
    const pathSeg = pathSegments[i];
    
    if (routeSeg.isCatchAll) {
      // Collect remaining segments
      params[routeSeg.segment] = pathSegments.slice(i).join('/');
      return params;
    }
    
    if (pathSeg === undefined) {
      if (routeSeg.isOptional) continue;
      return null;
    }
    
    const match = matchSegment(pathSeg, routeSeg);
    if (match === null) return null;
    Object.assign(params, match);
  }
  
  return params;
}

function findRoute(pathname) {
  const manifest = getManifest();
  const routes = Object.values(manifest.routes);
  
  for (const route of routes) {
    const params = matchRoute(pathname, route.segments);
    if (params !== null) {
      return { route, params };
    }
  }
  return null;
}

function findLayouts(pathname) {
  const manifest = getManifest();
  const layouts = Object.values(manifest.layouts);
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\\/$/, '');
  const matchingLayouts = [];
  
  for (const layout of layouts) {
    // Root layout matches everything
    if (layout.pattern === '/') {
      matchingLayouts.push(layout);
      continue;
    }
    // Check if pathname starts with layout pattern
    if (normalizedPath.startsWith(layout.pattern) || 
        normalizedPath === layout.pattern.replace(/\\/[^/]+$/, '')) {
      matchingLayouts.push(layout);
    }
  }
  
  return matchingLayouts.sort((a, b) => a.pattern.length - b.pattern.length);
}

// ====== SPA ROUTER ======
// Client-side router - no server requests needed!

class SPARouter {
  constructor() {
    this.moduleCache = new Map();
    this.prefetchingUrls = new Set();
    this.observers = new Map();
    
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.handlePopState.bind(this));
    }
  }

  setNavigationHandler(handler) {
    this.onNavigate = handler;
  }

  async navigate(href, options = {}) {
    const { replace = false, scroll = true } = options;
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;
    const search = url.search;
    const fullPath = pathname + search;

    // Same page - just update hash
    if (pathname === window.location.pathname && search === window.location.search) {
      if (url.hash) window.location.hash = url.hash;
      return;
    }

    // Save scroll position
    this.saveScrollPosition(window.location.pathname);

    try {
      // CLIENT-SIDE route matching - no server request!
      const match = findRoute(pathname);
      if (!match) {
        console.warn('[Farm.js] Route not found:', pathname);
        window.location.href = href;
        return;
      }

      const { route, params } = match;
      
      // Parse search params
      const searchParams = {};
      url.searchParams.forEach((value, key) => {
        searchParams[key] = value;
      });

      // Build page data from manifest (no server request!)
      const pageData = {
        route: route, // Full route entry from manifest
        params,
        searchParams,
        layouts: findLayouts(pathname),
      };

      // Update URL
      if (replace) {
        window.history.replaceState({ path: fullPath }, '', fullPath);
      } else {
        window.history.pushState({ path: fullPath }, '', fullPath);
      }

      // Navigate using the handler
      if (this.onNavigate) {
        await this.onNavigate(pageData);
      }

      // Handle scroll
      if (scroll) {
        if (url.hash) {
          const element = document.querySelector(url.hash);
          if (element) element.scrollIntoView();
        } else {
          window.scrollTo(0, 0);
        }
      }
    } catch (error) {
      console.error('[Farm.js] Navigation error:', error);
      window.location.href = href; // Fallback
    }
  }

  async prefetch(href) {
    // Prefetching disabled in dev mode to avoid Vite dep optimization issues
    // In production, assets are already bundled and prefetched via link tags
    if (import.meta.env?.DEV) return;
    
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;

    if (this.prefetchingUrls.has(pathname)) return;

    // Find route in manifest
    const match = findRoute(pathname);
    if (!match) return;

    // Only prefetch client components (server components can't be prefetched client-side)
    if (!match.route.isClientComponent) return;

    const modulePath = match.route.modulePath;
    if (this.moduleCache.has(modulePath)) return;

    this.prefetchingUrls.add(pathname);
    try {
      // Prefetch by importing the module (Vite caches it)
      const module = await import(/* @vite-ignore */ modulePath);
      this.moduleCache.set(modulePath, module);
      pageModuleCache.set(modulePath, module);
    } catch (error) {
      // Silently fail for prefetch
    } finally {
      this.prefetchingUrls.delete(pathname);
    }
  }

  observeForPrefetch(element) {
    if (typeof IntersectionObserver === 'undefined') return;
    const href = element.getAttribute('href');
    if (!href || this.isExternalUrl(href)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setTimeout(() => this.prefetch(href), 100);
            observer.unobserve(element);
            this.observers.delete(element);
          }
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(element);
    this.observers.set(element, observer);
  }

  unobserveForPrefetch(element) {
    const observer = this.observers.get(element);
    if (observer) {
      observer.unobserve(element);
      this.observers.delete(element);
    }
  }

  async handlePopState(event) {
    const pathname = window.location.pathname;
    const search = window.location.search;
    
    try {
      // Client-side route matching for back/forward
      const match = findRoute(pathname);
      if (!match) {
        window.location.reload();
        return;
      }

      const { route, params } = match;
      const url = new URL(window.location.href);
      const searchParams = {};
      url.searchParams.forEach((value, key) => {
        searchParams[key] = value;
      });

      const pageData = {
        route: route,
        params,
        searchParams,
        layouts: findLayouts(pathname),
      };

      if (this.onNavigate) await this.onNavigate(pageData);
      this.restoreScrollPosition(pathname);
    } catch (error) {
      console.error('[Farm.js] Popstate error:', error);
      window.location.reload();
    }
  }

  isExternalUrl(href) {
    return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
  }

  saveScrollPosition(path) {
    try {
      sessionStorage.setItem('farm-scroll-' + path, JSON.stringify({ x: window.scrollX, y: window.scrollY }));
    } catch {}
  }

  restoreScrollPosition(path) {
    try {
      const saved = sessionStorage.getItem('farm-scroll-' + path);
      if (saved) {
        const { x, y } = JSON.parse(saved);
        setTimeout(() => window.scrollTo(x, y), 0);
      }
    } catch {}
  }
}

// Initialize the SPA router
const spaRouter = new SPARouter();
window.__FARM_SPA_ROUTER__ = spaRouter;

// Cache for loaded page modules
const pageModuleCache = new Map();

// Current page state for React rendering
let currentPageComponent = null;
let currentPageProps = {};
let appRoot = null;

// Layout component reference (loaded once, reused across navigations)
let LayoutComponent = null;

// Track if we've taken over rendering from SSR
let hasClientTakenOver = false;

// ====== CHUNK-BASED NAVIGATION (TanStack Start pattern) ======
// NO HTML fetching! Uses manifest to dynamically import page chunks
async function renderPage(pageData) {
  const container = document.getElementById('root');
  if (!container) return;

  const { route, params, layouts } = pageData;
  const path = window.location.pathname + window.location.search;

  // Helper to fetch HTML and swap content, then re-hydrate if client component
  const fetchAndSwapHTML = async () => {
    console.log('[Farm.js] Fetching HTML for:', path);
    const response = await fetch(path, { headers: { 'Accept': 'text/html' } });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newRoot = doc.getElementById('root');
    
    if (newRoot) {
      if (appRoot) { try { appRoot.unmount(); } catch(e) {} appRoot = null; }
      if (reactRoot) { try { reactRoot.unmount(); } catch(e) {} reactRoot = null; }
      container.innerHTML = newRoot.innerHTML;
      const newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent || document.title;
      hasClientTakenOver = false;
      
      // After HTML swap, check if this is a client component that needs hydration
      // The server-rendered HTML includes the client entry script that will handle hydration
      // But for SPA navigation, we need to manually trigger re-hydration
      if (route.isClientComponent) {
        // Find the page container and hydrate it
        const pageContainer = document.querySelector('[data-farm-page]') || container;
        if (pageContainer) {
          // Create a new React root for the swapped content
          appRoot = createRoot(pageContainer);
          window.__FARM_REACT_ROOT__ = appRoot;
          
          // The page component will be imported and rendered by the hydrate function
          // We need to trigger hydration - the client script in HTML should handle this
          // But since we swapped HTML, let Vite's HMR or the initial script re-run
        }
      }
      
      console.log('[Farm.js] ⚡ HTML navigated to:', path);
      return true;
    }
    return false;
  };

  try {
    const isDev = import.meta.env?.DEV;
    
    // For server components, always use HTML swap (they need server rendering)
    if (!route.isClientComponent) {
      await fetchAndSwapHTML();
      return;
    }
    
    // For client components in dev mode, try dynamic import first
    // If it fails due to server deps, fall back to full page navigation

    // Get module path from manifest (production only)
    const modulePath = route.modulePath;
    
    // Try to dynamically import the page module
    let pageModule;
    try {
      pageModule = pageModuleCache.get(modulePath);
      if (!pageModule) {
        pageModule = await import(/* @vite-ignore */ modulePath);
        pageModuleCache.set(modulePath, pageModule);
      }
    } catch (importError) {
      // Import failed (e.g., server deps) - fall back to full page navigation
      // This ensures proper hydration of client components
      console.warn('[Farm.js] Module import failed, using full navigation:', importError.message);
      window.location.href = path;
      return;
    }
    
    const PageComponent = pageModule.default;
    if (!PageComponent) {
      throw new Error('Page module has no default export: ' + modulePath);
    }
    
    // This is a client component (we already filtered out server components above)
    // Render directly with React - no HTML fetch needed!
    console.log('[Farm.js] ⚡ Chunk render:', modulePath);
    
    // Update metadata from module
    const metadata = pageModule.metadata;
    if (metadata?.title) document.title = metadata.title;
    if (metadata?.description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', metadata.description);
    }
    
    // Update current page state
    currentPageComponent = PageComponent;
    currentPageProps = { params, searchParams: {} };
    
    // Parse search params
    const url = new URL(window.location.href);
    url.searchParams.forEach((value, key) => {
      currentPageProps.searchParams[key] = value;
    });
    
    // Load layout if needed
    if (!LayoutComponent && layouts.length > 0) {
      try {
        const rootLayout = layouts.find(l => l.pattern === '/');
        if (rootLayout) {
          const layoutModule = await import(/* @vite-ignore */ rootLayout.modulePath);
          LayoutComponent = layoutModule.default;
        }
      } catch (e) {
        console.warn('[Farm.js] Could not load layout:', e);
      }
    }
    
    // Build React tree
    let element;
    const pageElement = React.createElement(PageComponent, currentPageProps);
    
    if (LayoutComponent) {
      element = React.createElement(LayoutComponent, { children: pageElement });
    } else {
      element = pageElement;
    }
    
    // On first SPA navigation, take over from SSR
    if (!hasClientTakenOver) {
      hasClientTakenOver = true;
      if (reactRoot) { try { reactRoot.unmount(); } catch(e) {} reactRoot = null; }
      if (appRoot) { try { appRoot.unmount(); } catch(e) {} appRoot = null; }
      appRoot = createRoot(container);
      window.__FARM_REACT_ROOT__ = appRoot;
    }
    
    if (!appRoot) {
      appRoot = createRoot(container);
      window.__FARM_REACT_ROOT__ = appRoot;
    }
    
    // Render!
    appRoot.render(element);
    console.log('[Farm.js] ⚡ Chunk navigated to:', path);
  } catch (error) {
    console.error('[Farm.js] Render error:', error);
    // Fallback to full navigation
    window.location.href = path;
  }
}

// Set up the navigation handler
spaRouter.setNavigationHandler(renderPage);

async function hydrate() {
  const rootContainer = document.getElementById('root')
  
  if (!rootContainer) {
    console.error('[Farm.js] Root container not found')
    return
  }

  try {
    // Pre-load layout for SPA navigation
    try {
      const layoutModule = await import(/* @vite-ignore */ '/src/app/layout.tsx');
      LayoutComponent = layoutModule.default;
    } catch (e) {
      console.warn('[Farm.js] Could not preload layout:', e);
    }

    // Check if this is a client component (set by SSR)
    const isClientComponent = window.__FARM_IS_CLIENT__ === true;
    const modulePath = window.__FARM_PAGE_MODULE__;
    
    if (!isClientComponent) {
      console.log('[Farm.js] Server component - SPA router ready')
      return
    }

    if (!modulePath) {
      console.error('[Farm.js] No page module path found')
      return
    }

    // Cache the current page module
    const pageModule = await import(/* @vite-ignore */ modulePath)
    pageModuleCache.set(modulePath, pageModule);
    
    // For client components, hydrate into the page-specific container
    const pageContainer = document.getElementById('__farm_page__');
    if (!pageContainer) {
      console.error('[Farm.js] Page container not found')
      return
    }

    const PageComponent = pageModule.default
    if (!PageComponent) {
      console.error('[Farm.js] No default export found in', modulePath)
      return
    }

    currentPageComponent = PageComponent;
    
    // Get props - either from server-injected props or by matching the current URL
    let pageProps = window.__FARM_PROPS__;
    if (!pageProps || !pageProps.params || Object.keys(pageProps.params).length === 0) {
      // Extract params from URL using manifest route matching (fallback)
      const pathname = window.location.pathname;
      const foundRoute = findRoute(pathname);
      const searchParams = {};
      new URLSearchParams(window.location.search).forEach((value, key) => {
        searchParams[key] = value;
      });
      pageProps = {
        params: foundRoute?.params || {},
        searchParams: searchParams,
        path: pathname,
      };
    }
    currentPageProps = pageProps;
    
    // Use hydrateRoot for initial hydration to preserve server-rendered content
    try {
      reactRoot = hydrateRoot(pageContainer, React.createElement(PageComponent, currentPageProps));
      window.__FARM_REACT_ROOT__ = reactRoot;
      console.log('[Farm.js] ✅ Hydrated:', modulePath);
    } catch (error) {
      console.log('[Farm.js] Hydration mismatch, using createRoot');
      reactRoot = createRoot(pageContainer);
      reactRoot.render(React.createElement(PageComponent, currentPageProps));
      window.__FARM_REACT_ROOT__ = reactRoot;
    }
  } catch (error) {
    console.error('[Farm.js] Hydration error:', error)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrate)
} else {
  hydrate()
}

// ====== EVENT DELEGATION FOR LINKS ======
// This catches all link clicks even without React hydration
// This is essential for server component pages where React doesn't hydrate

function isModifierEvent(e) {
  return !!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
}

function isExternalUrl(href) {
  return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
}

document.addEventListener('click', function(event) {
  // Find the closest anchor element
  let target = event.target;
  while (target && target.tagName !== 'A') {
    target = target.parentElement;
  }
  
  if (!target || target.tagName !== 'A') return;
  
  const href = target.getAttribute('href');
  if (!href) return;
  
  // Don't intercept external links
  if (isExternalUrl(href)) return;
  
  // Don't intercept hash-only links
  if (href.startsWith('#')) return;
  
  // Don't intercept if target is set to open in new window
  const linkTarget = target.getAttribute('target');
  if (linkTarget && linkTarget !== '_self') return;
  
  // Don't intercept modifier clicks (Ctrl+Click = new tab)
  if (isModifierEvent(event)) return;
  
  // Don't intercept non-left clicks
  if (event.button !== 0) return;
  
  // Don't intercept if already prevented
  if (event.defaultPrevented) return;
  
  // Use SPA router
  event.preventDefault();
  const replace = target.hasAttribute('data-replace');
  const scroll = !target.hasAttribute('data-no-scroll');
  
  spaRouter.navigate(href, { replace, scroll });
}, true);  // Use capture phase to handle before React

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    console.log('[Farm.js] ⚡ Update detected')
    // Clear module cache on HMR to pick up changes
    pageModuleCache.clear();
  })
}

console.log('[Farm.js] 🌱 SPA Router initialized');
`;
}

function generateServerCode(): string {
  return `
export { FarmApp, createFarmApp } from './app'
export { ServerRenderer } from './server/renderer'
export { RouteManager } from './routing/route-manager'
export * from './types'
`;
}

function generateClientManifest(bundle: any): Record<string, any> {
  const manifest: Record<string, any> = {};

  for (const [fileName, chunk] of Object.entries(bundle)) {
    if ((chunk as any).type === "chunk") {
      manifest[fileName] = {
        id: fileName,
        chunks: [fileName],
        name: (chunk as any).name || fileName,
      };
    }
  }

  return manifest;
}

export async function defineConfig(config: FarmVitePluginOptions = {}) {
  const tailwindcss = (await import("@tailwindcss/vite")).default;

  // Node.js built-in module stubs for browser
  const nodeBuiltinStubs: Record<string, string> = {
    "node:string_decoder":
      "data:text/javascript,export class StringDecoder { write(buf) { return ''; } end() { return ''; } }; export default StringDecoder;",
    "node:buffer":
      "data:text/javascript,export const Buffer = { from: () => ({}), alloc: () => ({}), isBuffer: () => false }; export default { Buffer };",
    "node:stream":
      "data:text/javascript,export class Readable {}; export class Writable {}; export class Transform {}; export default { Readable, Writable, Transform };",
    "node:util":
      "data:text/javascript,export const promisify = (fn) => fn; export const inspect = (obj) => String(obj); export default { promisify, inspect };",
    "node:events":
      "data:text/javascript,export class EventEmitter { on() {} off() {} emit() {} }; export default EventEmitter;",
    "node:path":
      "data:text/javascript,export const join = (...args) => args.join('/'); export const resolve = (...args) => args.join('/'); export default { join, resolve };",
    "node:fs": "data:text/javascript,export default {};",
    "node:url":
      "data:text/javascript,export const URL = globalThis.URL; export const URLSearchParams = globalThis.URLSearchParams; export default { URL, URLSearchParams };",
    "node:crypto":
      "data:text/javascript,export const randomUUID = () => crypto.randomUUID(); export default { randomUUID };",
    "node:os":
      "data:text/javascript,export const platform = () => 'browser'; export const homedir = () => '/'; export default { platform, homedir };",
    "node:child_process": "data:text/javascript,export default {};",
    "node:http": "data:text/javascript,export default {};",
    "node:https": "data:text/javascript,export default {};",
    "node:net": "data:text/javascript,export default {};",
    "node:tls": "data:text/javascript,export default {};",
    "node:zlib": "data:text/javascript,export default {};",
    "node:async_hooks":
      "data:text/javascript,export const AsyncLocalStorage = class {}; export default { AsyncLocalStorage };",
    "node:worker_threads": "data:text/javascript,export default {};",
    "node:perf_hooks":
      "data:text/javascript,export const performance = globalThis.performance; export default { performance };",
    string_decoder:
      "data:text/javascript,export class StringDecoder { write(buf) { return ''; } end() { return ''; } }; export default StringDecoder;",
    buffer:
      "data:text/javascript,export const Buffer = { from: () => ({}), alloc: () => ({}), isBuffer: () => false }; export default { Buffer };",
    stream:
      "data:text/javascript,export class Readable {}; export class Writable {}; export class Transform {}; export default { Readable, Writable, Transform };",
    util: "data:text/javascript,export const promisify = (fn) => fn; export const inspect = (obj) => String(obj); export default { promisify, inspect };",
    events:
      "data:text/javascript,export class EventEmitter { on() {} off() {} emit() {} }; export default EventEmitter;",
    path: "data:text/javascript,export const join = (...args) => args.join('/'); export const resolve = (...args) => args.join('/'); export default { join, resolve };",
    fs: "data:text/javascript,export default {};",
    url: "data:text/javascript,export const URL = globalThis.URL; export const URLSearchParams = globalThis.URLSearchParams; export default { URL, URLSearchParams };",
    crypto:
      "data:text/javascript,export const randomUUID = () => crypto.randomUUID(); export default { randomUUID };",
    os: "data:text/javascript,export const platform = () => 'browser'; export const homedir = () => '/'; export default { platform, homedir };",
    child_process: "data:text/javascript,export default {};",
    http: "data:text/javascript,export default {};",
    https: "data:text/javascript,export default {};",
    net: "data:text/javascript,export default {};",
    tls: "data:text/javascript,export default {};",
    zlib: "data:text/javascript,export default {};",
    async_hooks:
      "data:text/javascript,export const AsyncLocalStorage = class {}; export default { AsyncLocalStorage };",
    worker_threads: "data:text/javascript,export default {};",
    perf_hooks:
      "data:text/javascript,export const performance = globalThis.performance; export default { performance };",
  };

  // Plugin to intercept __vite-browser-external requests
  const viteBrowserExternalPlugin = {
    name: "farm:browser-external-stub",
    enforce: "pre" as const,
    resolveId(id: string) {
      // Handle Vite's browser external markers
      if (id.includes("__vite-browser-external:")) {
        const moduleName = id.replace(/__vite-browser-external:/, "");
        const stub = nodeBuiltinStubs[moduleName];
        if (stub) return stub;
        // Generic stub for unknown node modules
        return "data:text/javascript,export default {};";
      }
      // Handle direct node: imports
      if (id.startsWith("node:")) {
        const stub = nodeBuiltinStubs[id];
        if (stub) return stub;
        return "data:text/javascript,export default {};";
      }
      return null;
    },
  };

  // Custom logger to replace Vite's default logs with Farm.js branding
  const pc = await import("picocolors").then((m) => m.default);
  let serverStarted = false;
  let startTime = Date.now();

  const farmLogger = {
    info: (msg: string) => {
      // Suppress ALL Vite startup messages - we print our own Farm.js branded output
      if (
        msg.includes("VITE") ||
        msg.includes("vite") ||
        msg.includes("ready in") ||
        msg.includes("Local:") ||
        msg.includes("Network:") ||
        msg.includes("➜") ||
        msg.includes("Port") ||
        msg.includes("trying another")
      ) {
        return;
      }
      // Pass through other info messages
      console.log(msg);
    },
    warn: (msg: string) => console.warn(pc.yellow(msg)),
    warnOnce: (msg: string) => console.warn(pc.yellow(msg)),
    error: (msg: string) => console.error(pc.red(msg)),
    clearScreen: () => {},
    hasErrorLogged: () => false,
    hasWarned: false,
  };

  // Plugin to print Farm.js branding after server starts
  const farmBrandingPlugin = {
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
          const hostConfig = server.config.server.host;
          const isExposed = hostConfig === true || hostConfig === "0.0.0.0";

          console.log("");
          console.log(
            `  ${pc.bold(pc.green("Farm.js"))} ${pc.dim("v1.0.0")} ${pc.dim(`ready in ${elapsed}ms`)}`,
          );
          console.log("");
          console.log(
            `  ${pc.dim("➜")}  ${pc.bold("Local:")}   ${pc.cyan(`http://localhost:${resolvedPort}/`)}`,
          );
          if (isExposed) {
            // Get actual network address
            const os = require("os");
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
              for (const iface of interfaces[name] || []) {
                if (iface.family === "IPv4" && !iface.internal) {
                  console.log(
                    `  ${pc.dim("➜")}  ${pc.bold("Network:")} ${pc.cyan(`http://${iface.address}:${resolvedPort}/`)}`,
                  );
                  break;
                }
              }
            }
          } else {
            console.log(
              `  ${pc.dim("➜")}  ${pc.bold("Network:")} ${pc.dim("use --host to expose")}`,
            );
          }
          console.log("");
        }
        return result;
      };
    },
  };

  return {
    plugins: [tailwindcss(), viteBrowserExternalPlugin, farmPlugin(config), farmBrandingPlugin],
    customLogger: farmLogger,
    clearScreen: false,
    optimizeDeps: {
      include: ["react", "react-dom"],
      // Exclude server-side packages from browser bundling
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
      ],
    },
    ssr: {
      noExternal: ["farm", "@farmjs/core"],
      // Externalize React to prevent multiple instances during SSR
      external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    resolve: {
      // Ensure single React instance across all modules (critical for hooks!)
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
      // Stub out problematic server-only modules during dev mode
      alias: {
        // Nitro internals that should not be resolved in browser
        "supports-color":
          "data:text/javascript,export default false; export const supportsColor = false; export const stdout = false; export const stderr = false;",
        "@poppinss/dumper": "data:text/javascript,export default {};",
        "@poppinss/dumper/html":
          "data:text/javascript,export const createScript = () => ''; export const createStyleSheet = () => '';",
        "consola/basic":
          "data:text/javascript,export default { log: console.log, info: console.info, warn: console.warn, error: console.error };",
        youch:
          "data:text/javascript,export default class Youch { toJSON() { return {}; } toHTML() { return ''; } };",
        // Add all node stubs to alias as well
        ...nodeBuiltinStubs,
      },
    },
    define: {
      __FARM_DEV__: JSON.stringify(process.env.NODE_ENV === "development"),
    },
  };
}
