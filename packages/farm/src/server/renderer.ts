import React from 'react'
import { renderToString } from 'react-dom/server'
import type { FarmConfig, FarmRequest, FarmResponse, PageProps } from '../types'
import type { RouteManager } from '../routing/route-manager'
import { logger } from '../utils'

export class ServerRenderer {
  private config: Required<FarmConfig>
  private routeManager: RouteManager

  constructor(config: Required<FarmConfig>, routeManager: RouteManager) {
    this.config = config
    this.routeManager = routeManager
  }

  async renderPage(req: FarmRequest, res: FarmResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      const pathname = url.pathname
      
      // Match route
      const { route, params, layouts } = this.routeManager.matchRoute(pathname)
      
      if (!route) {
        await this.render404(req, res)
        return
      }

      // Parse search params
      const searchParams: Record<string, string | string[]> = {}
      for (const [key, value] of url.searchParams.entries()) {
        if (key in searchParams) {
          const existing = searchParams[key]
          if (Array.isArray(existing)) {
            existing.push(value)
          } else {
            searchParams[key] = [existing, value]
          }
        } else {
          searchParams[key] = value
        }
      }
      // Create page props
      const pageProps: PageProps = {
        params,
        searchParams,
        path: pathname
      }

      // Load route module
      const routeModule = await this.routeManager.loadRouteModule(route.modulePath)
      
      if (!routeModule.default) {
        throw new Error(`Route module ${route.modulePath} does not export a default component`)
      }

      // Load layout modules
      const layoutModules = await Promise.all(
        layouts.map(layout => this.routeManager.loadLayoutModule(layout.modulePath))
      )

      // Create component tree
      const PageComponent = routeModule.default
      const pageElement = React.createElement(PageComponent, pageProps)

      // Wrap with layouts (innermost to outermost)
      let wrappedElement: React.ReactElement = pageElement
      for (let i = layoutModules.length - 1; i >= 0; i--) {
        const layoutModule = layoutModules[i]
        const LayoutComponent = layoutModule.default
        wrappedElement = React.createElement(LayoutComponent, { 
          children: wrappedElement, 
          params 
        } as any)
      }
      await this.renderWithSSR(wrappedElement, req, res)

    } catch (error) {
      logger.error(`Error rendering page: ${error}`)
      await this.render500(req, res, error)
    }
  }

  private async renderWithSSR(element: React.ReactElement, req: FarmRequest, res: FarmResponse): Promise<void> {
    try {
      const html = renderToString(element)
      const fullHTML = this.createFullHTML(html)
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.write(fullHTML)
      res.end()

    } catch (error) {
      logger.error(`SSR rendering error: ${error}`)
      throw error
    }
  }

  private async render404(req: FarmRequest, res: FarmResponse): Promise<void> {
    res.statusCode = 404
    
    const html = this.createFullHTML('<h1>404 - Page Not Found</h1>')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.write(html)
    res.end()
  }

  private async render500(req: FarmRequest, res: FarmResponse, error: any): Promise<void> {
    res.statusCode = 500
    
    const isDev = process.env.NODE_ENV === 'development'
    const errorMessage = isDev ? error.stack || error.message : 'Internal Server Error'
    
    const html = this.createFullHTML(`
      <h1>500 - Internal Server Error</h1>
      ${isDev ? `<pre>${errorMessage}</pre>` : ''}
    `)
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.write(html)
    res.end()
  }

  private createFullHTML(content: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farm.js App</title>
</head>
<body>
  <div id="root">${content}</div>
  <script type="module" src="/@farm/client.js"></script>
</body>
</html>`
  }
}

