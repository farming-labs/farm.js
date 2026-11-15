import { defineConfig } from '@farm.js/core';

export default defineConfig({
  deploy: {
    target: 'vercel',
  },
  experimental: {
    serverComponents: true,
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
});
