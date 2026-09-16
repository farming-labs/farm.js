import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    isolatedClientHydration: "enabled",
  },
  vite: {
    server: {
      port: 3010,
      strictPort: false,
    },
  },
});
