import { defineFarmConfig, type FarmPlugin } from '@farmjs/core';
import { createLoggerPlugin, createEnvPlugin } from '@farmjs/core/plugin/server';
import { storageDemoClients, STORAGE_DEMO_MOUNTS } from './src/lib/storage-demo.ts';

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

export default defineFarmConfig({
  srcDir: 'src',
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
  experimental: {
    // Route-level loading.tsx/error.tsx in this example rely on streamed server rendering.
    serverComponents: true,
    serverActions: true,
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
    FARM_API_URL: 'https://api.example.com',
    PUBLIC_APP_NAME: 'My Farm.js App',
  },

  // Build configuration
  output: 'standalone',
  compress: true,

  // Development indicators
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },

  // TypeScript
  typescript: {
    ignoreBuildErrors: false,
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
  },

  md: {
    expose: ['/', '/about', '/contact'],
    cache: 60,
  },

  // Plugins
  plugins: [
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
