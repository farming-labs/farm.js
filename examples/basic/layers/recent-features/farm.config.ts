import type { FarmLayerConfig } from '@farmjs/core';

export default {
  routeRules: {
    '/feature-lab/layer': {
      headers: {
        'x-farm-layer': 'recent-features',
      },
    },
  },
} satisfies FarmLayerConfig;
