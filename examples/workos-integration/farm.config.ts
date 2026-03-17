import { defineFarmConfig } from "@farmjs/core";
import { workos } from "@farmjs/integrations/workos";

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
    auth: workos({
      protectedRoutes: ["/dashboard(.*)"],
      log(event) {
        console.log("[workos-example]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
