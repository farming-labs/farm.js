import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import type { FarmConfig, FarmRequest, FarmResponse, PageProps } from '../types';
import type { RouteManager } from '../routing/route-manager';
import { logger } from '../utils';
import { Writable } from 'stream';

export class ServerRenderer {
  private config: Required<FarmConfig>;
  private routeManager: RouteManager;

  constructor(config: Required<FarmConfig>, routeManager: RouteManager) {
    this.config = config;
    this.routeManager = routeManager;
  }

  async renderPage(req: FarmRequest, res: FarmResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      // Match route
      const { route, params, layouts } = this.routeManager.matchRoute(pathname);

      if (!route) {
        await this.render404(req, res);
        return;
      }

      // Parse search params
      const searchParams: Record<string, string | string[]> = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (key in searchParams) {
          const existing = searchParams[key];
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            searchParams[key] = [existing, value];
          }
        } else {
          searchParams[key] = value;
        }
      }
      // Create page props
      const pageProps: PageProps = {
        params,
        searchParams,
        path: pathname,
      };

      // Load route module
      const routeModule = await this.routeManager.loadRouteModule(route.modulePath);

      if (!routeModule.default) {
        throw new Error(`Route module ${route.modulePath} does not export a default component`);
      }

      // Check if this is a client component by reading the file content
      let isClientComponent = false;
      try {
        const fs = await import('fs');
        const content = fs.readFileSync(route.modulePath, 'utf-8');
        isClientComponent = content.trimStart().startsWith("'use client'") || content.trimStart().startsWith('"use client"');
      } catch (error) {
        isClientComponent = false;
      }

      (req as any).__FARM_PAGE_PATH__ = route.modulePath;
      (req as any).__FARM_ROUTE__ = pathname;
      (req as any).__FARM_IS_CLIENT_COMPONENT__ = isClientComponent;

      // Load layout modules
      const layoutModules = await Promise.all(
        layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath))
      );

      // Create component tree
      const PageComponent = routeModule.default;
      const pageElement = React.createElement(PageComponent, pageProps);

      // Wrap with layouts (innermost to outermost)
      let wrappedElement: React.ReactElement = pageElement;
      for (let i = layoutModules.length - 1; i >= 0; i--) {
        const layoutModule = layoutModules[i];
        const LayoutComponent = layoutModule.default;
        wrappedElement = React.createElement(LayoutComponent, {
          children: wrappedElement,
          params,
        } as any);
      }
      await this.renderWithSSR(wrappedElement, req, res);
    } catch (error) {
      logger.error(`Error rendering page: ${error}`);
      await this.render500(req, res, error);
    }
  }

  private async renderWithSSR(
    element: React.ReactElement,
    req: FarmRequest,
    res: FarmResponse
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      const htmlParts: string[] = [];
      let didError = false;

      // Get the page path for client-side hydration
      const pagePath = (req as any).__FARM_PAGE_PATH__;
      const relativePath = pagePath ? pagePath.substring(pagePath.indexOf('/src/app/')) : '/src/app/page.tsx';

      // Inject page props and component path for client-side hydration
      const propsScript = `<script>
window.__FARM_PROPS__ = ${JSON.stringify((req as any).__FARM_PROPS__ || {})};
window.__FARM_PATH__ = ${JSON.stringify((req as any).__FARM_ROUTE__ || req.url || '/')};
window.__FARM_PAGE_PATH__ = ${JSON.stringify(relativePath)};
</script>`;

      const { pipe, abort } = renderToPipeableStream(element, {
        onShellReady() {
          // Send HTML opening tags
          res.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farm.js App</title>
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
              const clientScript = isClientComponent ? 
                `  <script type="module" src="/@farm/client.js"></script>` : '';
              
              res.write(`</div>
${clientScript}
</body>
</html>`);
              res.end();
              callback();
              resolve();
            },
          });

          pipe(writableStream);
        },
        onShellError(error) {
          didError = true;
          logger.error(`SSR shell error: ${error}`);
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

    const html = this.createFullHTML('<h1>404 - Page Not Found</h1>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.write(html);
    res.end();
  }

  private async render500(req: FarmRequest, res: FarmResponse, error: any): Promise<void> {
    res.statusCode = 500;

    const isDev = process.env.NODE_ENV === 'development';
    const errorMessage = isDev ? error.stack || error.message : 'Internal Server Error';

    const html = this.createFullHTML(`
      <h1>500 - Internal Server Error</h1>
      ${isDev ? `<pre>${errorMessage}</pre>` : ''}
    `);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.write(html);
    res.end();
  }

  private createFullHTML(content: string, isClientComponent: boolean = false): string {
    const clientScript = isClientComponent ? 
      `  <script type="module" src="/@farm/client.js"></script>` : '';
    
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
