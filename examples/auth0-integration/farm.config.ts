import { defineFarmConfig } from "@farmjs/core";
import { auth0 } from "@farmjs/integrations/auth0";

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
    auth: auth0({
      callbackUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/auth/callback`,
      protectedRoutes: ["/dashboard(.*)"],
      log(event) {
        console.log("[auth0-example]", event.phase, event.route?.path || "none");
      },
    }),
  },
});
