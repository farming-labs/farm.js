import { defineConfig } from '@farm.js/core';
import { createLoggerPlugin } from '@farm.js/core/plugin/server';

export default defineConfig({
  srcDir: 'src',
  deploy: {
    target: 'vercel',
  },
  experimental: {
    serverComponents: true,
    serverActions: true,
  },
  notFound: {
    component: './src/app/not-found.tsx',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },

  // Plugins
  plugins: [
    createLoggerPlugin({}),
  ],
});
