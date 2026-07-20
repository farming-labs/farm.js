import { defineConfig, definePlugin } from '@farmjs/core';

const layerRuntimePlugin = definePlugin({
  name: 'framework-features:runtime',

  runtime: {
    after({ response }) {
      const headers = new Headers(response.headers);
      headers.set('x-farm-layer-plugin', 'framework-features');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  },
});

export default defineConfig({
  plugins: [layerRuntimePlugin],
  routeRules: {
    '/feature-lab/layer': {
      headers: {
        'x-farm-layer': 'framework-features',
      },
    },
  },
});
