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
      'query/index': 'src/query/index.ts',
      'query/parsers': 'src/query/parsers.ts',
      'query/client': 'src/query/client.ts',
      'query/server': 'src/query/server.ts',
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
