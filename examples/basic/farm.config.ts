import { defineFarmConfig } from 'farm';
import { createLoggerPlugin} from 'farm/plugin/server';
import type { FarmPlugin } from 'farm/plugin/server';

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

  // Plugins
  plugins: [
    myCustomPlugin,
    createLoggerPlugin(),
  ],

  // Vite configuration
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

