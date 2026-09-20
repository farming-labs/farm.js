// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateSyncDdl, type SyncDialect } from "./ddl";
import {
  applySyncMigration,
  formatSyncMigration,
  planSyncMigration,
  type SyncMigrateExecutor,
} from "./migrate";
import { executeSyncOperation } from "./server";
import { resolveSyncModels } from "./types";

const schema = {
  models: {
    tasks: {
      name: "todo_items",
      fields: {
        id: { type: "uuid" as const, primaryKey: true },
        title: { type: "string" as const, required: true },
        status: { type: "enum" as const, values: ["open", "done"], default: "open" },
        priority: { type: "integer" as const, default: 0 },
        listId: { type: "string" as const, required: true, index: true, name: "list_id" },
        slug: { type: "string" as const, unique: true },
        updatedAt: { type: "datetime" as const, name: "updated_at" },
      },
      constraints: [{ type: "index" as const, fields: ["listId", "status"] }],
    },
  },
};

const models = () =>
  resolveSyncModels(
    schema as never,
    { tasks: "write" },
    ({ context }) => ({ listId: (context as { listId: string }).listId }),
    false,
  );

describe("ddl generation", () => {
  it("uses the mapped table and column names, not the model keys", () => {
    const sql = generateSyncDdl(models(), "postgres")
      .map((statement) => statement.sql)
      .join("\n");

    expect(sql).toContain('create table if not exists "todo_items"');
    expect(sql).toContain('"list_id"');
    expect(sql).toContain('"updated_at"');
    expect(sql).not.toContain('"listId"'); // the schema key never reaches sql
  });

  it("carries primary key, not null, defaults, and unique across", () => {
    const [table] = generateSyncDdl(models(), "postgres");

    expect(table!.sql).toContain('"id" uuid primary key');
    expect(table!.sql).toContain('"title" text not null');
    expect(table!.sql).toContain("default 'open'");
    expect(table!.sql).toContain('"priority" integer default 0');
    expect(table!.sql).toContain('unique ("slug")');
  });

  it("emits an index per indexed field and per declared constraint", () => {
    const indexes = generateSyncDdl(models(), "postgres").filter(
      (statement) => statement.kind === "index",
    );

    expect(indexes.map((statement) => statement.target)).toEqual([
      "todo_items_list_id_idx",
      "todo_items_list_id_status_idx",
    ]);
  });

  it.each([
    ["postgres", "uuid", "timestamptz", '"todo_items"'],
    ["sqlite", "TEXT", "TEXT", '"todo_items"'],
    ["mysql", "char(36)", "datetime", "`todo_items`"],
  ] as Array<[SyncDialect, string, string, string]>)(
    "maps types and quoting for %s",
    (dialect, idType, dateType, quotedTable) => {
      const [table] = generateSyncDdl(models(), dialect);

      expect(table!.sql).toContain(quotedTable);
      expect(table!.sql).toContain(idType);
      expect(table!.sql).toContain(dateType);
    },
  );

  it("rejects a field type it cannot map instead of emitting broken sql", () => {
    const broken = resolveSyncModels(
      {
        models: {
          tasks: { fields: { id: { type: "uuid", primaryKey: true }, odd: { type: "geometry" } } },
        },
      } as never,
      { tasks: "read" },
      false,
      false,
    );

    expect(() => generateSyncDdl(broken, "postgres")).toThrow(/unsupported type "geometry"/);
  });
});

/** An executor over an in-memory sqlite database. */
async function sqliteExecutor() {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  const executor: SyncMigrateExecutor = {
    async execute(sql) {
      database.exec(sql);
    },
    async query(sql) {
      return database.prepare(sql).all() as Record<string, unknown>[];
    },
  };
  return { database, executor };
}

describe("migration planning", () => {
  it("plans a create for a table that does not exist", async () => {
    const { executor } = await sqliteExecutor();
    const plan = await planSyncMigration(models(), "sqlite", executor);

    expect(plan.statements.length).toBeGreaterThan(0);
    expect(plan.upToDate).toEqual([]);
    expect(plan.drift).toEqual([]);
  });

  it("plans nothing once the table matches the schema", async () => {
    const { executor } = await sqliteExecutor();
    await applySyncMigration(await planSyncMigration(models(), "sqlite", executor), executor);

    const second = await planSyncMigration(models(), "sqlite", executor);
    expect(second.statements).toEqual([]);
    expect(second.upToDate).toEqual(["todo_items"]);
    expect(second.drift).toEqual([]);
  });

  it("reports a differing table instead of altering it", async () => {
    const { database, executor } = await sqliteExecutor();
    // A table that predates a schema change: one column missing, one extra.
    database.exec(
      `create table todo_items (id TEXT primary key, title TEXT, list_id TEXT, legacy_note TEXT)`,
    );

    const plan = await planSyncMigration(models(), "sqlite", executor);

    expect(plan.statements).toEqual([]); // nothing is emitted for it
    expect(plan.drift).toHaveLength(1);
    expect(plan.drift[0]!.missingColumns).toEqual(
      expect.arrayContaining(["status", "priority", "slug", "updated_at"]),
    );
    expect(plan.drift[0]!.extraColumns).toEqual(["legacy_note"]);

    const applied = await applySyncMigration(plan, executor);
    expect(applied.applied).toEqual([]);
    expect(applied.skipped).toHaveLength(1);

    // The pre-existing column is untouched.
    const columns = await executor.query("pragma table_info('todo_items')");
    expect(columns.map((row) => row.name)).toContain("legacy_note");
  });

  it("renders a reviewable file, including when there is nothing to do", async () => {
    const { executor } = await sqliteExecutor();
    const plan = await planSyncMigration(models(), "sqlite", executor);

    const sql = formatSyncMigration(plan);
    expect(sql).toContain("Generated by `farm sync migrate`");
    expect(sql).toContain("create table if not exists");

    await applySyncMigration(plan, executor);
    const empty = formatSyncMigration(await planSyncMigration(models(), "sqlite", executor));
    expect(empty).toContain("Nothing to create");
  });
});

describe("generated ddl against a real database", () => {
  it("produces a table sync can actually read and write", async () => {
    const { database, executor } = await sqliteExecutor();
    const resolved = models();

    await applySyncMigration(await planSyncMigration(resolved, "sqlite", executor), executor);

    // Drive the real orm over the database the generated ddl just created.
    const { datetime, defineSchema, id, integer, model, string } =
      await import("@farming-labs/orm");
    const { createOrmFromRuntime } = await import("@farming-labs/orm-runtime");
    const orm = (await createOrmFromRuntime({
      schema: defineSchema({
        tasks: model({
          table: "todo_items",
          fields: {
            id: id(),
            title: string(),
            status: string(),
            priority: integer(),
            listId: string().map("list_id"),
            slug: string(),
            updatedAt: datetime().map("updated_at"),
          },
        }),
      }),
      client: database,
    })) as never;

    const request = new Request("https://app.test/_farm/sync", { method: "POST" });
    const context = { listId: "list-a" };

    const created: any = await executeSyncOperation({
      body: { model: "tasks", operation: "insert", input: { title: "round trip" } },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(created).toMatchObject({ title: "round trip", listId: "list-a" });

    const listed: any = await executeSyncOperation({
      body: { model: "tasks", operation: "list" },
      models: resolved,
      orm,
      request,
      context,
    });
    expect(listed.rows).toHaveLength(1);
    // The mapped column round-tripped through generated ddl and back.
    expect(listed.rows[0].listId).toBe("list-a");
  });
});

describe("migrateFarmSync through a configured plugin", () => {
  async function appWith(client: unknown) {
    const { sync } = await import("./index");
    const plugin = sync({
      schema: schema as never,
      client: () => client,
      models: { tasks: "write" },
      where: ({ context }) => ({ listId: (context as { listId: string }).listId }),
    });
    return [plugin];
  }

  it("creates the tables an app's schema needs, then reports it is up to date", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const { migrateFarmSync } = await import("./internal");
    const plugins = await appWith(database);
    const logs: string[] = [];

    const first = await migrateFarmSync({ plugins, apply: true, log: (m) => logs.push(m) });
    expect(first.applied).toContain("todo_items");

    // The table really exists now, with the mapped column names.
    const columns = database.prepare("pragma table_info('todo_items')").all() as any[];
    expect(columns.map((row) => row.name)).toEqual(
      expect.arrayContaining(["id", "title", "list_id", "updated_at"]),
    );

    const second = await migrateFarmSync({ plugins, apply: true, log: (m) => logs.push(m) });
    expect(second.applied).toEqual([]);
    expect(logs.join("\n")).toContain("Already up to date");
  });

  it("prints sql without touching the database unless asked", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const { migrateFarmSync } = await import("./internal");

    const result = await migrateFarmSync({ plugins: await appWith(database) });

    expect(result.sql).toContain("create table if not exists");
    expect(result.applied).toEqual([]);
    const tables = database
      .prepare("select name from sqlite_master where type='table'")
      .all() as any[];
    expect(tables.map((row) => row.name)).not.toContain("todo_items");
  });

  it("reports nothing to do for a storage mount", async () => {
    const { createStorage } = await import("unstorage");
    const { migrateFarmSync } = await import("./internal");
    const logs: string[] = [];

    const result = await migrateFarmSync({
      plugins: await appWith(createStorage()),
      log: (m) => logs.push(m),
    });

    expect(result.applied).toEqual([]);
    expect(logs.join("\n")).toContain("no tables");
  });

  it("fails clearly when no sync plugin is configured", async () => {
    const { migrateFarmSync } = await import("./internal");
    await expect(migrateFarmSync({ plugins: [] })).rejects.toThrow(/No sync\(\) plugin/);
  });
});
