// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import { defineSchema, type FarmSchema } from "../schema";
import { checkSchema } from "../schema-check";
import { renameSchema } from "../schema-rename";
import type { FarmSqlDialect } from "../schema-sql";
import { FARM_SCHEMA_STATE_TABLE } from "../schema-state";
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
  const schema = unique("upgrades");
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
  const name = unique("upgrades");
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
  `farm_up_${name}_${process.pid}_${Date.now() % 100000}_${counter++}`;

/** teams 1.0.0, and the 1.1.0 release that adds to it. */
const v1 = defineSchema({
  models: {
    member: {
      fields: {
        id: { type: "string", primaryKey: true },
        name: { type: "string", required: true },
      },
    },
  },
});
const v11 = defineSchema({
  models: {
    member: {
      fields: {
        id: { type: "string", primaryKey: true },
        name: { type: "string", required: true },
        role: { type: "string", default: "member", index: true },
      },
    },
    invitation: { fields: { id: { type: "string", primaryKey: true }, email: { type: "string" } } },
  },
});

describe.each(databases)("upgrading a plugin's tables on %s", (_name, open) => {
  const opened: TestDatabase[] = [];
  afterAll(async () => {
    for (const db of opened) await db.close();
  });

  async function database() {
    const db = await open();
    opened.push(db);
    return db;
  }

  function teams(db: TestDatabase, schema: FarmSchema, version?: string) {
    const config = {
      plugins: [definePlugin({ name: "farm:teams", version, schema })],
      storage: { client: db.client },
    };
    const owner = findSchemaTableOwners(config)[0]!;
    const messages: string[] = [];
    const migrate = (apply = false) =>
      migrateSchemaTables(owner, { config, apply, log: (message) => messages.push(message) });
    return { config, migrate, messages };
  }

  it("says what the new version adds, then adds it to a table with rows", async () => {
    const db = await database();
    await teams(db, v1, "1.0.0").migrate(true);
    await db.run(
      `INSERT INTO ${db.quote("member")} (${db.quote("id")}, ${db.quote("name")}) VALUES ('m1', 'Ada')`,
    );

    const upgraded = teams(db, v11, "1.1.0");
    const printed = await upgraded.migrate();
    expect(printed.upgrade).toMatchObject({ from: "1.0.0", to: "1.1.0" });
    expect(upgraded.messages[0]).toBe(
      [
        "teams 1.0.0 → 1.1.0 changes its tables:",
        "  + invitation  new table",
        "  + member.role  string",
        "  + member_role_idx  index",
      ].join("\n"),
    );
    expect(printed.planned).toBe(3);
    expect(printed.applied).toEqual([]);

    // The check names the upgrade until it is applied.
    const before = await checkSchema(upgraded.config);
    expect(before.issues).toContainEqual(
      expect.objectContaining({
        code: "schema-upgrade",
        message: "teams upgraded 1.0.0 → 1.1.0, and 3 change(s) are not applied yet.",
      }),
    );

    const applied = await upgraded.migrate(true);
    expect(applied.applied).toEqual(["invitation", "member.role", "member_role_idx"]);
    const rows = await db.rows(`SELECT * FROM ${db.quote("member")}`);
    expect(rows).toEqual([expect.objectContaining({ id: "m1", name: "Ada", role: "member" })]);

    // Recorded: the same version again has nothing to say.
    const again = teams(db, v11, "1.1.0");
    const settled = await again.migrate(true);
    expect(settled.upgrade).toBeUndefined();
    expect(again.messages).toContain("Nothing to create.");
    expect((await checkSchema(again.config)).issues).toEqual([]);
  });

  it("lists removals and redefinitions, and never applies them", async () => {
    const db = await database();
    await teams(db, v11, "1.1.0").migrate(true);
    const v2 = defineSchema({
      models: {
        member: {
          fields: {
            id: { type: "string", primaryKey: true },
            name: { type: "string", nullable: true },
            joinedAt: { type: "datetime" },
          },
        },
      },
    });
    const upgraded = teams(db, v2, "2.0.0");
    const result = await upgraded.migrate(true);
    expect(upgraded.messages[0]).toContain("teams 1.1.0 → 2.0.0 changes its tables:");
    expect(upgraded.messages[0]).toContain(
      "~ member.name is redefined  (Farm will not do this on its own)",
    );
    expect(upgraded.messages[0]).toContain("~ member.role is removed");
    expect(upgraded.messages[0]).toContain("~ invitation is removed");
    // Required with no default: it cannot join a table that may have rows.
    expect(result.applied).toEqual([]);
    expect(result.plan.drift[0]!.missingColumns).toEqual(["joinedAt"]);
    expect(await db.tables()).toContain("invitation");
    expect((await checkSchema(upgraded.config)).issues).toContainEqual(
      expect.objectContaining({
        code: "column-missing",
        column: "joinedAt",
        hint: expect.stringContaining("required with no default"),
      }),
    );
  });

  it("never adds a unique column on its own, even a nullable one", async () => {
    const db = await database();
    await teams(db, v1, "1.0.0").migrate(true);
    const withCode = defineSchema({
      models: {
        member: {
          fields: {
            ...v1.models.member.fields,
            code: { type: "string", unique: true, nullable: true },
          },
        },
      },
    });
    const result = await teams(db, withCode, "1.1.0").migrate(true);
    // Its unique index could fail on existing rows; a person decides.
    expect(result.applied).toEqual([]);
    expect(result.plan.drift[0]!.missingColumns).toEqual(["code"]);
  });

  it("says the tables changed when the plugin has no version", async () => {
    const db = await database();
    await teams(db, v1).migrate(true);
    const upgraded = teams(db, v11);
    await upgraded.migrate();
    expect(upgraded.messages[0]).toMatch(/^teams's tables changed since they were last migrated:/u);
  });

  it("records the first apply, and the check never writes the record", async () => {
    const db = await database();
    const first = teams(db, v1, "1.0.0");
    await checkSchema(first.config);
    await first.migrate();
    expect(await db.tables()).not.toContain(FARM_SCHEMA_STATE_TABLE);

    await first.migrate(true);
    expect(await db.tables()).toContain(FARM_SCHEMA_STATE_TABLE);
    const [row] = await db.rows(`SELECT * FROM ${db.quote(FARM_SCHEMA_STATE_TABLE)}`);
    expect(row).toMatchObject({ owner: "teams", version: "1.0.0" });
  });

  it("still succeeds when the record cannot be written", async () => {
    const db = await database();
    // A table under that name the record cannot be written to.
    await db.run(
      `CREATE TABLE ${db.quote(FARM_SCHEMA_STATE_TABLE)} (${db.quote("unrelated")} INTEGER)`,
    );
    const first = teams(db, v1, "1.0.0");
    const result = await first.migrate(true);
    expect(result.applied).toEqual(["member"]);
    expect(first.messages.join("\n")).toContain(
      `Applied, but could not record it in "${FARM_SCHEMA_STATE_TABLE}"`,
    );
    // And reading it is treated as no record, for migrate and the check.
    const upgraded = teams(db, v11, "1.1.0");
    expect((await upgraded.migrate()).upgrade).toBeUndefined();
    expect((await checkSchema(upgraded.config)).issues.map((issue) => issue.code)).not.toContain(
      "schema-upgrade",
    );
  });

  it("follows the app's renames", async () => {
    const db = await database();
    const renamed = (schema: FarmSchema) =>
      renameSchema(schema, {
        member: { name: "team_members", fields: { role: "member_role" } },
      } as never);
    await teams(db, renameSchema(v1, { member: { name: "team_members" } }), "1.0.0").migrate(true);
    const upgraded = teams(db, renamed(v11), "1.1.0");
    const result = await upgraded.migrate(true);
    expect(result.applied).toContain("team_members.member_role");
    expect(upgraded.messages[0]).toContain("+ team_members.member_role  string");
  });
});
