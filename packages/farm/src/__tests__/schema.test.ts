import { describe, expect, it } from "vitest";
import { defineSchema, type FarmSchema } from "../schema";
import { defineIntegrationSchema, type FarmIntegrationSchema } from "../integrations";

const tasks = {
  models: {
    tasks: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        title: { type: "string", required: true },
        status: { type: "enum", values: ["open", "done"], default: "open" },
      },
    },
  },
} satisfies FarmSchema;

describe("defineSchema", () => {
  it("returns the schema unchanged and preserves literal inference", () => {
    const schema = defineSchema(tasks);

    expect(schema).toBe(tasks);
    // Literal types survive, so consumers can read enum values off the schema.
    const values: readonly ["open", "done"] = schema.models.tasks.fields.status.values;
    expect(values).toEqual(["open", "done"]);
  });

  it("accepts references, constraints, extend, and override", () => {
    const schema = defineSchema({
      models: {
        projects: { fields: { id: { type: "uuid", primaryKey: true } } },
        tasks: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            projectId: {
              type: "uuid",
              required: true,
              reference: { model: "projects", field: "id", relation: "belongsTo" },
            },
          },
          constraints: [{ type: "index", fields: ["projectId"] }],
        },
      },
      extend: { projects: { fields: { name: { type: "string" } } } },
      override: { tasks: { fields: { id: { unique: true } } } },
    });

    expect(schema.models.tasks.fields.projectId.reference?.model).toBe("projects");
    expect(schema.extend?.projects.fields?.name?.type).toBe("string");
  });
});

describe("defineIntegrationSchema compatibility", () => {
  it("is an exact alias of defineSchema", () => {
    expect(defineIntegrationSchema).toBe(defineSchema);
  });

  it("still accepts and returns an integration schema unchanged", () => {
    const schema = defineIntegrationSchema(tasks);
    expect(schema).toBe(tasks);
  });

  it("keeps the deprecated types assignable in both directions", () => {
    const viaOldName: FarmIntegrationSchema = tasks;
    const viaNewName: FarmSchema = viaOldName;
    const backAgain: FarmIntegrationSchema = viaNewName;

    expect(backAgain).toBe(tasks);
  });
});
