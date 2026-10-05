// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import { defineSchema } from "../schema";
import { checkSchema } from "../schema-check";
import { collectSchemaExtensions, isSchemaExtensionAllowed } from "../schema-extend";
import { createSchemaExecutor, planSchemaExtensions } from "../schema-migrate";
import { renameSchema } from "../schema-rename";
import type { FarmSqlDialect } from "../schema-sql";
import { findSchemaTableOwners, migrateSchemaTables } from "../schema-tables";

const requireModule = createRequire(import.meta.url);
const postgresTestUrl = process.env.FARM_TEST_POSTGRES_URL;
const mysqlTestUrl = process.env.FARM_TEST_MYSQL_URL;

if (process.env.FARM_REQUIRE_TEST_POSTGRES === "1" && !postgresTestUrl) {
  throw new Error("FARM_TEST_POSTGRES_URL is required when FARM_REQUIRE_TEST_POSTGRES=1.");
}

/** A loyalty plugin: its own history table, and a points column on the app's user. */
const loyaltySchema = (extra: Record<string, unknown> = {}) =>
  defineSchema({
    models: {
      user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
      pointsHistory: {
        fields: {
          id: { type: "uuid", primaryKey: true },
          userId: { type: "string", reference: { model: "user", field: "id", enforced: "app" } },
          amount: { type: "integer" },
        },
      },
    },
    extend: {
      user: {
        fields: {
          points: { type: "integer", default: 0 },
          tier: { type: "string", nullable: true },
          ...extra,
        },
      },
    },
  });

describe("collecting extensions", () => {
  it("finds columns added to tables the owner does not create", () => {
    const [extension, ...rest] = collectSchemaExtensions("loyalty", loyaltySchema());
    expect(rest).toEqual([]);
    expect(extension).toMatchObject({ owner: "loyalty", modelKey: "user", table: "user" });
    expect(extension!.fields.map(({ fieldKey }) => fieldKey)).toEqual(["points", "tier"]);
  });

  it("treats extend on the owner's own tables as part of those tables", () => {
    const schema = defineSchema({
      models: { audit: { fields: { id: { type: "uuid", primaryKey: true } } } },
      extend: { audit: { fields: { note: { type: "string", nullable: true } } } },
    });
    expect(collectSchemaExtensions("audit", schema)).toEqual([]);
    // Unless the owner narrowed its tables and does not claim that one.
    expect(collectSchemaExtensions("audit", schema, [])).toHaveLength(1);
  });

  it("follows the app's renames", () => {
    const renamed = renameSchema(loyaltySchema(), {
      user: { name: "members_auth", fields: { points: "loyalty_points" } },
    });
    const [extension] = collectSchemaExtensions("loyalty", renamed);
    expect(extension!.table).toBe("members_auth");
    expect(extension!.fields[0]!.field.name).toBe("loyalty_points");
  });

  it("refuses columns that cannot be added to a table that may already have rows", () => {
    for (const [field, message] of [
      [{ type: "integer" }, /needs a `default` or `nullable: true`/],
      [{ type: "string", unique: true, nullable: true }, /cannot be unique/],
      [{ type: "string", index: true, nullable: true }, /cannot be indexed/],
      [{ type: "string", primaryKey: true }, /primary.key/],
    ] as const) {
      expect(() =>
        definePlugin({ name: "farm:loyalty", schema: loyaltySchema({ broken: field }) }),
      ).toThrow(message);
    }
  });

  it("matches approval by the plugin's model name or the app's table name", () => {
    const extension = { owner: "loyalty", modelKey: "user", table: "members_auth" };
    expect(isSchemaExtensionAllowed({ loyalty: ["user"] }, extension)).toBe(true);
    expect(isSchemaExtensionAllowed({ loyalty: ["members_auth"] }, extension)).toBe(true);
    expect(isSchemaExtensionAllowed({ loyalty: ["organization"] }, extension)).toBe(false);
    expect(isSchemaExtensionAllowed({ rewards: ["user"] }, extension)).toBe(false);
    expect(isSchemaExtensionAllowed(undefined, extension)).toBe(false);
    // Inherited keys are not owners.
    expect(
      isSchemaExtensionAllowed({}, { owner: "constructor", modelKey: "user", table: "user" }),
    ).toBe(false);
  });
});

type TestDatabase = {
  dialect: FarmSqlDialect;
  client: unknown;
  run(sql: string): Promise<void>;
  rows(sql: string): Promise<Array<Record<string, unknown>>>;
  quote(name: string): string;
  close(): Promise<void>;
};

async function sqliteDatabase(): Promise<TestDatabase> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  return {
    dialect: "sqlite",
    client: database,
    async run(sql) {
      database.exec(sql);
    },
    async rows(sql) {
      return database.prepare(sql).all() as Array<Record<string, unknown>>;
    },
    quote: (name) => `"${name}"`,
    async close() {
      database.close();
    },
  };
}

async function postgresDatabase(): Promise<TestDatabase> {
  const { Pool } = requireModule("pg") as {
    Pool: new (options: { connectionString: string }) => {
      query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
      end(): Promise<void>;
    };
  };
  const pool = new Pool({ connectionString: postgresTestUrl! });
  return {
    dialect: "postgres",
    client: pool,
    async run(sql) {
      await pool.query(sql);
    },
    async rows(sql) {
      return (await pool.query(sql)).rows;
    },
    quote: (name) => `"${name}"`,
    async close() {
      await pool.end();
    },
  };
}

async function mysqlDatabase(): Promise<TestDatabase> {
  const mysql = requireModule("mysql2/promise") as {
    createPool(url: string): {
      query(sql: string): Promise<[Array<Record<string, unknown>>, unknown]>;
      end(): Promise<void>;
    };
  };
  const pool = mysql.createPool(mysqlTestUrl!);
  return {
    dialect: "mysql",
    client: pool,
    async run(sql) {
      await pool.query(sql);
    },
    async rows(sql) {
      return (await pool.query(sql))[0];
    },
    quote: (name) => `\`${name}\``,
    async close() {
      await pool.end();
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
  `farm_ext_${name}_${process.pid}_${Date.now() % 100000}_${counter++}`;

describe.each(databases)("adding columns to the app's tables on %s", (_name, open) => {
  const opened: TestDatabase[] = [];
  const created: Array<{ db: TestDatabase; table: string }> = [];

  afterAll(async () => {
    for (const { db, table } of created.reverse()) {
      await db.run(`DROP TABLE IF EXISTS ${db.quote(table)}`).catch(() => undefined);
    }
    for (const db of opened) await db.close();
  });

  /** An app with its own users table holding rows, and the loyalty plugin. */
  async function app(allowExtend?: Record<string, readonly string[]>) {
    const db = await open();
    opened.push(db);
    const users = unique("users");
    const history = unique("history");
    await db.run(`CREATE TABLE ${db.quote(users)} (${db.quote("id")} VARCHAR(64) PRIMARY KEY)`);
    created.push({ db, table: users });
    created.push({ db, table: history });
    await db.run(`INSERT INTO ${db.quote(users)} (${db.quote("id")}) VALUES ('u1'), ('u2')`);
    const plugin = definePlugin({
      name: "farm:loyalty",
      schema: renameSchema(loyaltySchema(), {
        user: { name: users },
        pointsHistory: { name: history },
      }),
    });
    const config = {
      plugins: [plugin],
      storage: { client: db.client },
      ...(allowExtend ? { schema: { allowExtend } } : {}),
    };
    const owner = findSchemaTableOwners(config)[0]!;
    return { db, users, history, config, owner };
  }

  it("prints the ALTER TABLE but refuses to run it until the app allows it", async () => {
    const { db, users, history, config, owner } = await app();

    const printed = await migrateSchemaTables(owner, { config });
    expect(printed.sql).toContain("Not allowed yet, so not run.");
    expect(printed.sql).toContain('schema: { allowExtend: { "loyalty": ["user"] } }');
    expect(printed.sql).toMatch(/-- ALTER TABLE .+ ADD COLUMN .+points/u);
    expect(printed.extensions.pending).toEqual([`${users}.points`, `${users}.tier`]);

    const applied = await migrateSchemaTables(owner, { config, apply: true });
    // The plugin's own table is created; the app's table is not touched.
    expect(applied.applied).toEqual([history]);
    expect(applied.extensions.unapproved).toHaveLength(2);
    expect(applied.extensions.pending).toHaveLength(2);
    expect(Object.keys((await db.rows(`SELECT * FROM ${db.quote(users)}`))[0]!)).toEqual(["id"]);

    const report = await checkSchema(config);
    expect(report.ok).toBe(false);
    expect(report.issues.filter((issue) => issue.code === "extend-column-missing")).toEqual([
      expect.objectContaining({ column: "points", hint: expect.stringContaining("allowExtend") }),
      expect.objectContaining({ column: "tier", hint: expect.stringContaining("allowExtend") }),
    ]);
  });

  it("adds allowed columns to a table with rows, once, without changing anything else", async () => {
    const { db, users, config, owner } = await app({ loyalty: ["user"] });

    const first = await migrateSchemaTables(owner, { config, apply: true });
    expect(first.applied).toContain(`${users}.points`);
    expect(first.extensions.pending).toEqual([]);
    expect(first.sql).toContain("Existing tables only get the columns added below");

    // Existing rows get the default; the nullable column stays empty.
    const rows = await db.rows(
      `SELECT ${db.quote("id")}, ${db.quote("points")}, ${db.quote("tier")} FROM ${db.quote(users)} ORDER BY ${db.quote("id")}`,
    );
    expect(rows.map((row) => [row.id, Number(row.points), row.tier])).toEqual([
      ["u1", 0, null],
      ["u2", 0, null],
    ]);

    // Running it again adds nothing.
    const second = await migrateSchemaTables(owner, { config, apply: true });
    expect(second.applied).toEqual([]);
    expect(second.extensions.statements).toEqual([]);
    expect(second.extensions.present).toEqual([`${users}.points`, `${users}.tier`]);

    expect((await checkSchema(config)).issues).toEqual([]);
  });

  it("accepts the app's real table name as the approval", async () => {
    const { users, config, owner } = await app();
    const allowed = { ...config, schema: { allowExtend: { loyalty: [users] } } };
    const result = await migrateSchemaTables(owner, { config: allowed, apply: true });
    expect(result.extensions.pending).toEqual([]);
  });

  it("never alters a column that already exists, even with a different type", async () => {
    const { db, users, config, owner } = await app({ loyalty: ["user"] });
    await db.run(`ALTER TABLE ${db.quote(users)} ADD COLUMN ${db.quote("points")} VARCHAR(20)`);

    const result = await migrateSchemaTables(owner, { config, apply: true });
    expect(result.applied).not.toContain(`${users}.points`);
    if (db.dialect === "sqlite") {
      // SQLite compares across types, so the column is simply there.
      expect(result.extensions.present).toContain(`${users}.points`);
    } else {
      expect(result.extensions.conflicts).toEqual([
        expect.objectContaining({ column: "points", expected: expect.stringMatching(/int/iu) }),
      ]);
      expect((await checkSchema(config)).issues).toContainEqual(
        expect.objectContaining({ code: "extend-column-type", severity: "warning" }),
      );
    }
  });

  it("explains a table that does not exist yet and still creates the plugin's own", async () => {
    const db = await open();
    opened.push(db);
    const history = unique("history_only");
    created.push({ db, table: history });
    const config = {
      plugins: [
        definePlugin({
          name: "farm:loyalty",
          schema: renameSchema(loyaltySchema(), {
            user: { name: unique("nobody") },
            pointsHistory: { name: history },
          }),
        }),
      ],
      storage: { client: db.client },
      schema: { allowExtend: { loyalty: ["user"] } },
    };
    const messages: string[] = [];
    const result = await migrateSchemaTables(findSchemaTableOwners(config)[0]!, {
      config,
      apply: true,
      log: (message) => messages.push(message),
    });
    expect(result.applied).toEqual([history]);
    expect(result.extensions.missingTables).toHaveLength(1);
    expect(result.extensions.pending).toHaveLength(2);
    expect(messages.join("\n")).toMatch(
      /the table does not exist\. Run the migration that creates it/u,
    );
    expect((await checkSchema(config)).issues).toContainEqual(
      expect.objectContaining({ code: "extend-table-missing" }),
    );
  });

  it("says there is nothing to do in an ORM project when nothing is missing", async () => {
    const { config, owner } = await app({ loyalty: ["user"] });
    await migrateSchemaTables(owner, { config, apply: true });
    const messages: string[] = [];
    await migrateSchemaTables(owner, {
      config,
      apply: true,
      extensions: "report",
      log: (message) => messages.push(message),
    });
    expect(messages).toContain("Nothing to create.");
  });

  it("adds to a table in another schema named as schema.table", async () => {
    if (_name !== "postgres") return;
    const db = await open();
    opened.push(db);
    const schemaName = unique("auth");
    await db.run(`CREATE SCHEMA "${schemaName}"`);
    try {
      await db.run(`CREATE TABLE "${schemaName}"."users" ("id" TEXT PRIMARY KEY)`);
      const history = unique("history_qualified");
      created.push({ db, table: history });
      const config = {
        plugins: [
          definePlugin({
            name: "farm:loyalty",
            schema: renameSchema(loyaltySchema(), {
              user: { name: `${schemaName}.users` },
              pointsHistory: { name: history },
            }),
          }),
        ],
        storage: { client: db.client },
        schema: { allowExtend: { loyalty: ["user"] } },
      };
      const result = await migrateSchemaTables(findSchemaTableOwners(config)[0]!, {
        config,
        apply: true,
      });
      expect(result.extensions.pending).toEqual([]);
      const columns = await db.rows(
        `select column_name from information_schema.columns where table_schema = '${schemaName}' and table_name = 'users' order by ordinal_position`,
      );
      expect(columns.map((row) => row.column_name)).toEqual(["id", "points", "tier"]);
      expect((await checkSchema(config)).issues).toEqual([]);
    } finally {
      await db.run(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
  });

  it("reports, and never runs, additions to tables the app's ORM owns", async () => {
    const { db, users, config, owner } = await app({ loyalty: ["user"] });
    const result = await migrateSchemaTables(owner, { config, apply: true, extensions: "report" });
    expect(result.extensions.pending).toEqual([`${users}.points`, `${users}.tier`]);
    expect(result.sql).toContain("tables your ORM owns. Farm will not alter them");
    expect(Object.keys((await db.rows(`SELECT * FROM ${db.quote(users)}`))[0]!)).toEqual(["id"]);
  });
});

describe("columns a database cannot add as declared", () => {
  it("says why instead of emitting SQL that would fail", async () => {
    const schema = defineSchema({
      models: { user: { external: true, fields: { id: { type: "string", primaryKey: true } } } },
      extend: {
        user: {
          fields: {
            joinedAt: { type: "datetime", default: "now" },
            settings: { type: "json", default: { theme: "dark" } },
          },
        },
      },
    });
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY)');
    const plan = await planSchemaExtensions(
      collectSchemaExtensions("profile", schema),
      "sqlite",
      createSchemaExecutor(database, "profile")!.executor,
    );
    expect(plan.statements).toEqual([]);
    expect(plan.unsupported).toEqual([
      expect.objectContaining({
        column: "joinedAt",
        reason: expect.stringContaining("current time"),
      }),
      expect.objectContaining({
        column: "settings",
        reason: expect.stringContaining("cannot be written in SQL"),
      }),
    ]);
    database.close();
  });
});

describe("farm schema check across owners", () => {
  it("warns when two plugins add the same column", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "points" INTEGER)');
    const plugin = (name: string) =>
      definePlugin({
        name: `farm:${name}`,
        schema: defineSchema({
          models: {
            user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
          },
          extend: { user: { fields: { points: { type: "integer", default: 0 } } } },
        }),
      });
    const report = await checkSchema({
      plugins: [plugin("loyalty"), plugin("rewards")],
      storage: { client: database },
    });
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "extend-column-shared",
        severity: "warning",
        message: expect.stringContaining("loyalty and rewards both add"),
      }),
    ]);
    database.close();
  });
});
