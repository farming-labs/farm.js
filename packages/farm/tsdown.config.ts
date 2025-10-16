import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      server: 'src/server.ts',
      client: 'src/client.ts',
      vite: 'src/vite.ts',
      'server-plugins': 'src/server-plugins.ts',
      'client-plugins': 'src/client-plugins.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    external: ['react', 'react-dom', 'vite'],
    splitting: false,
    sourcemap: true,
    minify: false,
  },
]);
