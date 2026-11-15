import { inngest, jobs, local, trigger } from "@farm.js/jobs";
import { inngestTasks, localTasks, triggerTasks } from "./jobs.ts";

export const selectedJobsRuntime =
  process.env.JOBS_RUNTIME === "inngest"
    ? "inngest"
    : process.env.JOBS_RUNTIME === "local"
      ? "local"
      : "trigger";

function createJobs() {
  if (selectedJobsRuntime === "local") {
    // Runs execute in this app and are kept in the `jobs` storage mount from farm.config.ts.
    return jobs({
      runtime: local(),
      tasks: localTasks,
      log(event) {
        console.log("[jobs-example:local]", event.phase, event.route?.path || "none");
      },
    });
  }

  if (selectedJobsRuntime === "inngest") {
    return jobs({
      runtime: inngest({
        appId: process.env.INNGEST_APP_ID,
        eventKey: process.env.INNGEST_EVENT_KEY,
        signingKey: process.env.INNGEST_SIGNING_KEY,
      }),
      tasks: inngestTasks,
      log(event) {
        console.log("[jobs-example:inngest]", event.phase, event.route?.path || "none");
      },
    });
  }

  return jobs({
    runtime: trigger({
      projectRef: process.env.TRIGGER_PROJECT_REF,
      apiKey: process.env.TRIGGER_SECRET_KEY,
      webhookSecret: process.env.TRIGGER_WEBHOOK_SECRET,
    }),
    tasks: triggerTasks,
    log(event) {
      console.log("[jobs-example:trigger]", event.phase, event.route?.path || "none");
    },
  });
}

export const appIntegrations = {
  jobs: createJobs(),
} as const;

export type AppIntegrations = typeof appIntegrations;
