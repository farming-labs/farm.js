import { jobs, trigger } from "@farm.js/jobs";
import { triggerTasks } from "./jobs.ts";

export const appIntegrations = {
  jobs: jobs({
    runtime: trigger({
      projectRef: process.env.TRIGGER_PROJECT_REF,
      apiKey: process.env.TRIGGER_SECRET_KEY,
      webhookSecret: process.env.TRIGGER_WEBHOOK_SECRET,
    }),
    tasks: triggerTasks,
    // The demo's buttons call job routes from the browser, which job routes
    // refuse unless authorize allows it. A real app checks the signed-in user
    // here; this example allows them only in local development.
    authorize: () => process.env.NODE_ENV === "development",
    log(event) {
      console.log("[jobs-trigger-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
