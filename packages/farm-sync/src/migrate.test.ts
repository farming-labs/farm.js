// @vitest-environment node
import {
  applySchemaMigration,
  collectOwnerModels,
  findSchemaTableOwners,
  migrateSchemaTables,
  planSchemaMigration,
  readSchemaTables,
} from "@farm.js/core";
import { describe, expect, it } from "vitest";
import { sync } from "./index";
import { executeSyncOperation } from "./server";

const schema = {
  models: {
    tasks: {
      name: "todo_items",
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        title: { type: "string" as const, required: true },
        listId: { type: "string" as const, required: true, index: true, name: "list_id" },
        updatedAt: { type: "datetime" as const, name: "updated_at" },
      },
    },
    // Declared in the schema but never exposed to the browser.
    auditLog: {
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        entry: { type: "string" as const },
      },
    },
  },
};

function plugin(client: unknown) {
  return sync({
    schema: schema as never,
    client: () => client,
    models: { tasks: "write" },
    where: ({ context }) => ({ listId: (context as { listId: string }).listId }),
  });
}

describe("sync declares the tables it owns", () => {
  it("declares itself under the name the command uses", () => {
    expect(readSchemaTables(plugin(null))?.name).toBe("sync");
  });

  it("claims only the models the app exposed", () => {
    // auditLog is in the schema but absent from `models`, so it is not sync's
    // table to create — the app owns it elsewhere.
    const declaration = readSchemaTables(plugin(null))!;
    expect(declaration.models).toEqual(["tasks"]);
    expect(collectOwnerModels(declaration).map((model) => model.modelName)).toEqual(["todo_items"]);
  });

  it("is reachable through the same discovery the cli uses", () => {
    const owners = findSchemaTableOwners({ plugins: [plugin(null)] });
    expect(owners.map((owner) => owner.name)).toEqual(["sync"]);
  });

  it("resolves a storage mount as its client", async () => {
    const { createStorage } = await import("unstorage");
    const storage = createStorage();
    const owner = findSchemaTableOwners({ plugins: [plugin(storage)] })[0]!;

    expect(await owner.resolveClient()).toBe(storage);
  });
});

describe("migrating a real sync app", () => {
  it("creates tables sync can then read and write through", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const owner = findSchemaTableOwners({ plugins: [plugin(database)] })[0]!;

    await migrateSchemaTables(owner, { apply: true });

    // Drive the real orm over the database the generated ddl just created.
    const { datetime, defineSchema, id, model, string } = await import("@farming-labs/orm");
    const { createOrmFromRuntime } = await import("@farming-labs/orm-runtime");
    const orm = (await createOrmFromRuntime({
      schema: defineSchema({
        tasks: model({
          table: "todo_items",
          fields: {
            id: id(),
            title: string(),
            listId: string().map("list_id"),
            updatedAt: datetime().map("updated_at"),
          },
        }),
      }),
      client: database,
    })) as never;

    const { resolveSyncModels } = await import("./types");
    const models = resolveSyncModels(
      schema as never,
      { tasks: "write" },
      ({ context }) => ({ listId: (context as { listId: string }).listId }),
      false,
    );
    const request = new Request("https://app.test/_farm/sync", { method: "POST" });
    const context = { listId: "list-a" };

    const created: any = await executeSyncOperation({
      body: { model: "tasks", operation: "insert", input: { title: "round trip" } },
      models,
      orm,
      request,
      context,
    });
    expect(created).toMatchObject({ title: "round trip", listId: "list-a" });

    const listed: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models,
      orm,
      request,
      context,
    });
    expect(listed.rows).toHaveLength(1);
    // The mapped column round-tripped through generated ddl and back.
    expect(listed.rows[0].listId).toBe("list-a");
  });

  it("leaves an existing table alone and reports the difference", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec(`create table todo_items (id TEXT primary key, title TEXT, list_id TEXT)`);

    const owner = findSchemaTableOwners({ plugins: [plugin(database)] })[0]!;
    const logs: string[] = [];
    const result = await migrateSchemaTables(owner, {
      apply: true,
      log: (message) => logs.push(message),
    });

    expect(result.applied).toEqual([]);
    expect(logs.join("\n")).toContain("updated_at");
  });

  it("says there is nothing to do for a storage mount", async () => {
    const { createStorage } = await import("unstorage");
    const logs: string[] = [];

    const result = await migrateSchemaTables(
      findSchemaTableOwners({ plugins: [plugin(createStorage())] })[0]!,
      { log: (message) => logs.push(message) },
    );

    expect(result.applied).toEqual([]);
    expect(logs.join("\n")).toContain("no tables");
  });

  it("plans against the same models the plugin exposes", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const owner = findSchemaTableOwners({ plugins: [plugin(database)] })[0]!;

    const plan = await planSchemaMigration(collectOwnerModels(owner), "sqlite", {
      async execute(sql) {
        database.exec(sql);
      },
      async query(sql) {
        return database.prepare(sql).all() as Record<string, unknown>[];
      },
    });
    await applySchemaMigration(plan, {
      async execute(sql) {
        database.exec(sql);
      },
      async query(sql) {
        return database.prepare(sql).all() as Record<string, unknown>[];
      },
    });

    const present = database
      .prepare("select name from sqlite_master where type='table'")
      .all() as any[];
    // The unexposed model never becomes a table.
    expect(present.map((row) => row.name)).toContain("todo_items");
    expect(present.map((row) => row.name)).not.toContain("auditLog");
  });
});
