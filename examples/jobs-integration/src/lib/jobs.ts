import { defineTasks, task } from "@farm.js/integrations";

export const triggerTasks = defineTasks({
  sendWelcomeEmail: task({
    description: "Queue a welcome email with retry, TTL, and launch tags.",
    defaults: {
      queue: {
        name: "email",
        concurrencyLimit: 2,
      },
      retry: {
        attempts: 3,
      },
      ttl: "5m",
      tags: ["email"],
      concurrencyKey(input: { userId: string }) {
        return `user:${input.userId}`;
      },
      idempotencyKey(input: { userId: string }) {
        return `welcome:${input.userId}`;
      },
    },
    async run(input: { userId: string }) {
      return {
        messageId: `msg_${input.userId}`,
      };
    },
  }),
  nightlyCleanup: task<void, { deleted: number }>({
    description: "A scheduled cleanup task with no launch payload.",
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

export const inngestTasks = defineTasks({
  importCsv: task({
    id: "import-csv",
    description: "Send an import event and poll the resulting Inngest run.",
    defaults: {
      idempotencyKey(input: { fileId: string }) {
        return `import:${input.fileId}`;
      },
    },
    async run(input: { fileId: string }) {
      return {
        processed: input.fileId.length,
      };
    },
  }),
  syncInventory: task({
    id: "sync-inventory",
    description: "A minimal event-style task definition for Inngest.",
    defaults: {
      idempotencyKey(input: { sku: string }) {
        return `inventory:${input.sku}`;
      },
    },
    async run(input: { sku: string }) {
      return {
        synced: input.sku.length > 0,
      };
    },
  }),
});
