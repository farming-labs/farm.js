import { defineFarmConfig } from '@farmjs/core';

export default defineFarmConfig({
  srcDir: 'src',
  deploy: {
    target: 'vercel',
  },
  docs: {
    entry: '/docs',
  },
});
