import { defineSchema } from "@farm.js/core";

/**
 * One declarative schema drives the database tables, the server types, the
 * browser types, and what the sync plugin exposes.
 */
export const schema = defineSchema({
  models: {
    tasks: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        title: { type: "string", required: true },
        status: { type: "enum", values: ["open", "done"], default: "open" },
        // Owned by the server's `where` scope: whatever a client sends here is
        // discarded and re-stamped. The default is what lets an insert omit it,
        // in the generated types and in the database alike.
        listId: { type: "string", required: true, index: true, default: "" },
        updatedAt: { type: "datetime" },
      },
    },
  },
});
