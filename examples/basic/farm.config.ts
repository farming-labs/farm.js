import { defineConfig, definePlugin, type FarmPlugin } from '@farm.js/core';
import { createLoggerPlugin, createEnvPlugin } from '@farm.js/core/plugin/server';
import { z } from 'zod';
import { storageDemoClients, STORAGE_DEMO_MOUNTS } from './src/lib/storage-demo.ts';
import { integrationLab } from './src/lib/integration-lab.ts';

declare global {
  interface Window {
    __FARM_CLIENT_PLUGIN_EVENTS__?: string[];
  }
}

const myCustomPlugin: FarmPlugin = {
  name: 'my-custom-plugin',
  
  async beforeRequest(req, res, context) {
    res.setHeader('X-Powered-By', 'Farm.js');
  },

  async transformHTML(html, context) {
    return html.replace(
      '</head>',
      '<meta name="custom" content="Farm.js App" /></head>'
    );
  },
};

const runtimeLifecyclePlugin = definePlugin({
  name: 'runtime-lifecycle-e2e',

  client: {
    public: { label: 'feature-lab' },

    setup({ plugin, public: config, isDev }) {
      const events: string[] = [];
      const record = (event: string) => {
        events.push(event);
        window.__FARM_CLIENT_PLUGIN_EVENTS__ = [...events];
        document.documentElement.dataset.farmClientPluginEvent = event;
        window.dispatchEvent(new CustomEvent('farm:client-plugin-event', { detail: event }));
      };

      document.documentElement.dataset.farmClientPlugin = config.label;
      record(`setup:${plugin.name}:${config.label}:${isDev ? 'dev' : 'prod'}`);
      return { record };
    },

    hydration: {
      before({ state, mode }) {
        state.record(`hydration:before:${mode}`);
      },
      after({ state, recovered }) {
        state.record(`hydration:after:${recovered ? 'recovered' : 'ready'}`);
      },
    },

    navigation: {
      before({ state, to }) {
        state.record(`navigation:before:${to.pathname}`);
      },
      loaded({ state, to }) {
        state.record(`navigation:loaded:${to.pathname}`);
      },
      resolved({ state, to }) {
        state.record(`navigation:resolved:${to.pathname}`);
      },
      rendered({ state, to }) {
        state.record(`navigation:rendered:${to.pathname}`);
      },
      error({ state, to }) {
        state.record(`navigation:error:${to.pathname}`);
      },
    },

    error({ state, phase }) {
      state.record(`error:${phase}`);
    },

    close({ state, reason }) {
      state.record(`close:${reason}`);
    },
  },

  setup() {
    return { header: 'x-farm-runtime-plugin' };
  },

  runtime: {
    context({ request }) {
      return { requestPath: new URL(request.url).pathname };
    },

    before({ ctx }) {
      if (ctx.requestPath === '/feature-lab/runtime-short-circuit') {
        return new Response('Stopped by the Farm plugin runtime', { status: 418 });
      }
    },

    after({ state, ctx, kind, route, response }) {
      const headers = new Headers(response.headers);
      headers.set(state.header, ctx.requestPath);
      headers.set('x-farm-runtime-kind', kind);
      if (route?.pattern) {
        headers.set('x-farm-runtime-pattern', route.pattern);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  },

  render: {
    html(html, render) {
      return html.replace(
        '</body>',
        `<!-- farm-plugin-render:${render.routePattern || render.pathname} --></body>`,
      );
    },
  },
});

export default defineConfig({
  extends: ['./layers/framework-features'],
  outDir: 'dist',
  basePath: '/',
  deploy: {
    target: 'vercel',
  },
  storage: {
    mounts: {
      [STORAGE_DEMO_MOUNTS.local]: storageDemoClients.local,
      [STORAGE_DEMO_MOUNTS.sqlite]: storageDemoClients.sqlite,
      ...(storageDemoClients.postgres
        ? { [STORAGE_DEMO_MOUNTS.postgres]: storageDemoClients.postgres }
        : {}),
    },
  },
  cron: {
    dailyCleanup: {
      schedule: '0 2 * * *',
      path: '/api/maintenance/cleanup',
      description: 'Delete expired sessions every night.',
    },
  },
  experimental: {
    // Route-level loading.tsx/error.tsx in this example rely on streamed server rendering.
    serverComponents: true,
    serverActions: true,
  },

  integrations: integrationLab,

  context: async ({ request, path }) => ({
    tenant: {
      id: request.headers.get('x-farm-tenant') || 'public',
    },
    requestId: request.headers.get('x-request-id') || `request:${path}`,
  }),

  routeRules: {
    '/feature-lab': {
      render: 'dynamic',
      headers: {
        'x-farm-feature-lab': 'active',
      },
    },
    '/feature-lab/**': {
      render: 'dynamic',
      headers: {
        'x-farm-feature-lab': 'active',
      },
    },
    '/feature-lab/route-rule-redirect': {
      redirect: '/feature-lab',
    },
  },

  serverActions: {
    bodySizeLimit: '512kb',
  },

  trailingSlash: false,

  // Custom 404 Not Found page
  // The framework will automatically detect src/app/not-found.tsx
  // You can also explicitly specify a custom component path:
  // notFound: {
  //   component: "./src/app/not-found.tsx",
  // },

  async redirects() {
    return [
      {
        source: '/old-about',
        destination: '/about',
        permanent: true,
      },
      {
        source: '/blog/:slug*',
        destination: '/posts/:slug*',
        permanent: false,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store',
          },
        ],
      },
    ];
  },

  // URL Rewrites
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://api.example.com/:path*',
      },
    ];
  },

  // Image optimization
  images: {
    domains: ['example.com', 'cdn.example.com'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ['image/webp'],
  },

  // Environment variables
  env: {
    server: {
      FARM_API_URL: z.string().url().default('https://api.example.com'),
    },
    public: {
      PUBLIC_APP_NAME: z.string().default('My Farm.js App'),
    },
  },

  // Build configuration
  compress: true,

  // Development indicators
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },

  // OpenAPI Documentation
  openapi: {
    enabled: true,
    route: '/docs/reference',
    title: 'Farm.js API Documentation',
    description: 'Auto-generated API documentation for Farm.js endpoints',
    version: '1.0.0',
    servers: [
      { url: 'http://localhost:3000/api', description: 'Development server' }
    ],
    contact: {
      name: 'Farm.js Team',
      email: 'hello@farmjs.dev',
      url: 'https://farmjs.dev'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },

  docs: {
    entry: '/docs',
    metadata: {
      description: 'Farm.js example documentation',
    },
    nav: {
      title: 'Farm Docs',
    },
  },

  md: {
    expose: ['/', '/about', '/contact'],
    cache: 60,
  },

  mdx: {
    components: './src/markdown-components.tsx',
  },

  // Plugins
  plugins: [
    runtimeLifecyclePlugin,
    createLoggerPlugin({}),
    createEnvPlugin({
        FARM_API_URL: 'https://api.example-to-something.com',
        API_URL: 'https://api.example.com',
    })
],

  vite: {
    optimizeDeps: {
      exclude: [
        'react-dom/server',
        '@poppinss/dumper',
        '@mapbox/node-pre-gyp',
        'supports-color',
        'nitro',
      ],
    },
    server: {
      port: 3000,
      strictPort: false,
    },
    build: {
      sourcemap: true,
    },
  },
});
