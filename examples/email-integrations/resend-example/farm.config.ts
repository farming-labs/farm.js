import { defineFarmConfig } from "@farmjs/core";
import { appIntegrations } from "./src/lib/integrations.ts";

export default defineFarmConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: appIntegrations,
});
