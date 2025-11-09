import type { Plugin, ViteDevServer, HmrContext } from 'vite';
import type { FarmConfig } from './types';
import { FarmApp } from './app';
import { logger } from './utils';
import { defaultGlobalCSS } from './default-styles';
import type { PluginManager } from './plugin';
import { HMRManager } from './hmr';
import { APIRouteManager } from './api/route-manager';
import { OpenAPIManager } from './openapi/manager';
import { MiddlewareManager } from './middleware/manager';
import * as fs from 'fs';
import * as path from 'path';
import type { FarmUserConfig } from './config';

interface FarmVitePluginOptions extends FarmConfig {
  openapi?: FarmUserConfig['openapi'];
}

export function farmPlugin(
  options: FarmVitePluginOptions = {},
  initialPluginManager?: PluginManager
): Plugin {
  let farmApp: FarmApp;
  let server: ViteDevServer;
  let hmrManager: HMRManager;
  let apiRouteManager: APIRouteManager;
  let openAPIManager: OpenAPIManager | null = null;
  let middlewareManager: MiddlewareManager;
  const pluginManager: PluginManager | undefined = initialPluginManager;

  return {
    name: 'farm',

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
        server
      );

      const globalsCSSPath = path.join(server.config.root, 'src/app/globals.css');
      if (!fs.existsSync(globalsCSSPath)) {
        const appDir = path.join(server.config.root, 'src/app');
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }
        fs.writeFileSync(globalsCSSPath, defaultGlobalCSS);
      }

      await farmApp.initialize();

      // Initialize HMR manager
      hmrManager = new HMRManager(server);

      // Initialize API route manager
      const appDir = path.join(server.config.root, 'src/app');
      apiRouteManager = new APIRouteManager(appDir, server);
      await apiRouteManager.discoverRoutes();

      middlewareManager = new MiddlewareManager(appDir, server);
      await middlewareManager.discover();

      // Initialize OpenAPI manager if enabled
      if (options.openapi?.enabled) {
        openAPIManager = new OpenAPIManager(appDir, options.openapi);
        await openAPIManager.generateSpec();
        logger.success('✅ OpenAPI documentation enabled');
      }

      // Register middleware directly (not in return function) to ensure it runs early
      if (pm) {
        server.middlewares.use(async (req, res, next) => {

          // Handle OpenAPI docs route
          if (openAPIManager && req.url === options.openapi?.route) {
            const docsHandler = openAPIManager.getDocsRouteHandler();
            return docsHandler(req, res);
          }

          // Handle API routes first
          if (req.url?.startsWith('/api/')) {
            const apiHandler = apiRouteManager.getHandler();
            if (apiHandler) {
              try {
                // Convert Node.js request to Web Request
                const url = `http://${req.headers.host || 'localhost:3000'}${req.url}`;
                const headers = new Headers();
                for (const [key, value] of Object.entries(req.headers)) {
                  if (value) {
                    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
                  }
                }

                // Get body for POST/PUT/PATCH
                let body: string | undefined;
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                  body = await new Promise<string>((resolve) => {
                    let data = '';
                    req.on('data', (chunk) => {
                      data += chunk;
                    });
                    req.on('end', () => {
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
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Internal server error' }));
                return;
              }
            }
          }

          // Skip internal Vite requests
          if (
            req.url?.startsWith('/@') ||
            req.url?.startsWith('/node_modules') ||
            (req.url?.includes('.') && !req.url?.endsWith('.html'))
          ) {
            return next();
          }

          try {
            if (middlewareManager) {
              const handled = await middlewareManager.execute(req, res);
              if (handled) {
                return; // Middleware handled the response
              }
            }

            // Run beforeRequest hooks
            if (pm) {
              await pm.runHookParallel('beforeRequest', req, res);
            }

            if (res.writableEnded) {
              return;
            }

            // Intercept res.end to call afterResponse hooks before response is fully sent
            const originalEnd = res.end.bind(res);
            let afterResponseCalled = false;

            res.end = ((...args: any[]) => {
              if (!afterResponseCalled && pm) {
                afterResponseCalled = true;
                // Call afterResponse synchronously before actually ending
                pm.runHookParallel('afterResponse', req, res).then(() => {
                  originalEnd(...args);
                }).catch((err) => {
                  console.error('Error in afterResponse hook:', err);
                  originalEnd(...args);
                });
              } else {
                originalEnd(...args);
              }
            }) as any;

            // Store props on request for hydration
            (req as any).__FARM_PROPS__ = {};

            const renderer = farmApp.getServerRenderer();
            await renderer.renderPage(req as any, res as any);
          } catch (error) {
            next(error);
          }
        });
      }
    },

    resolveId(id) {
      if (id === '/@farm/client' || id === '/@farm/client.js') {
        return id;
      }

      if (id === '/@farm/server') {
        return id;
      }
    },

    load(id) {
      if (id === '/@farm/client' || id === '/@farm/client.js') {
        return generateClientCode();
      }

      if (id === '/@farm/server') {
        return generateServerCode();
      }
    },

    transform(code, id) {
      if (code.trimStart().startsWith("'use client'") || code.trimStart().startsWith('"use client"')) {
        const moduleInfo = this.getModuleInfo(id);
        if (moduleInfo) {
          (moduleInfo as any).isClientComponent = true;
        }

        // Store client component for later injection
        if (!farmApp) return;

        const clientComponents = (farmApp as any).__clientComponents__ || new Set();
        clientComponents.add(id);
        (farmApp as any).__clientComponents__ = clientComponents;
      }

      return null;
    },

    generateBundle(options, bundle) {
      const clientManifest = generateClientManifest(bundle);
      this.emitFile({
        type: 'asset',
        fileName: 'farm-client-manifest.json',
        source: JSON.stringify(clientManifest, null, 2),
      });
    },

    async handleHotUpdate(ctx: HmrContext) {
      const { file, server, modules } = ctx;
      if (file.includes('/app/')) {
        // Hot reload middleware changes
        if (file.includes('middleware.')) {
          if (middlewareManager) {
            await middlewareManager.reload();
            logger.success('✅ Middleware reloaded!');
          }

          return [];
        }

        // Auto-generate types when API routes change
        if (file.includes('/api/') && file.includes('/route.')) {
          const shortPath = file.split('/app/')[1] || file;
          logger.event(`API route updated: ${shortPath} - regenerating types...`);

          // Dynamically regenerate API types
          try {
            const { APITypeGenerator } = await import('./type-generator.js');
            const { join } = await import('path');
            const { fileURLToPath } = await import('url');

            const appDir = file.substring(0, file.indexOf('/app/') + 4);
            const outputPath = join(appDir, '../lib/api.generated.ts');

            const generator = new APITypeGenerator(appDir);
            generator.generateAPIIndex(outputPath);
            logger.success('✅ API types regenerated!');

            // Regenerate OpenAPI spec if enabled
            if (openAPIManager) {
              await openAPIManager.invalidateCache();
              logger.success('✅ OpenAPI spec regenerated!');
            }
          } catch (error) {
            logger.warn(`Failed to regenerate API types: ${error}`);
          }
        }

        if (file.includes('page.') || file.includes('layout.')) {
          const shortPath = file.split('/app/')[1] || file;
          logger.event(`Updated: ${shortPath}`);

          for (const mod of modules) {
            server.moduleGraph.invalidateModule(mod);
          }

          server.ws.send({
            type: 'full-reload',
            path: '*'
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
import { hydrateRoot } from 'react-dom/client'

async function hydrate() {
  const container = document.getElementById('root')
  
  if (!container) {
    console.error('[Farm.js] Root container not found')
    return
  }

  try {
    const fullPath = window.__FARM_PAGE_PATH__
    
    if (!fullPath) {
      console.error('[Farm.js] No page path found')
      return
    }

    const relativePath = fullPath.includes('/src/app/') 
      ? fullPath.substring(fullPath.indexOf('/src/app/'))
      : fullPath;

    // First, try to fetch the raw file content to check if it's a client component
    let isClientComponent = false;
    try {
      const response = await fetch(relativePath);
      const content = await response.text();
      isClientComponent = content.trimStart().startsWith("'use client'") || 
                         content.trimStart().startsWith('"use client"');
    } catch (error) {
      console.log('[Farm.js] Could not check client component status, assuming server component')
      return
    }

    if (!isClientComponent) {
      console.log('[Farm.js] Skipping hydration for server component:', relativePath)
      return
    }

    const pageModule = await import(/* @vite-ignore */ relativePath)
    const PageComponent = pageModule.default
    
    if (!PageComponent) {
      console.error('[Farm.js] No default export found in', relativePath)
      return
    }

    const props = window.__FARM_PROPS__ || {}
    
    hydrateRoot(container, React.createElement(PageComponent, props))
    console.log('[Farm.js] ✅ Hydrated client component:', relativePath)
  } catch (error) {
    console.error('[Farm.js] Hydration error:', error)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrate)
} else {
  hydrate()
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
  
  import.meta.hot.on('vite:beforeUpdate', () => {
    console.log('[Farm.js] ⚡ Update detected')
  })
}
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
    if ((chunk as any).type === 'chunk') {
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
  const tailwindcss = await import('tailwindcss');
  const autoprefixer = await import('autoprefixer');

  return {
    plugins: [farmPlugin(config)],
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
    ssr: {
      noExternal: ['farm'],
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss.default({
            content: ['./src/**/*.{js,ts,jsx,tsx}'],
            theme: {
              extend: {},
            },
          }),
          autoprefixer.default,
        ],
      },
    },
    define: {
      __FARM_DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
    },
  };
}
