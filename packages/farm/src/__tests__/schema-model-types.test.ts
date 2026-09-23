// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSyncModelTypeDeclarations } from "../schema-model-types";
import { declareSchemaTables } from "../schema-tables";
import type { FarmPlugin } from "../plugin";

const schema = {
  models: {
    tasks: {
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        title: { type: "string" as const, required: true },
        status: {
          type: "enum" as const,
          values: ["open", "done", "archived"] as const,
          default: "open",
        },
        estimate: { type: "integer" as const, nullable: true },
        tags: { type: "string" as const, list: true, required: false },
        updatedAt: { type: "datetime" as const },
      },
    },
    privateNotes: {
      fields: { id: { type: "uuid" as const, primaryKey: true } },
    },
  },
};

function syncPlugin(models: string[] | undefined = ["tasks"]): FarmPlugin {
  return declareSchemaTables({ name: "farm:sync" } as FarmPlugin, {
    name: "sync",
    schema,
    models,
    resolveClient: async () => null,
  });
}

describe("sync model type declarations", () => {
  it("emits row and insert maps for the exposed models only", () => {
    const output = createSyncModelTypeDeclarations([syncPlugin()]);

    expect(output).toContain('declare module "@farm.js/sync/client"');
    expect(output).toContain("interface SyncModels");
    expect(output).toContain("interface SyncModelInputs");
    expect(output).toContain("tasks: {");
    // A model the app has not opened to the browser never becomes a client type.
    expect(output).not.toContain("privateNotes");
  });

  it("maps field types the way rows travel over JSON", () => {
    const output = createSyncModelTypeDeclarations([syncPlugin()])!;

    expect(output).toContain('status: "open" | "done" | "archived";');
    expect(output).toContain("estimate: number | null;");
    expect(output).toContain("tags: string[] | null;");
    expect(output).toContain("updatedAt: string;");
    expect(output).toContain("id: string;");
  });

  it("relaxes the key, defaults, nullables, and the cursor on insert shapes", () => {
    const output = createSyncModelTypeDeclarations([syncPlugin()])!;
    const inputs = output.slice(output.indexOf("SyncModelInputs"));

    expect(inputs).toContain("id?: string;");
    expect(inputs).toContain('status?: "open" | "done" | "archived";');
    expect(inputs).toContain("estimate?: number | null;");
    expect(inputs).toContain("updatedAt?: string;"); // cursor: server-stamped
    expect(inputs).toContain("title: string;"); // required with no default stays required
  });

  it("returns null when no sync plugin declares a schema", () => {
    expect(createSyncModelTypeDeclarations([])).toBeNull();
    expect(createSyncModelTypeDeclarations(undefined)).toBeNull();

    // Another plugin's tables (a billing integration, say) are server-only.
    const stripeLike = declareSchemaTables({ name: "farm:stripe" } as FarmPlugin, {
      name: "stripe",
      schema,
      models: ["tasks"],
      resolveClient: async () => null,
    });
    expect(createSyncModelTypeDeclarations([stripeLike])).toBeNull();
  });
});
