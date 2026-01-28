import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import type { FarmConfig, FarmRequest, FarmResponse, PageProps } from "../types";
import type { RouteManager } from "../routing/route-manager";
import { logger } from "../utils";
import { Writable } from "stream";
import { _runWithMiddlewareData, _clearCurrentMiddlewareData } from "../middleware/server";

export class ServerRenderer {
  private config: Required<FarmConfig>;
  private routeManager: RouteManager;

  constructor(config: Required<FarmConfig>, routeManager: RouteManager) {
    this.config = config;
    this.routeManager = routeManager;
  }

  async renderPage(req: FarmRequest, res: FarmResponse): Promise<void> {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = url.pathname;

      // Match route
      const { route, params, layouts } = this.routeManager.matchRoute(pathname);

      if (!route) {
        await this.render404(req, res);
        return;
      }

      const middlewareData = (req as any).__FARM_MIDDLEWARE_DATA__ || {};
      const middlewareMap = new Map(Object.entries(middlewareData));

      const searchParamsObject: Record<string, string | string[] | undefined> = {};
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
      };

      // Load route module
      const routeModule = await this.routeManager.loadRouteModule(route.modulePath);

      if (!routeModule.default) {
        throw new Error(`Route module ${route.modulePath} does not export a default component`);
      }

      // Check if this is a client component by reading the file content
      let isClientComponent = false;
      try {
        const fs = await import("fs");
        const content = fs.readFileSync(route.modulePath, "utf-8");
        isClientComponent =
          content.trimStart().startsWith("'use client'") ||
          content.trimStart().startsWith('"use client"');
      } catch (error) {
        isClientComponent = false;
      }

      (req as any).__FARM_PAGE_PATH__ = route.modulePath;
      (req as any).__FARM_ROUTE__ = pathname;
      (req as any).__FARM_IS_CLIENT_COMPONENT__ = isClientComponent;

      // Load layout modules
      const layoutModules = await Promise.all(
        layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath)),
      );

      // Collect metadata from layouts and page (page metadata overrides layout metadata)
      let mergedMetadata: Record<string, any> = {};

      // First, collect metadata from layouts (in order, so nested layouts can override)
      for (const layoutModule of layoutModules) {
        if (layoutModule.metadata) {
          mergedMetadata = { ...mergedMetadata, ...layoutModule.metadata };
        }
      }

      // Then, page metadata overrides everything
      if (routeModule.metadata) {
        mergedMetadata = { ...mergedMetadata, ...routeModule.metadata };
      }

      // Store metadata on request for renderWithSSR
      (req as any).__FARM_METADATA__ = mergedMetadata;

      // Get middleware data for AsyncLocalStorage
      const middlewareDataForContext = (req as any).__FARM_MIDDLEWARE_DATA__ || {};

      await _runWithMiddlewareData(middlewareDataForContext, async () => {
        const PageComponent = routeModule.default;
        const pageElement = React.createElement(PageComponent, pageProps);

        let wrappedElement: React.ReactElement = pageElement;
        for (let i = layoutModules.length - 1; i >= 0; i--) {
          const layoutModule = layoutModules[i];
          const LayoutComponent = layoutModule.default;
          wrappedElement = React.createElement(LayoutComponent, {
            children: wrappedElement,
            params,
          } as any);
        }

        // Render with middleware data available
        await this.renderWithSSR(wrappedElement, req, res, _clearCurrentMiddlewareData);
      });
    } catch (error) {
      logger.error(`Error rendering page: ${error}`);
      await this.render500(req, res, error);
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

      // Inject page props and component info for client-side hydration
      // __FARM_IS_CLIENT__ tells the client code whether to hydrate
      // __FARM_PAGE_MODULE__ is the module path for dynamic import
      const propsScript = `<script>
window.__FARM_PROPS__ = ${JSON.stringify((req as any).__FARM_PROPS__ || {})};
window.__FARM_PATH__ = ${JSON.stringify((req as any).__FARM_ROUTE__ || req.url || "/")};
window.__FARM_IS_CLIENT__ = ${JSON.stringify(isClientComponent)};
window.__FARM_PAGE_MODULE__ = ${JSON.stringify(relativePath)};
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
              // Close the root div and conditionally add client hydration script
              const isClientComponent = (req as any).__FARM_IS_CLIENT_COMPONENT__;
              const clientScript = isClientComponent
                ? `  <script type="module" src="/@farm/client.js"></script>`
                : "";

              res.write(`</div>
${clientScript}
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

    const html = this.createFullHTML("<h1>404 - Page Not Found</h1>");
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
