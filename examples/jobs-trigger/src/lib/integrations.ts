import { jobs, trigger } from "@farm.js/integrations";
import { triggerTasks } from "./jobs.ts";

export const appIntegrations = {
  jobs: jobs({
    runtime: trigger({
      projectRef: process.env.TRIGGER_PROJECT_REF,
      apiKey: process.env.TRIGGER_SECRET_KEY,
      webhookSecret: process.env.TRIGGER_WEBHOOK_SECRET,
    }),
    tasks: triggerTasks,
    log(event) {
      console.log("[jobs-trigger-example]", event.phase, event.route?.path || "none");
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
