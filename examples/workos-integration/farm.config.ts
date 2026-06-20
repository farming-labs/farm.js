import { defineFarmConfig } from "@farmjs/core";
import { appIntegrations } from "./src/lib/integrations.ts";

export default defineFarmConfig({
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
