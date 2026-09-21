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
        listId: { type: "string", required: true, index: true },
        updatedAt: { type: "datetime" },
      },
    },
  },
});
