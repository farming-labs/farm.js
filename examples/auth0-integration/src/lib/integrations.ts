import { auth0 } from "@farm.js/auth0";

export const appIntegrations = {
  auth: auth0({
    callbackUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/auth/callback`,
    protectedRoutes: ["/dashboard(.*)"],
    log(event) {
      console.log("[auth0-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
