import { workos } from "@farmjs/integrations";

export const appIntegrations = {
  auth: workos({
    protectedRoutes: ["/dashboard(.*)"],
    log(event) {
      console.log("[workos-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
