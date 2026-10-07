// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import { defineSchema, type FarmSchemaReference } from "../schema";
import { checkSchema } from "../schema-check";
import { renameSchema } from "../schema-rename";
import type { FarmSqlDialect } from "../schema-sql";
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
  `farm_fk_${name}_${process.pid}_${Date.now() % 100000}_${counter++}`;

/** teams creates organizations; billing's subscriptions point at them. */
function plugins(
  names: { organization: string; subscription: string },
  reference: Partial<FarmSchemaReference> = {},
) {
  const teams = definePlugin({
    name: "farm:teams",
    schema: renameSchema(
      defineSchema({
        models: { organization: { fields: { id: { type: "string", primaryKey: true } } } },
      }),
      { organization: { name: names.organization } },
    ),
  });
  const billing = definePlugin({
    name: "farm:billing",
    schema: renameSchema(
      defineSchema({
        models: {
          subscription: {
            fields: {
              id: { type: "string", primaryKey: true },
              organizationId: {
                type: "string",
                reference: {
                  model: "organization",
                  field: "id",
                  onDelete: "cascade",
                  ...reference,
                },
              },
            },
          },
        },
      }),
      { subscription: { name: names.subscription } },
    ),
  });
  return { teams, billing };
}

describe.each(databases)("foreign keys between plugins on %s", (_name, open) => {
  const opened: TestDatabase[] = [];
  const created: Array<{ db: TestDatabase; table: string }> = [];

  afterAll(async () => {
    for (const { db, table } of created.reverse()) {
      await db.run(`DROP TABLE IF EXISTS ${db.quote(table)}`).catch(() => undefined);
    }
    for (const db of opened) await db.close();
  });

  async function setup(reference?: Partial<FarmSchemaReference>, schema?: Record<string, unknown>) {
    const db = await open();
    opened.push(db);
    const names = { organization: unique("org"), subscription: unique("sub") };
    created.push({ db, table: names.organization }, { db, table: names.subscription });
    const { teams, billing } = plugins(names, reference);
    const config = {
      plugins: [billing, teams],
      storage: { client: db.client },
      ...(schema ? { schema } : {}),
    };
    const owner = (name: string) =>
      findSchemaTableOwners(config).find((candidate) => candidate.name === name)!;
    const migrate = (
      name: string,
      options: { apply?: boolean; log?: (message: string) => void } = {},
    ) => migrateSchemaTables(owner(name), { config, ...options });
    return { db, names, config, migrate };
  }

  it("creates the foreign key with the table when the other plugin's table exists", async () => {
    const { db, names, config, migrate } = await setup();
    await migrate("teams", { apply: true });
    const billing = await migrate("billing", { apply: true });
    expect(billing.sql).toMatch(
      /REFERENCES ["`]farm_fk_org_\w+["`] \(["`]id["`]\) ON DELETE CASCADE/u,
    );

    // The database enforces it: deleting the organization removes its subscription.
    const q = db.quote;
    await db.run(`INSERT INTO ${q(names.organization)} (${q("id")}) VALUES ('o1')`);
    await db.run(
      `INSERT INTO ${q(names.subscription)} (${q("id")}, ${q("organizationId")}) VALUES ('s1', 'o1')`,
    );
    await db.run(`DELETE FROM ${q(names.organization)} WHERE ${q("id")} = 'o1'`);
    expect(await db.rows(`SELECT * FROM ${q(names.subscription)}`)).toEqual([]);

    // And it is not drift: nothing to add, nothing extra, nothing to report.
    const again = await migrate("billing", { apply: true });
    expect(again.plan.drift).toEqual([]);
    expect(again.plan.addableForeignKeys).toEqual([]);
    expect((await checkSchema(config)).issues).toEqual([]);
  });

  it("creates the table without one, and says how to get it, when the other plugin has not migrated", async () => {
    const { names, migrate } = await setup();
    const messages: string[] = [];
    const billing = await migrate("billing", {
      apply: true,
      log: (message) => messages.push(message),
    });
    expect(billing.sql).not.toMatch(/REFERENCES/u);
    expect(billing.foreignKeys.waiting).toEqual([
      expect.objectContaining({ table: names.subscription, referencedOwner: "teams" }),
    ]);
    expect(messages.join("\n")).toContain("Run `farm schema migrate` to create both in order.");
  });

  it("adds it to an existing table only with approval, and never over orphan rows", async () => {
    const { db, names, migrate, config } = await setup(undefined, {
      allowForeignKeys: { billing: ["subscription"] },
    });
    // billing first, so its table exists without the key.
    await migrate("billing", { apply: true });
    await migrate("teams", { apply: true });

    if (db.dialect === "sqlite") {
      const result = await migrate("billing", { apply: true });
      expect(result.foreignKeys.unsupported).toHaveLength(1);
      expect((await checkSchema(config)).issues).toContainEqual(
        expect.objectContaining({
          code: "foreign-key-missing",
          hint: expect.stringContaining("SQLite can only add"),
        }),
      );
      return;
    }

    const q = db.quote;
    await db.run(
      `INSERT INTO ${q(names.subscription)} (${q("id")}, ${q("organizationId")}) VALUES ('s1', 'ghost')`,
    );
    const blocked = await migrate("billing", { apply: true });
    expect(blocked.foreignKeys.blocked).toEqual([
      expect.objectContaining({
        orphans: 1,
        key: expect.objectContaining({ column: "organizationId" }),
      }),
    ]);

    await db.run(`DELETE FROM ${q(names.subscription)}`);
    const added = await migrate("billing", { apply: true });
    expect(added.applied).toEqual([`${names.subscription}.organizationId → ${names.organization}`]);
    expect(added.foreignKeys.blocked).toEqual([]);

    // Enforced now, and a re-run finds nothing to do.
    await expect(
      db.run(
        `INSERT INTO ${q(names.subscription)} (${q("id")}, ${q("organizationId")}) VALUES ('s2', 'ghost')`,
      ),
    ).rejects.toThrow();
    const again = await migrate("billing", { apply: true });
    expect(again.applied).toEqual([]);
    expect(again.plan.drift).toEqual([]);
  });

  it("prints but does not add a key the app has not allowed", async () => {
    const { db, migrate, config } = await setup();
    await migrate("billing", { apply: true });
    await migrate("teams", { apply: true });
    const result = await migrate("billing", { apply: true });
    if (db.dialect === "sqlite") return;
    expect(result.applied).toEqual([]);
    expect(result.foreignKeys.unapproved).toHaveLength(1);
    expect(result.sql).toContain('schema: { allowForeignKeys: { "billing": ["subscription"] } }');
    expect(result.sql).toMatch(/-- ALTER TABLE .+ ADD CONSTRAINT .+ FOREIGN KEY/u);
    const report = await checkSchema(config);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: "foreign-key-missing", severity: "warning" }),
    ]);
  });

  it("never adds one for a reference the plugin keeps in the app", async () => {
    const { migrate } = await setup({ enforced: "app" });
    await migrate("teams", { apply: true });
    const billing = await migrate("billing", { apply: true });
    expect(billing.sql).not.toMatch(/REFERENCES/u);
    expect(billing.foreignKeys.waiting).toEqual([]);
  });
});

describe("references that never get a cross-plugin foreign key", () => {
  it("leaves the app's own tables alone", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY)');
    const loyalty = definePlugin({
      name: "farm:loyalty",
      schema: defineSchema({
        models: {
          user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
          points: {
            fields: {
              id: { type: "string", primaryKey: true },
              userId: { type: "string", reference: { model: "user", field: "id" } },
            },
          },
        },
      }),
    });
    const config = { plugins: [loyalty], storage: { client: database } };
    const result = await migrateSchemaTables(findSchemaTableOwners(config)[0]!, {
      config,
      apply: true,
    });
    expect(result.sql).toContain("/* references user.id */");
    expect(result.sql).not.toMatch(/REFERENCES "user"/u);
    database.close();
  });

  it("skips a target that is not unique, or a different type", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { planCrossOwnerReferences } = await import("../schema-foreign-keys");
    const { createSchemaExecutor } = await import("../schema-migrate");
    const database = new DatabaseSync(":memory:");
    database.exec('CREATE TABLE "organization" ("id" TEXT PRIMARY KEY, "slug" TEXT)');
    const teams = {
      name: "teams",
      schema: defineSchema({
        models: {
          organization: {
            fields: { id: { type: "string", primaryKey: true }, slug: { type: "string" } },
          },
        },
      }),
    };
    const billing = {
      name: "billing",
      schema: defineSchema({
        models: {
          subscription: {
            fields: {
              id: { type: "string", primaryKey: true },
              bySlug: { type: "string", reference: { model: "organization", field: "slug" } },
              byNumber: { type: "integer", reference: { model: "organization", field: "id" } },
            },
          },
        },
      }),
    };
    const executor = createSchemaExecutor(database, "billing")!.executor;
    const sqlite = await planCrossOwnerReferences(billing, [teams], "sqlite", executor);
    expect(sqlite.skipped).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("not its primary key or unique") }),
    ]);
    // SQLite joins across types; Postgres and MySQL would not take the key.
    expect(sqlite.eligible.map((reference) => reference.fieldKey)).toEqual(["byNumber"]);
    const postgres = await planCrossOwnerReferences(billing, [teams], "postgres", {
      execute: async () => {},
      query: async () => [],
    });
    expect(postgres.skipped.map((entry) => entry.reason)).toEqual([
      expect.stringContaining("not its primary key or unique"),
      "the column types differ.",
    ]);
    database.close();
  });
});
