// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import { defineSchema, type FarmSchema } from "../schema";
import { checkSchema } from "../schema-check";
import { renameSchema } from "../schema-rename";
import type { FarmSqlDialect } from "../schema-sql";
import type { FarmSchemaMigrationStep } from "../schema-step-types";
import { FARM_SCHEMA_STEPS_TABLE } from "../schema-steps";
import { findSchemaTableOwners, migrateSchemaTables } from "../schema-tables";

const requireModule = createRequire(import.meta.url);
const postgresTestUrl = process.env.FARM_TEST_POSTGRES_URL;
const mysqlTestUrl = process.env.FARM_TEST_MYSQL_URL;

if (process.env.FARM_REQUIRE_TEST_POSTGRES === "1" && !postgresTestUrl) {
  throw new Error("FARM_TEST_POSTGRES_URL is required when FARM_REQUIRE_TEST_POSTGRES=1.");
}

type TestDatabase = {
  dialect: FarmSqlDialect;
  client: unknown;
  run(sql: string): Promise<void>;
  rows(sql: string): Promise<Array<Record<string, unknown>>>;
  tables(): Promise<string[]>;
  quote(name: string): string;
  close(): Promise<void>;
};

async function sqliteDatabase(): Promise<TestDatabase> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  const rows = async (sql: string) => database.prepare(sql).all() as Array<Record<string, unknown>>;
  return {
    dialect: "sqlite",
    client: database,
    async run(sql) {
      database.exec(sql);
    },
    rows,
    async tables() {
      return (await rows("select name from sqlite_master where type = 'table'")).map((row) =>
        String(row.name),
      );
    },
    quote: (name) => `"${name}"`,
    async close() {
      database.close();
    },
  };
}

async function postgresDatabase(): Promise<TestDatabase> {
  const { Client } = requireModule("pg") as {
    Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>;
      query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
      end(): Promise<void>;
    };
  };
  // A schema of its own: the state table is shared by name, so tests must not see each other's.
  const client = new Client({ connectionString: postgresTestUrl! });
  await client.connect();
  const schema = unique("steps");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const rows = async (sql: string) => (await client.query(sql)).rows;
  return {
    dialect: "postgres",
    client,
    async run(sql) {
      await client.query(sql);
    },
    rows,
    async tables() {
      return (
        await rows(
          "select table_name from information_schema.tables where table_schema = current_schema()",
        )
      ).map((row) => String(row.table_name));
    },
    quote: (name) => `"${name}"`,
    async close() {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    },
  };
}

async function mysqlDatabase(): Promise<TestDatabase> {
  const mysql = requireModule("mysql2/promise") as {
    createConnection(url: string): Promise<{
      query(sql: string): Promise<[Array<Record<string, unknown>>, unknown]>;
      end(): Promise<void>;
    }>;
  };
  // A database of its own, for the same reason as the Postgres schema.
  const admin = await mysql.createConnection(mysqlTestUrl!);
  const name = unique("steps");
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(mysqlTestUrl!);
  url.pathname = `/${name}`;
  const connection = await mysql.createConnection(url.toString());
  const rows = async (sql: string) => (await connection.query(sql))[0];
  return {
    dialect: "mysql",
    client: connection,
    async run(sql) {
      await connection.query(sql);
    },
    rows,
    async tables() {
      return (
        await rows(
          "select table_name as name from information_schema.tables where table_schema = database()",
        )
      ).map((row) => String(row.name));
    },
    quote: (value) => `\`${value}\``,
    async close() {
      await connection.query(`DROP DATABASE \`${name}\``);
      await connection.end();
    },
  };
}

const databases: Array<[string, () => Promise<TestDatabase>]> = [
  ["sqlite", sqliteDatabase],
  ...(postgresTestUrl
    ? [["postgres", postgresDatabase] as [string, () => Promise<TestDatabase>]]
    : []),
  ...(mysqlTestUrl ? [["mysql", mysqlDatabase] as [string, () => Promise<TestDatabase>]] : []),
];

let counter = 0;
const unique = (name: string) =>
  `farm_steps_${name}_${process.pid}_${Date.now() % 100000}_${counter++}`;

/** teams 1.0.0 stores a role; 2.0.0 calls it permission. */
const v1 = defineSchema({
  models: {
    member: {
      fields: {
        id: { type: "string", primaryKey: true },
        name: { type: "string", nullable: true },
        role: { type: "string", default: "member" },
      },
    },
  },
});
const v2 = defineSchema({
  models: {
    member: {
      fields: {
        id: { type: "string", primaryKey: true },
        name: { type: "string", nullable: true },
        permission: { type: "string", default: "member" },
      },
    },
  },
});
const renameRole: FarmSchemaMigrationStep = {
  id: "2.0.0-role-to-permission",
  renameColumn: { model: "member", from: "role", to: "permission" },
};

describe.each(databases)("migration steps on %s", (_name, open) => {
  const opened: TestDatabase[] = [];
  afterAll(async () => {
    for (const db of opened) await db.close();
  });

  async function database() {
    const db = await open();
    opened.push(db);
    return db;
  }

  function teams(
    db: TestDatabase,
    schema: FarmSchema,
    version: string,
    migrations?: FarmSchemaMigrationStep[],
    extensions?: "report",
  ) {
    const config = {
      plugins: [definePlugin({ name: "farm:teams", version, schema, migrations })],
      storage: { client: db.client },
    };
    const owner = findSchemaTableOwners(config)[0]!;
    const messages: string[] = [];
    const migrate = (apply = false) =>
      migrateSchemaTables(owner, {
        config,
        apply,
        extensions,
        log: (message) => messages.push(message),
      });
    return { config, migrate, messages };
  }

  async function installV1(db: TestDatabase) {
    await teams(db, v1, "1.0.0").migrate(true);
    const q = db.quote;
    await db.run(
      `INSERT INTO ${q("member")} (${q("id")}, ${q("name")}, ${q("role")}) VALUES ('m1', 'Ada', 'admin')`,
    );
  }

  const columns = async (db: TestDatabase, table: string) =>
    Object.keys((await db.rows(`SELECT * FROM ${db.quote(table)}`))[0] ?? {});

  it("renames a column, keeping its data, instead of adding an empty one", async () => {
    const db = await database();
    await installV1(db);
    const upgrade = teams(db, v2, "2.0.0", [renameRole]);

    const printed = await upgrade.migrate();
    expect(upgrade.messages[0]).toBe(
      [
        "teams 1.0.0 → 2.0.0 changes its tables:",
        "  1. rename member.role → member.permission",
      ].join("\n"),
    );
    // The rename explains the new column, so it is not added on its own.
    expect(printed.plan.upgrades ?? []).toEqual([]);
    expect(printed.sql).toMatch(/RENAME COLUMN .role. TO .permission./u);
    expect(printed.planned).toBe(1);
    expect((await checkSchema(upgrade.config)).issues).toEqual([
      expect.objectContaining({ code: "migration-step-pending", severity: "warning" }),
    ]);

    const applied = await upgrade.migrate(true);
    expect(applied.steps.ran).toEqual(["2.0.0-role-to-permission"]);
    expect(await db.rows(`SELECT * FROM ${db.quote("member")}`)).toEqual([
      expect.objectContaining({ id: "m1", permission: "admin" }),
    ]);
    expect(await columns(db, "member")).not.toContain("role");

    // Once only.
    const again = teams(db, v2, "2.0.0", [renameRole]);
    const settled = await again.migrate(true);
    expect(settled.steps.ran).toEqual([]);
    expect(again.messages).toContain("Nothing to create.");
    expect((await checkSchema(again.config)).issues).toEqual([]);
  });

  it("points at a likely rename the plugin forgot to ship a step for", async () => {
    const db = await database();
    await installV1(db);
    const upgrade = teams(db, v2, "2.0.0");
    await upgrade.migrate();
    expect(upgrade.messages[0]).toContain(
      "? if member.role was renamed to member.permission, the plugin needs a migration step, or the data stays in role",
    );
  });

  it("runs nothing on a fresh install: the tables already have every step's effect", async () => {
    const db = await database();
    const install = teams(db, v2, "2.0.0", [renameRole]);
    const result = await install.migrate(true);
    expect(result.applied).toEqual(["member"]);
    expect(result.steps.ran).toEqual(["2.0.0-role-to-permission"]);
    expect(
      await db.rows(`SELECT ${db.quote("id")} FROM ${db.quote(FARM_SCHEMA_STEPS_TABLE)}`),
    ).toEqual([{ id: "2.0.0-role-to-permission" }]);
    expect((await checkSchema(install.config)).issues).toEqual([]);
  });

  it("renames a table on an old install instead of creating an empty new one", async () => {
    const db = await database();
    const old = defineSchema({
      models: { member: { name: "members", fields: { id: { type: "string", primaryKey: true } } } },
    });
    await teams(db, old, "1.0.0").migrate(true);
    await db.run(`INSERT INTO ${db.quote("members")} (${db.quote("id")}) VALUES ('m1')`);
    const current = defineSchema({
      models: {
        member: { name: "team_member", fields: { id: { type: "string", primaryKey: true } } },
      },
    });
    const result = await teams(db, current, "2.0.0", [
      { id: "2.0.0-members-table", renameTable: { from: "members", to: "member" } },
    ]).migrate(true);
    expect(result.steps.ran).toEqual(["2.0.0-members-table"]);
    expect(result.applied).toEqual([]);
    expect(await db.rows(`SELECT * FROM ${db.quote("team_member")}`)).toEqual([{ id: "m1" }]);
  });

  it("records a rename someone already did by hand, without running it", async () => {
    const db = await database();
    await installV1(db);
    await db.run(
      `ALTER TABLE ${db.quote("member")} RENAME COLUMN ${db.quote("role")} TO ${db.quote("permission")}`,
    );
    const result = await teams(db, v2, "2.0.0", [renameRole]).migrate(true);
    expect(result.steps.plan!.steps[0]).toMatchObject({ state: "record" });
    expect(result.steps.ran).toEqual(["2.0.0-role-to-permission"]);
    expect(await db.rows(`SELECT * FROM ${db.quote("member")}`)).toEqual([
      expect.objectContaining({ permission: "admin" }),
    ]);
  });

  it("stops at a step that would lose data, and holds the later ones", async () => {
    const db = await database();
    await installV1(db);
    // An earlier upgrade without the step already added an empty permission.
    await db.run(
      `ALTER TABLE ${db.quote("member")} ADD COLUMN ${db.quote("permission")} VARCHAR(32)`,
    );
    const later: FarmSchemaMigrationStep = {
      id: "2.0.0-backfill",
      description: "backfill names",
      sql: Object.fromEntries(
        (["postgres", "mysql", "sqlite"] as const).map((dialect) => [
          dialect,
          `UPDATE ${db.quote("member")} SET ${db.quote("name")} = 'x'`,
        ]),
      ),
    };
    const upgrade = teams(db, v2, "2.0.0", [renameRole, later]);
    const result = await upgrade.migrate(true);
    expect(result.steps.ran).toEqual([]);
    expect(result.steps.pending).toEqual(["2.0.0-role-to-permission", "2.0.0-backfill"]);
    expect(upgrade.messages.join("\n")).toContain(
      'Stopped at migration step "2.0.0-role-to-permission"',
    );
    expect((await db.rows(`SELECT * FROM ${db.quote("member")}`))[0]).toMatchObject({
      name: "Ada",
      role: "admin",
    });
    expect((await checkSchema(upgrade.config)).issues).toContainEqual(
      expect.objectContaining({
        code: "migration-step-blocked",
        severity: "error",
        message: expect.stringContaining('both "role" and "permission" exist'),
      }),
    );
  });

  it("runs custom SQL after this release's new columns exist, so it can fill them", async () => {
    const db = await database();
    await installV1(db);
    const withDisplay = defineSchema({
      models: {
        member: {
          fields: { ...v1.models.member.fields, display: { type: "string", nullable: true } },
        },
      },
    });
    const q = db.quote;
    const backfill: FarmSchemaMigrationStep = {
      id: "1.1.0-display",
      description: "fill display from name",
      sql: Object.fromEntries(
        (["postgres", "mysql", "sqlite"] as const).map((dialect) => [
          dialect,
          `UPDATE ${q("member")} SET ${q("display")} = ${q("name")} WHERE ${q("display")} IS NULL`,
        ]),
      ),
    };
    const result = await teams(db, withDisplay, "1.1.0", [backfill]).migrate(true);
    expect(result.applied).toEqual(["member.display"]);
    expect(result.steps.ran).toEqual(["1.1.0-display"]);
    expect((await db.rows(`SELECT * FROM ${q("member")}`))[0]).toMatchObject({ display: "Ada" });
  });

  it("holds a custom step that has no SQL for this database", async () => {
    const db = await database();
    await installV1(db);
    const other = (["postgres", "mysql", "sqlite"] as const).find(
      (dialect) => dialect !== db.dialect,
    )!;
    const result = await teams(db, v1, "1.0.1", [
      { id: "1.0.1-elsewhere", sql: { [other]: "SELECT 1" } },
    ]).migrate(true);
    expect(result.steps.pending).toEqual(["1.0.1-elsewhere"]);
    expect(result.steps.plan!.steps[0]!.reason).toBe(`it has no SQL for ${db.dialect}.`);
  });

  it("rolls a failed step back where the database allows it", async () => {
    const db = await database();
    await installV1(db);
    const q = db.quote;
    const failing: FarmSchemaMigrationStep = {
      id: "1.0.1-half",
      sql: Object.fromEntries(
        (["postgres", "mysql", "sqlite"] as const).map((dialect) => [
          dialect,
          [
            `UPDATE ${q("member")} SET ${q("name")} = 'changed'`,
            `UPDATE ${q("no_such_table")} SET x = 1`,
          ],
        ]),
      ),
    };
    await expect(teams(db, v1, "1.0.1", [failing]).migrate(true)).rejects.toThrow();
    const [row] = await db.rows(`SELECT * FROM ${q("member")}`);
    // MySQL commits each statement; Postgres and SQLite undo the whole step.
    expect(row).toMatchObject({ name: db.dialect === "mysql" ? "changed" : "Ada" });
    // Not recorded either way, so it is offered again.
    const next = await teams(db, v1, "1.0.1", [failing]).migrate();
    expect(next.steps.pending).toEqual(["1.0.1-half"]);
  });

  it("notices a step edited after it ran, and does not run it again", async () => {
    const db = await database();
    await installV1(db);
    await teams(db, v2, "2.0.0", [renameRole]).migrate(true);
    const edited = teams(db, v2, "2.0.1", [
      { ...renameRole, renameColumn: { model: "member", from: "roles", to: "permission" } },
    ]);
    const result = await edited.migrate(true);
    expect(result.steps.ran).toEqual([]);
    expect(edited.messages.join("\n")).toContain(
      'Migration step "2.0.0-role-to-permission" changed after it ran here.',
    );
    expect((await checkSchema(edited.config)).issues).toContainEqual(
      expect.objectContaining({ code: "migration-step-edited" }),
    );
  });

  it("follows the app's renames", async () => {
    const db = await database();
    const renames = { member: { name: "team_members" } } as const;
    await teams(db, renameSchema(v1, renames), "1.0.0").migrate(true);
    const result = await teams(
      db,
      renameSchema(v2, { member: { name: "team_members", fields: { permission: "perm" } } }),
      "2.0.0",
      [renameRole],
    ).migrate(true);
    expect(result.steps.ran).toEqual(["2.0.0-role-to-permission"]);
    const described = await db.rows(
      db.dialect === "sqlite"
        ? `PRAGMA table_info("team_members")`
        : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'team_members' AND table_schema = ${db.dialect === "mysql" ? "database()" : "current_schema()"}`,
    );
    expect(described.map((row) => String(row.name ?? row.NAME))).toContain("perm");
  });

  it("prints the steps, and runs nothing, where an ORM owns the tables", async () => {
    const db = await database();
    await installV1(db);
    const upgrade = teams(db, v2, "2.0.0", [renameRole], "report");
    const result = await upgrade.migrate(true);
    expect(result.steps.ran).toEqual([]);
    expect(result.sql).toMatch(/-- ALTER TABLE .+ RENAME COLUMN/u);
    expect(result.sql).toContain("add the steps to its migrations instead");
    expect(await columns(db, "member")).toContain("role");
  });
});

describe("migration steps while the config loads", () => {
  it("rejects steps that cannot work", () => {
    const attempt =
      (migrations: unknown, schema: FarmSchema | undefined = v2) =>
      () =>
        definePlugin({ name: "farm:teams", schema, migrations: migrations as never });
    expect(attempt([renameRole, renameRole])).toThrow(/two migration steps share the id/);
    expect(attempt([{ id: "x", renameColumn: { model: "nope", from: "a", to: "b" } }])).toThrow(
      /"nope", which is not a model/,
    );
    expect(
      attempt([{ id: "x", renameColumn: { model: "member", from: "a", to: "nope" } }]),
    ).toThrow(/"member.nope", which is not a field/);
    expect(attempt([{ id: "x", sql: {} }])).toThrow(/needs SQL for at least one/);
    expect(attempt([{ id: "", sql: { sqlite: "SELECT 1" } }])).toThrow(/non-empty `id`/);
    expect(
      attempt([{ id: "x", sql: { sqlite: "SELECT 1" }, renameTable: { from: "a", to: "member" } }]),
    ).toThrow(/exactly one of/);
    // Without a schema at all: undefined would pick up the default above.
    expect(() => definePlugin({ name: "farm:teams", migrations: [renameRole] as never })).toThrow(
      /sets `migrations` without a `schema`/,
    );
  });
});
