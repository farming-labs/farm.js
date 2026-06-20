import { inngest, jobs, trigger } from "@farmjs/integrations";
import { inngestTasks, triggerTasks } from "./jobs.ts";

export const selectedJobsRuntime =
  process.env.JOBS_RUNTIME === "inngest" ? "inngest" : "trigger";

export const appIntegrations = {
  jobs:
    selectedJobsRuntime === "inngest"
      ? jobs({
          runtime: inngest({
            appId: process.env.INNGEST_APP_ID,
            eventKey: process.env.INNGEST_EVENT_KEY,
            signingKey: process.env.INNGEST_SIGNING_KEY,
          }),
          tasks: inngestTasks,
          log(event) {
            console.log("[jobs-example:inngest]", event.phase, event.route?.path || "none");
          },
        })
      : jobs({
          runtime: trigger({
            projectRef: process.env.TRIGGER_PROJECT_REF,
            apiKey: process.env.TRIGGER_SECRET_KEY,
            webhookSecret: process.env.TRIGGER_WEBHOOK_SECRET,
          }),
          tasks: triggerTasks,
          log(event) {
            console.log("[jobs-example:trigger]", event.phase, event.route?.path || "none");
          },
        }),
} as const;

export type AppIntegrations = typeof appIntegrations;
