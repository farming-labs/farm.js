import { defineFarmConfig, type FarmPlugin } from '@farmjs/core';
import { createLoggerPlugin, createEnvPlugin } from '@farmjs/core/plugin/server';

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

  experimental: {
    serverComponents: true,
    serverActions: true,
  },

  trailingSlash: false,

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

  // Plugins
  plugins: [
    myCustomPlugin,
    createLoggerPlugin({}),
    createEnvPlugin({
        FARM_API_URL: 'https://api.example-to-something.com',
        API_URL: 'https://api.example.com',
    })
],

  vite: {
    server: {
      port: 3000,
      strictPort: false,
    },
    build: {
      sourcemap: true,
    },
  },
});

