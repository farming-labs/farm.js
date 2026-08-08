import { defineConfig } from '@farm.js/core';
import { withDocs } from '@farming-labs/farmjs/config';

export default withDocs(
  defineConfig({
    deploy: {
      target: 'vercel',
    },
  }),
  {
    config: {
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
  },
);
