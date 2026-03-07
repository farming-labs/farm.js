import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";
import type { FarmConfig, FarmRequest, FarmResponse, PageProps, SSGPage } from "../types";
import type { RouteManager } from "../routing/route-manager";
import { logger } from "../utils";
import { Writable } from "stream";
import { _runWithMiddlewareData, _clearCurrentMiddlewareData } from "../middleware/server";
import { getRequestContextSnapshot } from "../request-context";
import { isSSGModule, matchSSGPage } from "../ssg";

function toMiddlewareMap(input: unknown): Map<string, any> {
  if (input instanceof Map) {
    return new Map(input as Map<string, any>);
  }
  if (input && typeof input === "object") {
    return new Map(Object.entries(input as Record<string, any>));
  }
  return new Map<string, any>();
}

class FarmRouteErrorBoundary extends React.Component<
  {
    Fallback: React.ComponentType<any>;
    fallbackProps: Record<string, any>;
    children: React.ReactNode;
  },
  { hasError: boolean; error: unknown }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.Fallback;
      return React.createElement(Fallback, {
        ...this.props.fallbackProps,
        error: this.state.error,
        reset: () => this.setState({ hasError: false, error: null }),
      });
    }
    return this.props.children as React.ReactElement;
  }
}

export class ServerRenderer {
  private config: Required<FarmConfig>;
  private routeManager: RouteManager;
  private ssgManifest: SSGPage[] = [];
  private ssgCache: Map<string, { html: string; timestamp: number }> = new Map();

  constructor(config: Required<FarmConfig>, routeManager: RouteManager) {
    this.config = config;
    this.routeManager = routeManager;
    this.loadSSGManifest();
  }

  /**
   * Load SSG manifest from build output
   */
  private loadSSGManifest(): void {
    try {
      const manifestPath = path.join(this.config.root, this.config.outDir, "__ssg_manifest.json");
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, "utf-8");
        this.ssgManifest = JSON.parse(content);
        logger.info(`Loaded SSG manifest: ${this.ssgManifest.length} pages`);
      }
    } catch (error) {
      // No manifest in dev mode or first build
    }
  }

  /**
   * Check if a path should be served from SSG cache
   */
  private shouldServeSSG(pathname: string): SSGPage | null {
    const ssgPage = matchSSGPage(pathname, this.ssgManifest);
    if (!ssgPage) return null;

    // Check ISR revalidation
    if (ssgPage.revalidate) {
      const cached = this.ssgCache.get(pathname);
      if (cached) {
        const age = (Date.now() - cached.timestamp) / 1000;
        if (age > ssgPage.revalidate) {
          // Stale - needs revalidation (serve stale, regenerate in background)
          this.regenerateSSGPage(ssgPage);
        }
      }
    }

    return ssgPage;
  }

  /**
   * Regenerate an SSG page in the background (ISR)
   */
  private async regenerateSSGPage(page: SSGPage): Promise<void> {
    try {
      // This runs in the background - don't await
      setImmediate(async () => {
        try {
          const mod = await this.routeManager.loadRouteModule(page.filePath);
          if (!mod?.default) return;

          const { layouts } = this.routeManager.matchRoute(page.urlPath);
          const layoutModules = await Promise.all(
            layouts.map((l) => this.routeManager.loadLayoutModule(l.modulePath)),
          );

          const PageComponent = mod.default;
          const pageProps = {
            params: page.params,
            searchParams: Promise.resolve({}),
            path: page.urlPath,
          };

          let pageElement = React.createElement(
            PageComponent as React.ComponentType<unknown>,
            pageProps as React.Attributes,
          );

          for (let i = layoutModules.length - 1; i >= 0; i--) {
            const layoutModule = layoutModules[i];
            const LayoutComponent = layoutModule.default;
            pageElement = React.createElement(
              LayoutComponent as React.ComponentType<unknown>,
              {
                children: pageElement,
                params: page.params,
              } as React.Attributes,
            );
          }

          const { renderToString } = await import("react-dom/server");
          const html = renderToString(pageElement);

          // Update cache
          this.ssgCache.set(page.urlPath, { html, timestamp: Date.now() });

          logger.info(`ISR: Regenerated ${page.urlPath}`);
        } catch (error) {
          logger.error(`ISR regeneration failed for ${page.urlPath}: ${error}`);
        }
      });
    } catch (error) {
      logger.error(`ISR trigger failed: ${error}`);
    }
  }

  /**
   * Serve a pre-rendered SSG page
   */
  private async serveSSGPage(req: FarmRequest, res: FarmResponse, page: SSGPage): Promise<boolean> {
    // Check cache first (for ISR)
    const cached = this.ssgCache.get(page.urlPath);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Farm-SSG", "cached");
      if (page.revalidate) {
        res.setHeader("Cache-Control", `s-maxage=${page.revalidate}, stale-while-revalidate`);
      }
      res.write(this.createFullHTML(cached.html));
      res.end();
      return true;
    }

    // Try to read from file system (production)
    try {
      const htmlPath =
        page.urlPath === "/"
          ? path.join(this.config.root, this.config.outDir, "client", "index.html")
          : path.join(this.config.root, this.config.outDir, "client", page.urlPath + ".html");

      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, "utf-8");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Farm-SSG", "file");
        if (page.revalidate) {
          res.setHeader("Cache-Control", `s-maxage=${page.revalidate}, stale-while-revalidate`);
        }
        res.write(html);
        res.end();
        return true;
      }
    } catch (error) {
      logger.error(`Failed to serve SSG page ${page.urlPath}: ${error}`);
    }

    return false;
  }

  async renderPage(req: FarmRequest, res: FarmResponse): Promise<void> {
    let pathname = "/";
    let params: Record<string, string> = {};
    let layouts: Array<{ modulePath: string }> = [];
    let searchParamsObject: Record<string, string | string[] | undefined> = {};
    let middlewareMap = new Map<string, any>();
    let pluginExposedContext = new Map<string, any>();
    let errorBoundaryEntry: { modulePath: string } | null = null;

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      pathname = url.pathname;

      // Check for pre-rendered SSG page first (production only)
      if (process.env.NODE_ENV === "production") {
        const ssgPage = this.shouldServeSSG(pathname);
        if (ssgPage) {
          const served = await this.serveSSGPage(req, res, ssgPage);
          if (served) return;
        }
      }

      // Match route
      const match = this.routeManager.matchRoute(pathname);
      const route = match.route;
      params = match.params;
      layouts = match.layouts;

      if (!route) {
        await this.render404(req, res);
        return;
      }

      const loadingBoundaryEntry = this.routeManager.getMatchingLoading(pathname);
      errorBoundaryEntry = this.routeManager.getMatchingError(pathname);

      middlewareMap = toMiddlewareMap((req as any).__FARM_MIDDLEWARE_DATA__);
      pluginExposedContext = getRequestContextSnapshot(req as object, { exposedOnly: true });

      searchParamsObject = {};
      url.searchParams.forEach((value, key) => {
        const existing = searchParamsObject[key];
        if (existing) {
          // If key already exists, convert to array
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            searchParamsObject[key] = [existing, value];
          }
        } else {
          searchParamsObject[key] = value;
        }
      });

      // Create page props with searchParams as plain object and middleware data
      const pageProps: PageProps = {
        params,
        searchParams: Promise.resolve(searchParamsObject),
        path: pathname,
        middleware: middlewareMap.size > 0 ? { data: middlewareMap } : undefined,
        context: pluginExposedContext.size > 0 ? { data: pluginExposedContext } : undefined,
      };

      // Load route module
      const routeModule = await this.routeManager.loadRouteModule(route.modulePath);

      if (!routeModule.default) {
        throw new Error(`Route module ${route.modulePath} does not export a default component`);
      }

      let LoadingFallbackComponent: React.ComponentType<any> | null = null;
      if (loadingBoundaryEntry) {
        const loadingModule = await this.routeManager.loadRouteModule(loadingBoundaryEntry.modulePath);
        if (loadingModule.default) {
          LoadingFallbackComponent = loadingModule.default;
        }
      }

      let ErrorFallbackComponent: React.ComponentType<any> | null = null;
      if (errorBoundaryEntry) {
        const errorModule = await this.routeManager.loadRouteModule(errorBoundaryEntry.modulePath);
        if (errorModule.default) {
          ErrorFallbackComponent = errorModule.default;
        }
      }

      let isClientComponent = false;
      const serverComponentsEnabled = this.config.experimental?.serverComponents !== false;
      if (serverComponentsEnabled) {
        try {
          const fs = await import("fs");
          const content = fs.readFileSync(route.modulePath, "utf-8");
          isClientComponent =
            content.trimStart().startsWith("'use client'") ||
            content.trimStart().startsWith('"use client"');
        } catch (error) {
          isClientComponent = false;
        }
      }

      (req as any).__FARM_PAGE_PATH__ = route.modulePath;
      (req as any).__FARM_ROUTE__ = pathname;
      (req as any).__FARM_IS_CLIENT_COMPONENT__ = isClientComponent;
      // Store pageProps for client-side hydration (serializable version - no Promises)
      (req as any).__FARM_PROPS__ = {
        params,
        searchParams: searchParamsObject,
        path: pathname,
        middleware:
          middlewareMap.size > 0
            ? {
                data: Object.fromEntries(middlewareMap),
              }
            : undefined,
        context:
          pluginExposedContext.size > 0
            ? {
                data: Object.fromEntries(pluginExposedContext),
              }
            : undefined,
      };

      // Load layout modules
      const layoutModules = await Promise.all(
        layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath)),
      );

      // Collect metadata from layouts and page (page metadata overrides layout metadata)
      let mergedMetadata: Record<string, any> = {};

      // First, collect metadata from layouts (in order, so nested layouts can override)
      for (const layoutModule of layoutModules) {
        if ((layoutModule as any).metadata) {
          mergedMetadata = { ...mergedMetadata, ...(layoutModule as any).metadata };
        }
      }

      // Then, page metadata overrides everything
      if ((routeModule as any).metadata) {
        mergedMetadata = { ...mergedMetadata, ...(routeModule as any).metadata };
      }

      // Store metadata on request for renderWithSSR
      (req as any).__FARM_METADATA__ = mergedMetadata;

      // Get middleware data for AsyncLocalStorage
      const middlewareDataForContext = middlewareMap;

      await _runWithMiddlewareData(middlewareDataForContext, async () => {
        const PageComponent = routeModule.default!;
        let pageElement = React.createElement(
          PageComponent as React.ComponentType<unknown>,
          pageProps as React.Attributes,
        );

        if (LoadingFallbackComponent) {
          const loadingFallback = React.createElement(LoadingFallbackComponent, {
            params,
            path: pathname,
          } as React.Attributes);

          pageElement = React.createElement(
            React.Suspense,
            { fallback: loadingFallback },
            pageElement,
          );
        }

        // For client components, wrap in a container div for targeted hydration
        if (isClientComponent) {
          pageElement = React.createElement(
            "div",
            { id: "__farm_page__", "data-farm-client": "true" },
            pageElement,
          );
        }

        let wrappedElement: React.ReactElement = pageElement;
        for (let i = layoutModules.length - 1; i >= 0; i--) {
          const layoutModule = layoutModules[i];
          const LayoutComponent = layoutModule.default;
          wrappedElement = React.createElement(
            LayoutComponent as React.ComponentType<unknown>,
            {
              children: wrappedElement,
              params,
            } as React.Attributes,
          );
        }

        if (ErrorFallbackComponent) {
          wrappedElement = React.createElement(
            FarmRouteErrorBoundary,
            {
              Fallback: ErrorFallbackComponent,
              fallbackProps: {
                params,
                path: pathname,
                searchParams: Promise.resolve(searchParamsObject),
                middleware: middlewareMap.size > 0 ? { data: middlewareMap } : undefined,
                context: pluginExposedContext.size > 0 ? { data: pluginExposedContext } : undefined,
              },
            },
            wrappedElement,
          );
        }

        // Render with middleware data available
        await this.renderWithSSR(wrappedElement, req, res, _clearCurrentMiddlewareData);
      });
    } catch (error) {
      logger.error(`Error rendering page: ${error}`);

      if (errorBoundaryEntry) {
        const rendered = await this.renderRouteErrorBoundary(req, res, {
          pathname,
          params,
          layouts,
          searchParamsObject,
          middlewareMap,
          pluginExposedContext,
          error,
          errorModulePath: errorBoundaryEntry.modulePath,
        });

        if (rendered) {
          return;
        }
      }

      await this.render500(req, res, error);
    }
  }

  private async renderRouteErrorBoundary(
    req: FarmRequest,
    res: FarmResponse,
    options: {
      pathname: string;
      params: Record<string, string>;
      layouts: Array<{ modulePath: string }>;
      searchParamsObject: Record<string, string | string[] | undefined>;
      middlewareMap: Map<string, any>;
      pluginExposedContext: Map<string, any>;
      error: unknown;
      errorModulePath: string;
    },
  ): Promise<boolean> {
    try {
      const errorModule = await this.routeManager.loadRouteModule(options.errorModulePath);
      if (!errorModule.default) {
        return false;
      }

      const ErrorComponent = errorModule.default as React.ComponentType<unknown>;
      const errorElement = React.createElement(
        ErrorComponent,
        {
          error: options.error,
          params: options.params,
          path: options.pathname,
          searchParams: Promise.resolve(options.searchParamsObject),
          middleware:
            options.middlewareMap.size > 0 ? { data: options.middlewareMap } : undefined,
          context:
            options.pluginExposedContext.size > 0
              ? { data: options.pluginExposedContext }
              : undefined,
          reset: () => {},
        } as React.Attributes,
      );

      let wrapped: React.ReactElement = errorElement;
      const layoutModules = await Promise.all(
        options.layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath)),
      );
      for (let i = layoutModules.length - 1; i >= 0; i--) {
        const LayoutComponent = layoutModules[i].default;
        wrapped = React.createElement(
          LayoutComponent as React.ComponentType<unknown>,
          {
            children: wrapped,
            params: options.params,
          } as React.Attributes,
        );
      }

      const ReactDOMServer = await import("react-dom/server");
      const html = ReactDOMServer.renderToString(wrapped);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.write(this.createFullHTML(html));
      res.end();
      return true;
    } catch (renderError) {
      logger.warn(`Failed to render route-level error boundary: ${renderError}`);
      return false;
    }
  }

  private async renderWithSSR(
    element: React.ReactElement,
    req: FarmRequest,
    res: FarmResponse,
    clearMiddlewareData?: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      const htmlParts: string[] = [];
      let didError = false;

      // Get the page path for client-side hydration
      const pagePath = (req as any).__FARM_PAGE_PATH__;
      const isClientComponent = (req as any).__FARM_IS_CLIENT_COMPONENT__ === true;
      const relativePath = pagePath
        ? pagePath.substring(pagePath.indexOf("/src/app/"))
        : "/src/app/page.tsx";

      // Generate manifest for client-side SPA navigation (TanStack Start pattern)
      // This manifest is inlined in HTML - no separate file or API endpoint
      const manifest = this.routeManager.generateClientManifest(this.config.root);

      // Convert to object format for client
      const clientManifest = {
        clientEntry: "/@farm/client.js",
        routes: {} as Record<string, any>,
        layouts: {} as Record<string, any>,
        sharedAssets: [{ tag: "link", attrs: { rel: "stylesheet", href: "/src/app/globals.css" } }],
      };

      // Convert routes array to object keyed by pattern
      const serverComponentsEnabled = this.config.experimental?.serverComponents !== false;
      for (const routeEntry of manifest.routes) {
        let isClient = false;
        if (serverComponentsEnabled) {
          try {
            const absolutePath = routeEntry.modulePath.startsWith("/")
              ? this.config.root + routeEntry.modulePath
              : routeEntry.modulePath;
            const content = fs.readFileSync(absolutePath, "utf-8");
            isClient =
              content.trimStart().startsWith("'use client'") ||
              content.trimStart().startsWith('"use client"');
          } catch {
            isClient = false;
          }
        }

        clientManifest.routes[routeEntry.pattern] = {
          modulePath: routeEntry.modulePath,
          pattern: routeEntry.pattern,
          segments: routeEntry.segments,
          isClientComponent: isClient,
          preloads: [routeEntry.modulePath],
          assets: [],
        };
      }

      // Convert layouts array to object
      for (const layoutEntry of manifest.layouts) {
        clientManifest.layouts[layoutEntry.pattern] = {
          modulePath: layoutEntry.modulePath,
          pattern: layoutEntry.pattern,
          preloads: [layoutEntry.modulePath],
          assets: [],
        };
      }

      // Inject page props, component info, and MANIFEST for client-side SPA
      // __FARM_MANIFEST__ contains the full route manifest (TanStack Start pattern)
      const propsScript = `<script>
window.__FARM_PROPS__ = ${JSON.stringify((req as any).__FARM_PROPS__ || {})};
window.__FARM_PATH__ = ${JSON.stringify((req as any).__FARM_ROUTE__ || req.url || "/")};
window.__FARM_IS_CLIENT__ = ${JSON.stringify(isClientComponent)};
window.__FARM_PAGE_MODULE__ = ${JSON.stringify(relativePath)};
window.__FARM_MANIFEST__ = ${JSON.stringify(clientManifest)};
</script>`;

      // Get metadata from request
      const metadata = (req as any).__FARM_METADATA__ || {};
      const title = metadata.title || "Farm.js App";
      const description = metadata.description || "";

      // Build meta tags
      let metaTags = "";
      if (description) {
        metaTags += `\n  <meta name="description" content="${description.replace(/"/g, "&quot;")}">`;
      }
      if (metadata.keywords) {
        const keywords = Array.isArray(metadata.keywords)
          ? metadata.keywords.join(", ")
          : metadata.keywords;
        metaTags += `\n  <meta name="keywords" content="${keywords.replace(/"/g, "&quot;")}">`;
      }
      if (metadata.author) {
        metaTags += `\n  <meta name="author" content="${metadata.author.replace(/"/g, "&quot;")}">`;
      }
      // Open Graph tags
      if (metadata.openGraph) {
        const og = metadata.openGraph;
        if (og.title)
          metaTags += `\n  <meta property="og:title" content="${og.title.replace(/"/g, "&quot;")}">`;
        if (og.description)
          metaTags += `\n  <meta property="og:description" content="${og.description.replace(/"/g, "&quot;")}">`;
        if (og.image)
          metaTags += `\n  <meta property="og:image" content="${og.image.replace(/"/g, "&quot;")}">`;
        if (og.url)
          metaTags += `\n  <meta property="og:url" content="${og.url.replace(/"/g, "&quot;")}">`;
        if (og.type)
          metaTags += `\n  <meta property="og:type" content="${og.type.replace(/"/g, "&quot;")}">`;
      }

      const { pipe, abort } = renderToPipeableStream(element, {
        onShellReady() {
          // Send HTML opening tags
          res.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>${metaTags}
  <link rel="stylesheet" href="/src/app/globals.css" />
  <script type="module" src="/@vite/client"></script>
  ${propsScript}
</head>
<body class="">
  <div id="root">`);

          // Pipe the React content
          const writableStream = new Writable({
            write(chunk, encoding, callback) {
              res.write(chunk, encoding);
              callback();
            },
            final(callback) {
              // Close the root div and ALWAYS add client script for SPA navigation
              // The client script contains the SPA router that handles Link clicks
              // For client components, it also handles hydration
              res.write(`</div>
  <script type="module" src="/@farm/client.js"></script>
</body>
</html>`);
              res.end();
              callback();

              // Clear middleware data AFTER rendering completes
              if (clearMiddlewareData) {
                clearMiddlewareData();
              }

              resolve();
            },
          });

          pipe(writableStream);
        },
        onShellError(error) {
          didError = true;
          logger.error(`SSR shell error: ${error}`);

          if (clearMiddlewareData) {
            clearMiddlewareData();
          }

          reject(error);
        },
        onError(error) {
          didError = true;
          logger.error(`SSR streaming error: ${error}`);
        },
      });
    });
  }

  private async render404(req: FarmRequest, res: FarmResponse): Promise<void> {
    res.statusCode = 404;

    const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;

    try {
      // Look for custom not-found page
      const appDir = path.join(this.config.root, this.config.srcDir, "app");
      const notFoundExtensions = [".tsx", ".jsx", ".ts", ".js"];
      let notFoundPath: string | null = null;

      for (const ext of notFoundExtensions) {
        const checkPath = path.join(appDir, `not-found${ext}`);
        if (fs.existsSync(checkPath)) {
          notFoundPath = checkPath;
          break;
        }
      }

      if (notFoundPath) {
        // Use routeManager to load the module (uses Vite's ssrLoadModule in dev)
        const notFoundModule = await this.routeManager.loadRouteModule(notFoundPath);
        const NotFoundComponent = notFoundModule.default;

        if (NotFoundComponent) {
          // Look for root layout
          let LayoutComponent: React.ComponentType<unknown> | null = null;
          for (const ext of notFoundExtensions) {
            const layoutPath = path.join(appDir, `layout${ext}`);
            if (fs.existsSync(layoutPath)) {
              try {
                const layoutModule = await this.routeManager.loadLayoutModule(layoutPath);
                LayoutComponent = layoutModule.default as React.ComponentType<unknown>;
              } catch {
                // Layout import failed, continue without it
              }
              break;
            }
          }

          // Render the 404 page
          let element = React.createElement(
            NotFoundComponent as React.ComponentType<unknown>,
            { pathname } as React.Attributes,
          );

          // Wrap with layout if available
          if (LayoutComponent) {
            element = React.createElement(
              LayoutComponent as React.ComponentType<unknown>,
              { children: element } as React.Attributes,
            );
          }

          // Render to string
          const ReactDOMServer = await import("react-dom/server");
          const content = ReactDOMServer.renderToString(element);

          const html = this.createFullHTML(content);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.write(html);
          res.end();
          return;
        }
      }
    } catch (error) {
      logger.warn(`Failed to render custom 404 page: ${error}`);
    }

    // Fallback to default styled 404 page
    const defaultContent = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:20px;text-align:center;">
        <div style="background:white;border-radius:12px;padding:48px;box-shadow:0 4px 6px rgba(0,0,0,0.1);max-width:500px;width:100%;">
          <h1 style="font-size:96px;font-weight:bold;color:#22c55e;margin:0 0 16px;line-height:1;">404</h1>
          <h2 style="font-size:24px;font-weight:600;color:#1f2937;margin:0 0 16px;">Page Not Found</h2>
          <p style="font-size:16px;color:#6b7280;margin:0 0 24px;">
            The page <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${pathname}</code> doesn't exist.
          </p>
          <a href="/" style="display:inline-block;background:#22c55e;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;">Go Home</a>
        </div>
        <p style="margin-top:24px;font-size:14px;color:#9ca3af;">Powered by Farm.js</p>
      </div>
    `;

    const html = this.createFullHTML(defaultContent);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.write(html);
    res.end();
  }

  private async render500(req: FarmRequest, res: FarmResponse, error: any): Promise<void> {
    res.statusCode = 500;

    const isDev = process.env.NODE_ENV === "development";
    const errorMessage = isDev ? error.stack || error.message : "Internal Server Error";

    const html = this.createFullHTML(`
      <h1>500 - Internal Server Error</h1>
      ${isDev ? `<pre>${errorMessage}</pre>` : ""}
    `);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.write(html);
    res.end();
  }

  private createFullHTML(content: string, isClientComponent = false): string {
    const clientScript = isClientComponent
      ? `  <script type="module" src="/@farm/client.js"></script>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farm.js App</title>
  <link rel="stylesheet" href="/src/app/globals.css" />
  <script type="module" src="/@vite/client"></script>
</head>
<body class="">
  <div id="root">${content}</div>
${clientScript}
</body>
</html>`;
  }
}
