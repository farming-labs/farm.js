import { inngest, jobs } from "@farmjs/integrations";
import { inngestTasks } from "./jobs.ts";

export const appIntegrations = {
  jobs: jobs({
    runtime: inngest({
      appId: process.env.INNGEST_APP_ID,
      eventKey: process.env.INNGEST_EVENT_KEY,
      signingKey: process.env.INNGEST_SIGNING_KEY,
    }),
    tasks: inngestTasks,
    log(event) {
      console.log("[jobs-inngest-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
