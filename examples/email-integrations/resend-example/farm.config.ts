import { defineConfig } from "@farmjs/core";
import { appIntegrations } from "./src/lib/integrations.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: appIntegrations,
});
