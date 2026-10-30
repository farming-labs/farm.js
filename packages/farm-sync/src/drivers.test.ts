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
        updatedAt: { type: "datetime" as const, name: "updated_at" },
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
  const { datetime, defineSchema, id, model, string } = await import("@farming-labs/orm");
  const { createOrmFromRuntime } = await import("@farming-labs/orm-runtime");

  const ormSchema = defineSchema({
    tasks: model({
      table: "tasks",
      fields: {
        id: id(),
        title: string(),
        status: string(),
        listId: string().map("list_id"),
        updatedAt: datetime().map("updated_at"),
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
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, list_id TEXT, updated_at TEXT)",
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

  it("stamps the cursor column so incremental sync advances", async () => {
    const orm = await makeOrm();
    const resolved = models();

    // Drivers write only the columns they are given, so sync has to stamp this
    // itself or `since` never moves and every load stays a full snapshot.
    const created: any = await executeSyncOperation({
      body: {
        model: "tasks",
        operation: "insert",
        // A client-supplied cursor must be ignored, not trusted.
        input: { id: "c1", title: "cursor", updatedAt: "1999-01-01T00:00:00.000Z" },
      },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(created.updatedAt).toBeTruthy();
    expect(new Date(created.updatedAt).getUTCFullYear()).toBeGreaterThan(2000);

    const first: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(first.cursor).toBeTruthy();
    expect(first.full).toBe(true);

    // Nothing changed since that cursor. The cursor row itself is resent (the
    // filter is inclusive so same-millisecond writes are not skipped) and the
    // client upserts it by key.
    const delta: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list", since: first.cursor },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(delta.full).toBe(false);
    expect(delta.rows.map((row: any) => row.id)).toEqual(["c1"]);
    expect(delta.cursor).toBe(first.cursor);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await executeSyncOperation({
      body: { model: "tasks", operation: "update", input: { id: "c1", title: "touched" } },
      models: resolved,
      orm,
      request,
      context,
    });

    const afterWrite: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list", since: first.cursor },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(afterWrite.rows).toHaveLength(1);
    expect(afterWrite.rows[0].title).toBe("touched");
  });

  it("lists the keys still in scope with a delta, so deletions reach synced clients", async () => {
    const orm = await makeOrm();
    const resolved = models();
    for (const [id, listId] of [
      ["k1", "list-a"],
      ["k2", "list-a"],
      ["k3", "list-b"],
    ]) {
      await executeSyncOperation({
        body: { model: "tasks", operation: "insert", input: { id, title: id } },
        models: resolved,
        orm,
        request,
        context: { listId },
      });
    }

    const first: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models: resolved,
      orm,
      request,
      context,
    });

    // Removed outside sync, straight through the database client.
    await orm.tasks!.deleteMany({ where: { id: "k2" } });

    const delta: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list", since: first.cursor },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(delta.full).toBe(false);
    expect(delta.keys).toEqual(["k1"]);
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

/**
 * Filters built from AND, OR, NOT, and operators. Every field such a filter
 * names stays server-owned, not just its top-level keys.
 */
const tenantSchema = {
  models: {
    tasks: {
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        title: { type: "string" as const, required: true },
        orgId: { type: "string" as const, name: "org_id" },
        ownerId: { type: "string" as const, name: "owner_id" },
        shared: { type: "boolean" as const },
      },
    },
  },
};

type Session = { org?: string; uid?: string };

async function tenantOrmFor(client: unknown): Promise<SyncOrmClient> {
  const { boolean, defineSchema, id, model, string } = await import("@farming-labs/orm");
  const { createOrmFromRuntime } = await import("@farming-labs/orm-runtime");
  const ormSchema = defineSchema({
    tasks: model({
      table: "tasks",
      fields: {
        id: id(),
        title: string(),
        orgId: string().map("org_id").nullable(),
        ownerId: string().map("owner_id").nullable(),
        shared: boolean().nullable(),
      },
    }),
  });
  return (await createOrmFromRuntime({ schema: ormSchema, client })) as unknown as SyncOrmClient;
}

const tenantModels = (where: (session: Session) => Record<string, unknown>) =>
  resolveSyncModels(
    tenantSchema as never,
    { tasks: "write" },
    ({ context }) => where(context as Session),
    false,
  );

const andFilter = tenantModels((s) => ({ AND: [{ orgId: s.org }, { ownerId: s.uid }] }));
const orFilter = tenantModels((s) => ({ OR: [{ ownerId: s.uid }, { shared: true }] }));
const mallory: Session = { org: "org-a", uid: "mallory" };
const bob: Session = { org: "org-b", uid: "bob" };

describe.each([
  [
    "unstorage",
    async () => {
      const { createStorage } = await import("unstorage");
      return tenantOrmFor(createStorage());
    },
  ],
  [
    "sqlite",
    async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const sqlite = new DatabaseSync(":memory:");
      sqlite.exec(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, org_id TEXT, owner_id TEXT, shared INTEGER)",
      );
      return tenantOrmFor(sqlite);
    },
  ],
])("combined row filters over the %s driver", (_name, makeOrm) => {
  const run = (
    orm: SyncOrmClient,
    resolved: ReturnType<typeof tenantModels>,
    context: Session,
    operation: "list" | "insert" | "update" | "delete",
    input?: Record<string, unknown>,
  ) =>
    executeSyncOperation({
      body: { model: "tasks", operation, input },
      models: resolved,
      orm,
      request,
      context,
    }) as Promise<any>;

  it("stamps an AND filter's columns on insert, ignoring the client's", async () => {
    const orm = await makeOrm();

    const planted = await run(orm, andFilter, mallory, "insert", {
      title: "planted",
      orgId: "org-b",
      ownerId: "bob",
    });
    expect(planted).toMatchObject({ orgId: "org-a", ownerId: "mallory" });
    expect((await run(orm, andFilter, bob, "list")).rows).toEqual([]);

    const plain = await run(orm, andFilter, mallory, "insert", { title: "plain" });
    expect(plain).toMatchObject({ orgId: "org-a", ownerId: "mallory" });
    expect((await run(orm, andFilter, mallory, "list")).rows).toHaveLength(2);
  });

  it("stamps an eq operator and nested AND the same as a plain value", async () => {
    const orm = await makeOrm();
    const resolved = tenantModels((s) => ({
      orgId: { eq: s.org },
      AND: [{ AND: [{ ownerId: s.uid }] }],
    }));

    const row = await run(orm, resolved, mallory, "insert", { title: "t", ownerId: "bob" });
    expect(row).toMatchObject({ orgId: "org-a", ownerId: "mallory" });
  });

  it("does not let an update move a row out of an AND filter", async () => {
    const orm = await makeOrm();
    await orm.tasks!.create({
      data: { id: "mine-1", title: "mine", orgId: "org-a", ownerId: "mallory" },
    });

    const moved = await run(orm, andFilter, mallory, "update", {
      id: "mine-1",
      title: "renamed",
      orgId: "org-b",
      ownerId: "bob",
    });
    expect(moved).toMatchObject({ title: "renamed", orgId: "org-a", ownerId: "mallory" });
    expect((await run(orm, andFilter, bob, "list")).rows).toEqual([]);
  });

  it("refuses inserts under an OR filter and writes nothing", async () => {
    const orm = await makeOrm();

    await expect(
      run(orm, orFilter, mallory, "insert", { title: "planted", ownerId: "bob" }),
    ).rejects.toMatchObject({ code: "server_error", status: 500, message: /uses OR/ });
    expect(await orm.tasks!.findMany({})).toEqual([]);
  });

  it("refuses inserts under NOT or a non-equality operator", async () => {
    const orm = await makeOrm();
    const notFilter = tenantModels((s) => ({ orgId: s.org, NOT: { ownerId: "banned" } }));
    const inFilter = tenantModels((s) => ({ ownerId: { in: [s.uid, "team"] } }));

    await expect(run(orm, notFilter, mallory, "insert", { title: "x" })).rejects.toMatchObject({
      code: "server_error",
    });
    await expect(run(orm, inFilter, mallory, "insert", { title: "x" })).rejects.toMatchObject({
      code: "server_error",
    });
    expect(await orm.tasks!.findMany({})).toEqual([]);
  });

  it("keeps every column an OR filter reads server-owned on update", async () => {
    const orm = await makeOrm();
    await orm.tasks!.create({
      data: { id: "shared-1", title: "shared", ownerId: "bob", shared: true },
    });
    await orm.tasks!.create({
      data: { id: "private-1", title: "private", ownerId: "bob", shared: false },
    });

    // A shared row is editable, but neither its owner nor its sharing can change.
    const edited = await run(orm, orFilter, mallory, "update", {
      id: "shared-1",
      title: "edited",
      ownerId: "mallory",
      shared: false,
    });
    expect(edited).toMatchObject({ title: "edited", ownerId: "bob", shared: true });

    await expect(
      run(orm, orFilter, mallory, "update", { id: "private-1", title: "hacked" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("row filters the drivers would silently drop", () => {
  const stubOrm = () => {
    const calls: unknown[] = [];
    const record = async (args: unknown) => {
      calls.push(args);
      return [];
    };
    const orm = {
      tasks: { findMany: record, create: record, update: record, deleteMany: record },
    } as unknown as SyncOrmClient;
    return { orm, calls };
  };
  const attempt = (where: (session: Session) => Record<string, unknown>, operation = "list") => {
    const { orm, calls } = stubOrm();
    const result = executeSyncOperation({
      body: { model: "tasks", operation: operation as "list", input: { title: "x" } },
      models: tenantModels(where),
      orm,
      request,
      context: {},
    });
    return { result, calls };
  };

  it.each([
    ["an undefined value", (s: Session) => ({ ownerId: s.uid })],
    [
      "an undefined value inside AND",
      (s: Session) => ({ AND: [{ orgId: "org-a" }, { ownerId: s.uid }] }),
    ],
    ["an undefined operator value", (s: Session) => ({ ownerId: { eq: s.uid } })],
    ["an undefined entry in an in list", (s: Session) => ({ ownerId: { in: ["a", s.uid] } })],
    ["a column name instead of a field", () => ({ owner_id: "mallory" })],
    ["an unknown field inside OR", () => ({ OR: [{ ownerId: "a" }, { owner: "a" }] })],
    ["an operator the orm does not know", () => ({ ownerId: { equals: "mallory" } })],
    ["an empty operator object", () => ({ ownerId: {} })],
    ["AND that is not a list", () => ({ AND: { ownerId: "a" } })],
  ])("refuses %s before querying", async (_label, where) => {
    for (const operation of ["list", "insert", "update", "delete"]) {
      const { result, calls } = attempt(where, operation);
      await expect(result).rejects.toMatchObject({ code: "server_error", status: 500 });
      expect(calls).toEqual([]);
    }
  });

  it("still accepts null as an equality value", async () => {
    const { result, calls } = attempt(() => ({ ownerId: null }));
    await expect(result).resolves.toMatchObject({ rows: [] });
    expect(calls).toEqual([{ where: { ownerId: null } }]);
  });
});
