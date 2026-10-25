import { inngest, jobs } from "@farm.js/jobs";
import { inngestTasks } from "./jobs.ts";

export const appIntegrations = {
  jobs: jobs({
    runtime: inngest({
      appId: process.env.INNGEST_APP_ID,
      eventKey: process.env.INNGEST_EVENT_KEY,
      signingKey: process.env.INNGEST_SIGNING_KEY,
    }),
    tasks: inngestTasks,
    // The demo's buttons call job routes from the browser, which job routes
    // refuse unless authorize allows it. A real app checks the signed-in user
    // here; this example allows them only in local development.
    authorize: () => process.env.NODE_ENV === "development",
    log(event) {
      console.log("[jobs-inngest-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
