import { defineFarmConfig } from "@farmjs/core";
import { clerk } from "@farmjs/integrations/clerk";

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
  integrations: {
    auth: clerk({
      protectedRoutes: ["/dashboard(.*)"],
      log(event) {
        console.log("[clerk-example]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
