import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: [
      "react-dom/server",
      "@poppinss/dumper",
      "@mapbox/node-pre-gyp",
      "supports-color",
      "nitro",
    ],
  },
});
