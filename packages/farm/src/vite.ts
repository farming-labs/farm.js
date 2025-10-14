import type { Plugin, ViteDevServer } from 'vite';
import type { FarmConfig } from './types';
import { FarmApp } from './app';
import { logger } from './utils';
import { defaultGlobalCSS } from './default-styles';
import * as fs from 'fs';
import * as path from 'path';

interface FarmVitePluginOptions extends FarmConfig {}

export function farmPlugin(options: FarmVitePluginOptions = {}): Plugin {
  let farmApp: FarmApp;
  let server: ViteDevServer;

  return {
    name: 'farm',

    async configResolved(config) {
      // Defer initialization until Vite server is available
    },

    async configureServer(viteServer) {
      server = viteServer;

      farmApp = new FarmApp(
        {
          root: server.config.root,
          ...options,
        },
        server
      );

      // Auto-create globals.css with Tailwind directives if it doesn't exist
      const globalsCSSPath = path.join(server.config.root, 'src/app/globals.css');
      if (!fs.existsSync(globalsCSSPath)) {
        const appDir = path.join(server.config.root, 'src/app');
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }
        fs.writeFileSync(globalsCSSPath, defaultGlobalCSS);
        logger.info('✨ Created globals.css with Tailwind directives');
      }

      await farmApp.initialize();

      server.middlewares.use('/', async (req, res, next) => {
        try {
          if (
            req.url?.startsWith('/@') ||
            req.url?.startsWith('/node_modules') ||
            (req.url?.includes('.') && !req.url?.endsWith('.html'))
          ) {
            return next();
          }

          const renderer = farmApp.getServerRenderer();
          await renderer.renderPage(req as any, res as any);
        } catch (error) {
          logger.error(`Middleware error: ${error}`);
          next(error);
        }
      });
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
  import.meta.hot.accept()
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
