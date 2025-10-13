import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      server: 'src/server.ts',
      client: 'src/client.ts',
      vite: 'src/vite.ts'
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    external: ['react', 'react-dom', 'vite'],
    splitting: false,
    sourcemap: true,
    minify: false
  }
])

