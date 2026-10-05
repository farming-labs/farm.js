// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { defineIntegration } from "../integrations";
import { definePlugin } from "../plugin";
import { defineSchema, type FarmSchema } from "../schema";
import { checkSchema, formatSchemaCheck, type FarmSchemaCheckIssue } from "../schema-check";
import { collectSchemaModels, generateSqlStatements, type FarmSqlDialect } from "../schema-sql";
import { declareSchemaTables } from "../schema-tables";

const requireModule = createRequire(import.meta.url);
const postgresTestUrl = process.env.FARM_TEST_POSTGRES_URL;
const mysqlTestUrl = process.env.FARM_TEST_MYSQL_URL;

if (process.env.FARM_REQUIRE_TEST_POSTGRES === "1" && !postgresTestUrl) {
  throw new Error("FARM_TEST_POSTGRES_URL is required when FARM_REQUIRE_TEST_POSTGRES=1.");
}

/** A real database, with the bits the scenarios need. */
type TestDatabase = {
  dialect: FarmSqlDialect;
  client: unknown;
  run(sql: string): Promise<void>;
  /** Table names this run created, for cleanup and the read-only check. */
  listTables(): Promise<string[]>;
  quote(name: string): string;
  types: { text: string; integer: string; nativeUuid?: string };
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
    async listTables() {
      return (
        database
          .prepare("select name from sqlite_master where type = 'table' order by name")
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
    },
    quote: (name) => `"${name}"`,
    types: { text: "TEXT", integer: "INTEGER" },
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
    async listTables() {
      const { rows } = await pool.query(
        "select table_name from information_schema.tables where table_schema = current_schema() order by table_name",
      );
      return rows.map((row) => String(row.table_name));
    },
    quote: (name) => `"${name}"`,
    types: { text: "TEXT", integer: "INTEGER", nativeUuid: "UUID" },
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
    async listTables() {
      const [rows] = await pool.query(
        "select table_name as name from information_schema.tables where table_schema = database() order by table_name",
      );
      return rows.map((row) => String(row.name));
    },
    quote: (name) => `\`${name}\``,
    types: { text: "VARCHAR(255)", integer: "INT" },
    async close() {
      await pool.end();
    },
  };
}

const databases: Array<[string, () => Promise<TestDatabase>]> = [
  ["sqlite", sqliteDatabase],
  ...(postgresTestUrl ? [["postgres", postgresDatabase] as [string, () => Promise<TestDatabase>]] : []),
  ...(mysqlTestUrl ? [["mysql", mysqlDatabase] as [string, () => Promise<TestDatabase>]] : []),
];

let counter = 0;
const unique = (name: string) =>
  `farm_check_${name}_${process.pid}_${Date.now() % 100000}_${counter++}`;

describe.each(databases)("farm schema check on %s", (_name, open) => {
  const created: Array<{ db: TestDatabase; table: string }> = [];
  const opened: TestDatabase[] = [];

  async function database() {
    const db = await open();
    opened.push(db);
    return db;
  }

  async function createTable(db: TestDatabase, table: string, columns: string) {
    await db.run(`CREATE TABLE ${db.quote(table)} (${columns})`);
    created.push({ db, table });
  }

  /** Create an owner's tables exactly as `farm <owner> migrate` would. */
  async function migrate(db: TestDatabase, owner: string, schema: FarmSchema, only?: string[]) {
    for (const statement of generateSqlStatements(
      collectSchemaModels([[owner, schema, only]]),
      db.dialect,
    )) {
      await db.run(statement.sql);
    }
    for (const model of collectSchemaModels([[owner, schema, only]])) {
      created.push({ db, table: model.modelName });
    }
  }

  function plugin(name: string, schema: FarmSchema, client: unknown, models?: string[]) {
    return declareSchemaTables(definePlugin({ name: `farm:${name}` }), {
      name,
      schema,
      models,
      resolveClient: async () => client,
    });
  }

  const codes = (issues: FarmSchemaCheckIssue[]) => issues.map((issue) => issue.code).sort();

  afterAll(async () => {
    // Children before parents, so foreign keys do not block the drop.
    for (const { db, table } of created.reverse()) {
      await db.run(`DROP TABLE IF EXISTS ${db.quote(table)}`).catch(() => undefined);
    }
    for (const db of opened) await db.close();
  });

  it("passes when every owner's tables exist and match", async () => {
    const db = await database();
    const tasks = defineSchema({
      models: {
        task: {
          name: unique("task"),
          fields: {
            id: { type: "uuid", primaryKey: true },
            title: { type: "string", required: true },
            done: { type: "boolean", default: false },
          },
        },
      },
    });
    await migrate(db, "tasks", tasks);

    const report = await checkSchema({ plugins: [plugin("tasks", tasks, db.client)] });
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.owners).toEqual([
      expect.objectContaining({ name: "tasks", kind: "plugin", dialect: db.dialect, relational: true }),
    ]);
  });

  it("reports a table that was never created, with the command that creates it", async () => {
    const db = await database();
    const table = unique("missing");
    const schema = defineSchema({
      models: { item: { name: table, fields: { id: { type: "uuid", primaryKey: true } } } },
    });

    const report = await checkSchema({ plugins: [plugin("items", schema, db.client)] });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "table-missing",
        severity: "error",
        owner: "items",
        table,
        hint: expect.stringContaining("farm items migrate"),
      }),
    ]);
  });

  it("reports missing columns and changed column types on existing tables", async () => {
    const db = await database();
    const table = unique("drift");
    await createTable(
      db,
      table,
      `${db.quote("id")} ${db.types.text} PRIMARY KEY, ${db.quote("count")} ${db.types.text}`,
    );
    const schema = defineSchema({
      models: {
        item: {
          name: table,
          fields: {
            id: { type: "string", primaryKey: true },
            count: { type: "integer" },
            label: { type: "string" },
          },
        },
      },
    });

    const report = await checkSchema({ plugins: [plugin("items", schema, db.client)] });
    expect(report.ok).toBe(false);
    const issues = report.issues.filter((issue) => issue.severity === "error");
    expect(codes(issues)).toEqual(["column-missing", "column-type"]);
    expect(issues.find((issue) => issue.code === "column-missing")).toMatchObject({ column: "label" });
    expect(issues.find((issue) => issue.code === "column-type")).toMatchObject({ column: "count" });
  });

  describe("references to tables another owner created", () => {
    function loyaltySchema(usersTable: string, fieldType: "string" | "integer" = "string") {
      return defineSchema({
        models: {
          points: {
            name: unique("points"),
            fields: {
              id: { type: "uuid", primaryKey: true },
              userId: {
                type: fieldType,
                required: true,
                reference: { model: usersTable, field: "id", enforced: "app" },
              },
            },
          },
        },
      });
    }

    it("accepts a reference to an app table that exists with a compatible column", async () => {
      const db = await database();
      const users = unique("users");
      await createTable(db, users, `${db.quote("id")} ${db.types.text} PRIMARY KEY`);
      const schema = loyaltySchema(users);
      await migrate(db, "loyalty", schema);

      const report = await checkSchema({ plugins: [plugin("loyalty", schema, db.client)] });
      expect(report.issues).toEqual([]);
    });

    it("explains a referenced table that does not exist yet", async () => {
      const db = await database();
      const users = unique("users_absent");
      const schema = loyaltySchema(users);
      await migrate(db, "loyalty", schema);

      const report = await checkSchema({ plugins: [plugin("loyalty", schema, db.client)] });
      expect(report.issues).toEqual([
        expect.objectContaining({
          code: "reference-table-missing",
          severity: "error",
          column: "userId",
          hint: expect.stringContaining("Better Auth"),
        }),
      ]);
      expect(report.issues[0]!.message).toContain(`"${users}" does not exist`);
    });

    it("lists the real columns when the referenced column is missing", async () => {
      const db = await database();
      const users = unique("users_cols");
      await createTable(
        db,
        users,
        `${db.quote("user_id")} ${db.types.text} PRIMARY KEY, ${db.quote("email")} ${db.types.text}`,
      );
      const schema = loyaltySchema(users);
      await migrate(db, "loyalty", schema);

      const report = await checkSchema({ plugins: [plugin("loyalty", schema, db.client)] });
      expect(report.issues).toEqual([
        expect.objectContaining({
          code: "reference-column-missing",
          hint: expect.stringContaining("user_id, email"),
        }),
      ]);
    });

    it("rejects a reference whose types can never form a foreign key", async () => {
      const db = await database();
      const users = unique("users_int");
      await createTable(db, users, `${db.quote("id")} ${db.types.integer} PRIMARY KEY`);
      const schema = loyaltySchema(users, "string");
      await migrate(db, "loyalty", schema);

      const report = await checkSchema({ plugins: [plugin("loyalty", schema, db.client)] });
      expect(report.issues).toEqual([
        expect.objectContaining({ code: "reference-type", severity: "error", column: "userId" }),
      ]);
    });

    it("resolves a reference to another plugin's model by that plugin's table name", async () => {
      const db = await database();
      const teams = defineSchema({
        models: {
          organization: {
            name: unique("organization"),
            fields: { id: { type: "uuid", primaryKey: true } },
          },
        },
      });
      const billing = defineSchema({
        models: {
          subscription: {
            name: unique("subscription"),
            fields: {
              id: { type: "uuid", primaryKey: true },
              organizationId: {
                type: "uuid",
                reference: { model: "organization", field: "id", enforced: "app" },
              },
            },
          },
        },
      });
      await migrate(db, "billing", billing);

      const before = await checkSchema({
        plugins: [plugin("teams", teams, db.client), plugin("billing", billing, db.client)],
      });
      // teams has not migrated: its own table is missing, and billing's reference names teams.
      expect(codes(before.issues)).toEqual(["reference-table-missing", "table-missing"]);
      expect(before.issues.find((issue) => issue.owner === "billing")?.hint).toContain(
        "belongs to teams",
      );

      await migrate(db, "teams", teams);
      const after = await checkSchema({
        plugins: [plugin("teams", teams, db.client), plugin("billing", billing, db.client)],
      });
      expect(after.issues).toEqual([]);
    });

    it("uses the physical name of an unclaimed model in a schema the app handed over", async () => {
      const db = await database();
      const members = unique("members");
      await createTable(db, members, `${db.quote("member_id")} ${db.types.text} PRIMARY KEY`);
      // The app's schema describes `user` (really the members table); the plugin owns only `task`.
      const appSchema = defineSchema({
        models: {
          user: { name: members, fields: { id: { type: "string", primaryKey: true, name: "member_id" } } },
          task: {
            name: unique("task"),
            fields: {
              id: { type: "uuid", primaryKey: true },
              ownerId: { type: "string", reference: { model: "user", field: "id", enforced: "app" } },
            },
          },
        },
      });
      await migrate(db, "sync", appSchema, ["task"]);

      const report = await checkSchema({ plugins: [plugin("sync", appSchema, db.client, ["task"])] });
      expect(report.issues).toEqual([]);
    });
  });

  it("checks integrations that declare a schema against storage.client", async () => {
    const db = await database();
    const accounts = defineSchema({
      models: {
        account: {
          name: unique("billing_account"),
          fields: { id: { type: "id", primaryKey: true }, ownerId: { type: "string", required: true } },
        },
      },
    });
    const billing = defineIntegration({
      category: "payment",
      type: "custom-billing",
      instance: {},
      schema: accounts,
    });

    const missing = await checkSchema({ integrations: { billing }, storage: { client: db.client } } as never);
    expect(missing.issues).toEqual([
      expect.objectContaining({ code: "table-missing", owner: "billing", hint: expect.stringContaining("farm generate") }),
    ]);

    await migrate(db, "billing", accounts);
    const present = await checkSchema({ integrations: { billing }, storage: { client: db.client } } as never);
    expect(present.issues).toEqual([]);
    expect(present.owners).toEqual([expect.objectContaining({ name: "billing", kind: "integration" })]);
  });

  it("never writes to the database", async () => {
    const db = await database();
    const before = await db.listTables();
    const schema = defineSchema({
      models: {
        item: {
          name: unique("readonly"),
          fields: {
            id: { type: "uuid", primaryKey: true },
            userId: { type: "string", reference: { model: unique("nobody"), field: "id" } },
          },
        },
      },
    });

    await checkSchema({ plugins: [plugin("items", schema, db.client)] });
    await checkSchema({ plugins: [plugin("items", schema, db.client)] });
    expect(await db.listTables()).toEqual(before);
  });
});

describe("farm schema check without a database", () => {
  const schema = defineSchema({
    models: { item: { name: "items", fields: { id: { type: "uuid", primaryKey: true } } } },
  });
  const plugin = (name: string, resolveClient: () => Promise<unknown>, owned = schema) =>
    declareSchemaTables(definePlugin({ name: `farm:${name}` }), { name, schema: owned, resolveClient });

  it("is fine when nothing declares tables", async () => {
    const report = await checkSchema({ plugins: [definePlugin({ name: "plain" })] });
    expect(report).toEqual({ owners: [], issues: [], ok: true });
    expect(formatSchemaCheck(report)).toBe("No integration or plugin declares database tables.");
  });

  it("skips owners that store data in a key/value mount", async () => {
    const mount = { getItem() {}, setItem() {} };
    const report = await checkSchema({ plugins: [plugin("kv", async () => mount)] });
    expect(report.ok).toBe(true);
    expect(report.owners[0]).toMatchObject({ name: "kv", relational: false });
  });

  it("reports an owner whose database cannot be reached and still checks the rest", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const healthy = new DatabaseSync(":memory:");
    const report = await checkSchema({
      plugins: [
        plugin("broken", async () => {
          throw new Error("ECONNREFUSED");
        }),
        plugin("healthy", async () => healthy, defineSchema({
          models: { other: { name: "other_items", fields: { id: { type: "uuid", primaryKey: true } } } },
        })),
      ],
    });
    expect(report.issues).toEqual([
      expect.objectContaining({ owner: "broken", code: "client-unavailable", message: expect.stringContaining("ECONNREFUSED") }),
      expect.objectContaining({ owner: "healthy", code: "table-missing" }),
    ]);
    healthy.close();
  });

  it("reports an integration that declares tables without storage.client", async () => {
    const billing = defineIntegration({ category: "payment", type: "custom", instance: {}, schema });
    const report = await checkSchema({ integrations: { billing } } as never);
    expect(report.issues).toEqual([
      expect.objectContaining({ owner: "billing", code: "client-missing", hint: expect.stringContaining("storage.client") }),
    ]);
  });

  it("reports two owners claiming the same table", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    const report = await checkSchema({
      plugins: [plugin("first", async () => db), plugin("second", async () => db)],
    });
    expect(report.issues.filter((issue) => issue.code === "table-conflict")).toEqual([
      expect.objectContaining({ owner: "second", table: "items", message: expect.stringContaining("first and second") }),
    ]);
    db.close();
  });

  it("reports an invalid schema without stopping the rest of the check", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    const invalid = defineSchema({
      models: {
        item: {
          name: "bad_items",
          fields: {
            id: { type: "uuid", primaryKey: true },
            // A reference inside the owner's own schema to a field that does not exist.
            parentId: { type: "uuid", reference: { model: "item", field: "missing" } },
          },
        },
      },
    });
    const report = await checkSchema({
      plugins: [plugin("invalid", async () => db, invalid), plugin("fine", async () => db)],
    });
    expect(codes(report.issues)).toEqual(["schema-invalid", "table-missing"]);
    db.close();
  });

  function codes(issues: FarmSchemaCheckIssue[]) {
    return issues.map((issue) => issue.code).sort();
  }
});

const describeWithPostgres = postgresTestUrl ? describe : describe.skip;

describeWithPostgres("farm schema check on postgres specifics", () => {
  let db: TestDatabase;
  const schemaName = unique("other_schema");
  const users = unique("pg_users");

  afterAll(async () => {
    await db?.run(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await db?.run(`DROP TABLE IF EXISTS "${users}"`);
    await db?.close();
  });

  function referencing(table: string) {
    return defineSchema({
      models: {
        points: {
          name: unique("pg_points"),
          fields: {
            id: { type: "uuid", primaryKey: true },
            userId: { type: "uuid", reference: { model: table, field: "id", enforced: "app" } },
          },
        },
      },
    });
  }

  it("flags a text column pointing at a native uuid column", async () => {
    db = await postgresDatabase();
    await db.run(`CREATE TABLE "${users}" ("id" UUID PRIMARY KEY)`);
    const schema = referencing(users);
    const report = await checkSchema({
      plugins: [
        declareSchemaTables(definePlugin({ name: "farm:loyalty" }), {
          name: "loyalty",
          schema,
          resolveClient: async () => db.client,
        }),
      ],
    });
    // Farm stores uuid as TEXT in Postgres, so Postgres would refuse the join without a cast.
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: "reference-type", message: expect.stringContaining("uuid there") }),
    );
  });

  it("only sees tables in the connection's current schema", async () => {
    const elsewhere = unique("elsewhere_users");
    await db.run(`CREATE SCHEMA "${schemaName}"`);
    await db.run(`CREATE TABLE "${schemaName}"."${elsewhere}" ("id" TEXT PRIMARY KEY)`);
    const report = await checkSchema({
      plugins: [
        declareSchemaTables(definePlugin({ name: "farm:loyalty" }), {
          name: "loyalty",
          schema: referencing(elsewhere),
          resolveClient: async () => db.client,
        }),
      ],
    });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "reference-table-missing" }));
  });
});
