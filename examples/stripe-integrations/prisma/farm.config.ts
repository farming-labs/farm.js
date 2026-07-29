import { defineConfig } from "@farm.js/core";
import { appIntegrations } from "./src/lib/integrations.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  vite: {
    server: {
      port: 3000,
      strictPort: true,
    },
  },
  integrations: appIntegrations,
});
