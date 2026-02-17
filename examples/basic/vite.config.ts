// This file is kept for IDE support and direct vite commands
// Primary configuration is in farm.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // Additional exclusions for transitive server deps that shouldn't be bundled
    exclude: [
      "react-dom/server",
      "@poppinss/dumper",
      "@mapbox/node-pre-gyp",
      "supports-color",
      "nitro",
    ],
  },
});
