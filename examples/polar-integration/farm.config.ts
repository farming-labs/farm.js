import { defineConfig } from "@farmjs/core";
import { appIntegrations } from "./src/lib/integrations.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  vite: {
    server: {
      port: 3002,
      strictPort: true,
    },
  },
  integrations: appIntegrations,
});

