import { describe, expect, it } from "vitest";
import { executeSyncOperation, SyncOperationError, type SyncOrmClient } from "./server";
import { resolveSyncModels } from "./types";

const schema = {
  models: {
    tasks: {
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        title: { type: "string" as const, required: true },
        status: { type: "enum" as const, values: ["open", "done"] },
        listId: { type: "string" as const, required: true },
        updatedAt: { type: "datetime" as const },
      },
    },
    secrets: {
      fields: { id: { type: "uuid" as const, primaryKey: true } },
    },
  },
};

function makeOrm(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ op: string; args: unknown }> = [];
  const store = [...rows];
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([field, expected]: [string, any]) =>
      expected && typeof expected === "object" && "gt" in expected
        ? new Date(row[field]).getTime() > new Date(expected.gt).getTime()
        : row[field] === expected,
    );

  const orm: SyncOrmClient = {
    tasks: {
      async findMany(args) {
        calls.push({ op: "findMany", args });
        return store.filter((row) => matches(row, (args as any)?.where));
      },
      async create({ data }) {
        calls.push({ op: "create", args: data });
        store.push(data);
        return data;
      },
      async update({ where, data }) {
        calls.push({ op: "update", args: { where, data } });
        const row = store.find((entry) => matches(entry, where));
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
      async deleteMany({ where }) {
        calls.push({ op: "deleteMany", args: where });
        const removed = store.filter((row) => matches(row, where));
        for (const row of removed) store.splice(store.indexOf(row), 1);
        return removed.length;
      },
    },
  };
  return { orm, calls, store };
}

const request = new Request("https://app.test/_farm/sync", { method: "POST" });

function models(overrides: Record<string, any> = { tasks: "write" }) {
  return resolveSyncModels(
    schema as any,
    overrides,
    ({ context }) => ({ listId: (context as any).listId }),
    true,
  );
}

describe("resolveSyncModels", () => {
  it("derives the primary key and cursor field from the schema", () => {
    const resolved = models().get("tasks")!;
    expect(resolved.key).toBe("id");
    expect(resolved.cursorField).toBe("updatedAt");
    expect(resolved.access).toBe("write");
  });

  it("rejects a writable model with no row filter", () => {
    expect(() => resolveSyncModels(schema as any, { tasks: "write" }, undefined, true)).toThrow(
      /no row filter is configured/,
    );
  });

  it("allows an explicit unscoped model", () => {
    const resolved = resolveSyncModels(
      schema as any,
      { tasks: { access: "write", where: false } },
      undefined,
      true,
    );
    expect(resolved.get("tasks")!.where).toBe(false);
  });

  it("rejects models that are not in the schema", () => {
    expect(() => resolveSyncModels(schema as any, { ghosts: "read" }, false, true)).toThrow(
      /not in the schema/,
    );
  });

  it("skips models set to false", () => {
    const resolved = resolveSyncModels(schema as any, { tasks: false }, false, true);
    expect(resolved.size).toBe(0);
  });
});

describe("executeSyncOperation", () => {
  const context = { listId: "list-a" };

  it("scopes list queries to the row filter", async () => {
    const { orm, calls } = makeOrm([
      { id: "1", title: "mine", listId: "list-a", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "2", title: "theirs", listId: "list-b", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const result: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models: models(),
      orm,
      request,
      context,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe("mine");
    expect((calls[0]!.args as any).where).toEqual({ listId: "list-a" });
    expect(result.full).toBe(true);
    expect(result.cursor).toBe("2026-01-01T00:00:00.000Z");
  });

  it("sends only changed rows when given a cursor", async () => {
    const { orm } = makeOrm([
      { id: "1", title: "old", listId: "list-a", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "2", title: "new", listId: "list-a", updatedAt: "2026-02-01T00:00:00.000Z" },
    ]);

    const result: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list", since: "2026-01-15T00:00:00.000Z" },
      models: models(),
      orm,
      request,
      context,
    });

    expect(result.rows.map((row: any) => row.title)).toEqual(["new"]);
    expect(result.full).toBe(false);
  });

  it("injects scope columns on insert and ignores client-supplied ones", async () => {
    const { orm, store } = makeOrm();

    await executeSyncOperation({
      body: {
        model: "tasks",
        operation: "insert",
        input: { id: "9", title: "x", listId: "list-HIJACK", bogus: 1 },
      },
      models: models(),
      orm,
      request,
      context,
    });

    expect(store[0]).toMatchObject({ id: "9", title: "x", listId: "list-a" });
    expect(store[0]).not.toHaveProperty("bogus"); // unknown columns dropped
  });

  it("cannot update a row outside the caller's scope", async () => {
    const { orm, store } = makeOrm([{ id: "1", title: "theirs", listId: "list-b" }]);

    await expect(
      executeSyncOperation({
        body: { model: "tasks", operation: "update", input: { id: "1", title: "hacked" } },
        models: models(),
        orm,
        request,
        context,
      }),
    ).rejects.toThrow(SyncOperationError);

    expect(store[0]!.title).toBe("theirs");
  });

  it("cannot delete a row outside the caller's scope", async () => {
    const { orm, store } = makeOrm([{ id: "1", title: "theirs", listId: "list-b" }]);

    await expect(
      executeSyncOperation({
        body: { model: "tasks", operation: "delete", input: { id: "1" } },
        models: models(),
        orm,
        request,
        context,
      }),
    ).rejects.toThrow(/No tasks row matched/);
    expect(store).toHaveLength(1);
  });

  it("refuses writes to a read-only model", async () => {
    const { orm } = makeOrm();
    await expect(
      executeSyncOperation({
        body: { model: "tasks", operation: "insert", input: { title: "x" } },
        models: models({ tasks: "read" }),
        orm,
        request,
        context,
      }),
    ).rejects.toMatchObject({ code: "read_only" });
  });

  it("refuses any operation on a model that is not exposed", async () => {
    const { orm } = makeOrm();
    await expect(
      executeSyncOperation({
        body: { model: "secrets", operation: "list" },
        models: models(),
        orm,
        request,
        context,
      }),
    ).rejects.toMatchObject({ code: "not_exposed" });
  });

  it("requires the key for update and delete", async () => {
    const { orm } = makeOrm();
    await expect(
      executeSyncOperation({
        body: { model: "tasks", operation: "update", input: { title: "x" } },
        models: models(),
        orm,
        request,
        context,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("never lets an update rewrite the primary key", async () => {
    const { orm, store } = makeOrm([{ id: "1", title: "mine", listId: "list-a" }]);

    await executeSyncOperation({
      body: { model: "tasks", operation: "update", input: { id: "1", title: "renamed" } },
      models: models(),
      orm,
      request,
      context,
    });

    expect(store[0]).toMatchObject({ id: "1", title: "renamed" });
  });
});

describe("key generation on insert", () => {
  const context = { listId: "list-a" };

  it("generates a key when the client omits one", async () => {
    const { orm, store } = makeOrm();

    const created: any = await executeSyncOperation({
      body: { model: "tasks", operation: "insert", input: { title: "no id supplied" } },
      models: models(),
      orm,
      request,
      context,
    });

    expect(typeof created.id).toBe("string");
    expect(created.id).not.toHaveLength(0);
    // The row must be addressable afterwards.
    expect(store[0]!.id).toBe(created.id);
  });

  it("keeps a client-supplied key so optimistic rows stay addressable", async () => {
    const { orm } = makeOrm();

    const created: any = await executeSyncOperation({
      body: { model: "tasks", operation: "insert", input: { id: "client-key", title: "x" } },
      models: models(),
      orm,
      request,
      context,
    });

    expect(created.id).toBe("client-key");
  });
});
