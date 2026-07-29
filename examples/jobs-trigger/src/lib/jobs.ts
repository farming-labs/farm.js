import { defineTasks, task } from "@farm.js/jobs";

export const triggerTasks = defineTasks({
  farmjsSanityCheck: task({
    id: "farmjs-sanity-check",
    description: "Simple Trigger.dev run that proves the integration can enqueue a run.",
    defaults: {
      queue: {
        name: "farm-sanity",
        concurrencyLimit: 1,
      },
      retry: {
        attempts: 3,
      },
      ttl: "10m",
      tags: ["farmjs", "trigger"],
      idempotencyKey(input: { ping: boolean }) {
        return `sanity:${input.ping ? "ping" : "noop"}`;
      },
    },
    async run(input: { ping: boolean }) {
      return {
        accepted: input.ping,
      };
    },
  }),
  nightlyCleanup: task<void, { deleted: number }>({
    id: "farmjs-nightly-cleanup",
    description: "Scheduled cleanup example for the Trigger runtime shape.",
    schedule: {
      cron: "0 2 * * *",
      timezone: "Africa/Addis_Ababa",
    },
    async run() {
      return {
        deleted: 42,
      };
    },
  }),
});
