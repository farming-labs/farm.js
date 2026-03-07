import { defineFarmConfig } from '@farmjs/core';
import { createLoggerPlugin } from '@farmjs/core/plugin/server';

export default defineFarmConfig({
  srcDir: 'src',
  preset: 'vercel',
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
