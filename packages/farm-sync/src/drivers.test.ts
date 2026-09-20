// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executeSyncOperation, SyncOperationError, type SyncOrmClient } from "./server";
import { resolveSyncModels } from "./types";

/**
 * These run against the real `@farming-labs/orm` runtime rather than a stub, so
 * they prove the four methods sync calls exist with the shapes it expects —
 * including `deleteMany` returning a count and a scoped `update` returning null
 * when nothing matches, which is what the not_found path relies on.
 */

const farmSchema = {
  models: {
    tasks: {
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        title: { type: "string" as const, required: true },
        status: { type: "string" as const },
        listId: { type: "string" as const, required: true, name: "list_id" },
      },
    },
  },
};

const models = () =>
  resolveSyncModels(
    farmSchema as never,
    { tasks: "write" },
    ({ context }) => ({ listId: (context as { listId: string }).listId }),
    false,
  );

const request = new Request("https://app.test/_farm/sync", { method: "POST" });
const context = { listId: "list-a" };

async function ormFor(client: unknown): Promise<SyncOrmClient> {
  const { defineSchema, id, model, string } = await import("@farming-labs/orm");
  const { createOrmFromRuntime } = await import("@farming-labs/orm-runtime");

  const ormSchema = defineSchema({
    tasks: model({
      table: "tasks",
      fields: {
        id: id(),
        title: string(),
        status: string(),
        listId: string().map("list_id"),
      },
    }),
  });

  return (await createOrmFromRuntime({ schema: ormSchema, client })) as unknown as SyncOrmClient;
}

describe.each([
  [
    "unstorage",
    async () => {
      const { createStorage } = await import("unstorage");
      return ormFor(createStorage());
    },
  ],
  [
    "sqlite",
    async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const sqlite = new DatabaseSync(":memory:");
      sqlite.exec(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, list_id TEXT)",
      );
      return ormFor(sqlite);
    },
  ],
])("sync over the %s driver", (_name, makeOrm) => {
  it("round-trips every operation the runtime calls", async () => {
    const orm = await makeOrm();
    const resolved = models();

    const created: any = await executeSyncOperation({
      body: {
        model: "tasks",
        operation: "insert",
        input: { id: "t1", title: "real driver", status: "open" },
      },
      models: resolved,
      orm,
      request,
      context,
    });
    // The scope column is injected server side, not sent by the caller.
    expect(created).toMatchObject({ id: "t1", listId: "list-a" });

    const listed: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0].title).toBe("real driver");

    const updated: any = await executeSyncOperation({
      body: { model: "tasks", operation: "update", input: { id: "t1", status: "done" } },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(updated.status).toBe("done");

    const deleted: any = await executeSyncOperation({
      body: { model: "tasks", operation: "delete", input: { id: "t1" } },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(deleted).toEqual({ deleted: 1 });
  });

  it("cannot reach a row belonging to another scope", async () => {
    const orm = await makeOrm();
    const resolved = models();

    await executeSyncOperation({
      body: { model: "tasks", operation: "insert", input: { id: "theirs", title: "other" } },
      models: resolved,
      orm,
      request,
      context: { listId: "list-b" },
    });

    // Same row id, different caller: the filter is part of the query, so the
    // driver reports no match and sync turns that into not_found.
    await expect(
      executeSyncOperation({
        body: { model: "tasks", operation: "update", input: { id: "theirs", title: "hacked" } },
        models: resolved,
        orm,
        request,
        context,
      }),
    ).rejects.toThrow(SyncOperationError);

    await expect(
      executeSyncOperation({
        body: { model: "tasks", operation: "delete", input: { id: "theirs" } },
        models: resolved,
        orm,
        request,
        context,
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    // And it is still there for its real owner.
    const theirs: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models: resolved,
      orm,
      request,
      context: { listId: "list-b" },
    });
    expect(theirs.rows).toHaveLength(1);
  });
});
