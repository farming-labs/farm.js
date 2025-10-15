import type { Plugin, ViteDevServer, HmrContext } from 'vite';
import type { FarmConfig } from './types';
import { FarmApp } from './app';
import { logger } from './utils';
import { defaultGlobalCSS } from './default-styles';
import type { PluginManager } from './plugin';
import { HMRManager } from './hmr';
import * as fs from 'fs';
import * as path from 'path';

interface FarmVitePluginOptions extends FarmConfig {}

export function farmPlugin(
  options: FarmVitePluginOptions = {},
  initialPluginManager?: PluginManager
): Plugin {
  let farmApp: FarmApp;
  let server: ViteDevServer;
  let hmrManager: HMRManager;
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

      // Register middleware directly (not in return function) to ensure it runs early
      if (pm) {
        server.middlewares.use(async (req, res, next) => {
          // Skip internal Vite requests
          if (
            req.url?.startsWith('/@') ||
            req.url?.startsWith('/node_modules') ||
            (req.url?.includes('.') && !req.url?.endsWith('.html'))
          ) {
            return next();
          }

          try {
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

            res.end = function(...args: any[]) {
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
            } as any;

            const renderer = farmApp.getServerRenderer();
            await renderer.renderPage(req as any, res as any);
          } catch (error) {
            next(error);
          }
        });
      }
    },

    resolveId(id) {
      if (id === '/@farm/client') {
        return id;
      }

      if (id === '/@farm/server') {
        return id;
      }
    },

    load(id) {
      if (id === '/@farm/client') {
        return generateClientCode();
      }

      if (id === '/@farm/server') {
        return generateServerCode();
      }
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
    console.error('Root container not found')
    return
  }

  const App = () => React.createElement('div', { dangerouslySetInnerHTML: { __html: container.innerHTML } })
  hydrateRoot(container, React.createElement(App))
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrate)
} else {
  hydrate()
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Farm.js] Reloading page...')
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
