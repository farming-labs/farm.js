// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import { defineSchema, type FarmSchema } from "../schema";
import { checkSchema } from "../schema-check";
import type { FarmSqlDialect } from "../schema-sql";
import type { FarmSchemaMigrationStep } from "../schema-step-types";
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
  const schema = unique("drop");
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
  const name = unique("drop");
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
  `farm_drop_${name}_${process.pid}_${Date.now() % 100000}_${counter++}`;

/** teams 1.0.0 has a legacy column and an audit table; 2.0.0 has neither. */
const v1 = defineSchema({
  models: {
    member: {
      fields: {
        id: { type: "string", primaryKey: true },
        legacyNote: { type: "string", nullable: true },
      },
    },
    audit: { name: "teams_audit", fields: { id: { type: "string", primaryKey: true } } },
  },
});
const v2 = defineSchema({
  models: { member: { fields: { id: { type: "string", primaryKey: true } } } },
});
const dropNote: FarmSchemaMigrationStep = {
  id: "2.0.0-drop-note",
  dropColumn: { model: "member", column: "legacyNote" },
};
const dropAudit: FarmSchemaMigrationStep = {
  id: "2.0.0-drop-audit",
  dropTable: { table: "teams_audit" },
};

describe.each(databases)("destructive migration steps on %s", (_name, open) => {
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
    extra: unknown[] = [],
  ) {
    const config = {
      plugins: [definePlugin({ name: "farm:teams", version, schema, migrations }), ...extra],
      storage: { client: db.client },
    };
    const owner = findSchemaTableOwners(config).find((candidate) => candidate.name === "teams")!;
    const messages: string[] = [];
    const migrate = (options: { apply?: boolean; allowDestructive?: boolean } = {}) =>
      migrateSchemaTables(owner, {
        config,
        ...options,
        log: (message) => messages.push(message),
      });
    return { config, migrate, messages };
  }

  async function installV1(db: TestDatabase) {
    await teams(db, v1, "1.0.0").migrate({ apply: true });
    const q = db.quote;
    await db.run(
      `INSERT INTO ${q("member")} (${q("id")}, ${q("legacyNote")}) VALUES ('m1', 'keep me')`,
    );
    await db.run(`INSERT INTO ${q("teams_audit")} (${q("id")}) VALUES ('a1')`);
  }

  const columns = async (db: TestDatabase, table: string) =>
    Object.keys((await db.rows(`SELECT * FROM ${db.quote(table)}`))[0] ?? {});
  const tables = async (db: TestDatabase) =>
    (
      await db.rows(
        db.dialect === "sqlite"
          ? "select name from sqlite_master where type = 'table'"
          : `select table_name as name from information_schema.tables where table_schema = ${db.dialect === "mysql" ? "database()" : "current_schema()"}`,
      )
    ).map((row) => String(row.name ?? row.NAME));

  it("marks a drop, and never runs it without --allow-destructive", async () => {
    const db = await database();
    await installV1(db);
    const upgrade = teams(db, v2, "2.0.0", [dropNote, dropAudit]);

    await upgrade.migrate();
    expect(upgrade.messages[0]).toContain(
      "1. drop member.legacyNote  ⚠ deletes data, needs --allow-destructive",
    );
    expect(upgrade.messages[0]).toContain("2. drop table teams_audit  ⚠ deletes data");

    const refused = await upgrade.migrate({ apply: true });
    expect(refused.steps.ran).toEqual([]);
    expect(refused.steps.pending).toEqual(["2.0.0-drop-note", "2.0.0-drop-audit"]);
    expect(upgrade.messages.join("\n")).toContain(
      'Stopped at migration step "2.0.0-drop-note" (drop member.legacyNote): it deletes data. Run again with --allow-destructive',
    );
    expect(await columns(db, "member")).toContain("legacyNote");
    expect(await tables(db)).toContain("teams_audit");

    // The check says so, as a warning: nothing is broken by waiting.
    const report = await checkSchema(upgrade.config);
    expect(report.ok).toBe(true);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "migration-step-pending",
        message: expect.stringContaining("drop member.legacyNote (deletes data)"),
      }),
    );
  });

  it("can still drop after a run that refused to", async () => {
    const db = await database();
    await installV1(db);
    await teams(db, v2, "2.0.0", [dropNote]).migrate({ apply: true });
    const allowed = await teams(db, v2, "2.0.0", [dropNote]).migrate({
      apply: true,
      allowDestructive: true,
    });
    expect(allowed.steps.ran).toEqual(["2.0.0-drop-note"]);
    expect(await columns(db, "member")).toEqual(["id"]);
  });

  it("drops what the plugin created once allowed, and only once", async () => {
    const db = await database();
    await installV1(db);
    const upgrade = teams(db, v2, "2.0.0", [dropNote, dropAudit]);
    const result = await upgrade.migrate({ apply: true, allowDestructive: true });
    expect(result.steps.ran).toEqual(["2.0.0-drop-note", "2.0.0-drop-audit"]);
    expect(await columns(db, "member")).toEqual(["id"]);
    expect(await tables(db)).not.toContain("teams_audit");

    const again = teams(db, v2, "2.0.0", [dropNote, dropAudit]);
    expect((await again.migrate({ apply: true, allowDestructive: true })).steps.ran).toEqual([]);
    expect((await checkSchema(again.config)).issues).toEqual([]);
  });

  it("never drops a column the plugin did not create", async () => {
    const db = await database();
    await teams(db, v2, "2.0.0").migrate({ apply: true });
    // The app added its own column to the plugin's table.
    await db.run(
      `ALTER TABLE ${db.quote("member")} ADD COLUMN ${db.quote("legacyNote")} VARCHAR(64)`,
    );
    await db.run(`INSERT INTO ${db.quote("member")} (${db.quote("id")}) VALUES ('m1')`);
    const upgrade = teams(db, v2, "2.0.1", [dropNote]);
    const result = await upgrade.migrate({ apply: true, allowDestructive: true });
    expect(result.steps.ran).toEqual([]);
    expect(result.steps.plan!.steps[0]).toMatchObject({
      state: "blocked",
      reason: expect.stringContaining('Farm has no record of teams creating "member.legacyNote"'),
    });
    expect(await columns(db, "member")).toContain("legacyNote");
    expect((await checkSchema(upgrade.config)).issues).toContainEqual(
      expect.objectContaining({ code: "migration-step-blocked", severity: "error" }),
    );
  });

  it("never drops another plugin's table", async () => {
    const db = await database();
    const billing = definePlugin({
      name: "farm:billing",
      schema: defineSchema({
        models: {
          invoice: { name: "teams_audit", fields: { id: { type: "string", primaryKey: true } } },
        },
      }),
    });
    await installV1(db);
    const upgrade = teams(db, v2, "2.0.0", [dropAudit], [billing]);
    const result = await upgrade.migrate({ apply: true, allowDestructive: true });
    expect(result.steps.plan!.steps[0]).toMatchObject({
      state: "blocked",
      reason: 'another plugin creates "teams_audit", so teams will not drop it.',
    });
    expect(await tables(db)).toContain("teams_audit");
  });

  it("holds the steps after a drop that is not allowed", async () => {
    const db = await database();
    await installV1(db);
    const q = db.quote;
    const after: FarmSchemaMigrationStep = {
      id: "2.0.0-after",
      before: true,
      sql: Object.fromEntries(
        (["postgres", "mysql", "sqlite"] as const).map((dialect) => [
          dialect,
          `INSERT INTO ${q("member")} (${q("id")}) VALUES ('m2')`,
        ]),
      ),
    };
    const result = await teams(db, v2, "2.0.0", [dropNote, after]).migrate({ apply: true });
    expect(result.steps.ran).toEqual([]);
    expect(await db.rows(`SELECT ${q("id")} FROM ${q("member")}`)).toEqual([{ id: "m1" }]);
  });

  it("records a drop that is already done, without the flag", async () => {
    const db = await database();
    await installV1(db);
    await db.run(`ALTER TABLE ${db.quote("member")} DROP COLUMN ${db.quote("legacyNote")}`);
    const result = await teams(db, v2, "2.0.0", [dropNote]).migrate({ apply: true });
    expect(result.steps.ran).toEqual(["2.0.0-drop-note"]);
  });

  it("runs nothing on a fresh install", async () => {
    const db = await database();
    const result = await teams(db, v2, "2.0.0", [dropNote, dropAudit]).migrate({ apply: true });
    expect(result.applied).toEqual(["member"]);
    expect(result.steps.ran).toEqual(["2.0.0-drop-note", "2.0.0-drop-audit"]);
  });
});

describe("destructive steps while the config loads", () => {
  it("cannot drop what the schema still declares", () => {
    const attempt = (step: unknown) => () =>
      definePlugin({ name: "farm:teams", schema: v1, migrations: [step] as never });
    expect(attempt({ id: "x", dropColumn: { model: "member", column: "legacyNote" } })).toThrow(
      /drops "member.legacyNote", which is still in the schema/,
    );
    expect(attempt({ id: "x", dropTable: { table: "teams_audit" } })).toThrow(
      /drops "teams_audit", which is still in the schema/,
    );
    expect(attempt({ id: "x", dropColumn: { model: "nope", column: "a" } })).toThrow(
      /"nope", which is not a model/,
    );
    const withUser = defineSchema({
      models: {
        ...v2.models,
        user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
      },
    });
    expect(() =>
      definePlugin({
        name: "farm:teams",
        schema: withUser,
        migrations: [{ id: "x", dropTable: { table: "user" } }],
      }),
    ).toThrow(/as a table the plugin does not own/);
  });
});
