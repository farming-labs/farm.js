import { defineConfig } from '@farm.js/core';

export default defineConfig({
  srcDir: 'src',
  deploy: {
    target: 'vercel',
  },
  docs: {
    entry: '/docs',
    metadata: {
      description: 'Farm docs integration example',
    },
    nav: {
      title: 'Farm Docs',
    },
    search: {
      provider: 'simple',
      enabled: true,
    },
    pageActions: {
      copyMarkdown: {
        enabled: true,
      },
    },
    llmsTxt: true,
    sitemap: true,
    robots: true,
  },
});
