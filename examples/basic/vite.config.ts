import { defineConfig } from '@farmjs/core/vite'

export default defineConfig().then(config => ({
  ...config,
  optimizeDeps: {
    ...config.optimizeDeps,
    // Additional exclusions for transitive server deps
    exclude: [
      ...(config.optimizeDeps?.exclude || []),
      "react-dom/server",
      "@poppinss/dumper",
      "@mapbox/node-pre-gyp",
    ],
  },
}))

