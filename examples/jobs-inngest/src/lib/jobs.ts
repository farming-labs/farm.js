import { defineTasks, task } from "@farmjs/integrations";

export const inngestTasks = defineTasks({
  importCsv: task({
    id: "import-csv",
    description: "Send an event-style run into Inngest and poll the resulting run list.",
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
    description: "A second Inngest task showing stable ids and typed payloads.",
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
