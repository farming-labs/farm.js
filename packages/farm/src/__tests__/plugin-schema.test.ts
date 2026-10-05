// @vitest-environment node
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { createIntegrationOrm } from "../integration-orm";
import { definePlugin } from "../plugin";
import { defineSchema } from "../schema";
import { checkSchema } from "../schema-check";
import { renameSchema, type FarmSchemaRenames } from "../schema-rename";
import { collectSchemaModels, generateSqlStatements, type FarmSqlDialect } from "../schema-sql";
import {
  declareSchemaTables,
  findSchemaTableOwners,
  migrateSchemaTables,
  readSchemaTables,
} from "../schema-tables";

const requireModule = createRequire(import.meta.url);
const postgresTestUrl = process.env.FARM_TEST_POSTGRES_URL;

if (process.env.FARM_REQUIRE_TEST_POSTGRES === "1" && !postgresTestUrl) {
  throw new Error("FARM_TEST_POSTGRES_URL is required when FARM_REQUIRE_TEST_POSTGRES=1.");
}

/** A teams plugin as an author would write it: its own tables, and the app's `user`. */
const teamsSchema = defineSchema({
  models: {
    user: {
      external: true,
      fields: { id: { type: "string", primaryKey: true }, email: { type: "string" } },
    },
    organization: {
      fields: { id: { type: "uuid", primaryKey: true }, name: { type: "string", required: true } },
    },
    member: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        organizationId: {
          type: "uuid",
          required: true,
          reference: { model: "organization", field: "id", onDelete: "cascade" },
        },
        userId: {
          type: "string",
          required: true,
          reference: { model: "user", field: "id", enforced: "app" },
        },
      },
    },
  },
});

const teams = (options: { schema?: FarmSchemaRenames<typeof teamsSchema> } = {}) =>
  definePlugin({ name: "farm:teams", schema: renameSchema(teamsSchema, options.schema) });

describe("definePlugin({ schema })", () => {
  it("leaves a plugin without a schema exactly as it was", () => {
    const plugin = { name: "acme:plain" };
    expect(definePlugin(plugin)).toBe(plugin);
    expect(readSchemaTables(plugin)).toBeUndefined();
  });

  it("registers the tables under the last part of the plugin name", () => {
    for (const [pluginName, owner] of [
      ["farm:teams", "teams"],
      ["@acme/farm:audit-log", "audit-log"],
      ["@acme/jobs", "jobs"],
      ["billing", "billing"],
    ]) {
      const plugin = definePlugin({ name: pluginName!, schema: teamsSchema });
      expect(readSchemaTables(plugin)?.name).toBe(owner);
    }
  });

  it("refuses a plugin name that cannot become a command", () => {
    expect(() => definePlugin({ name: "acme:audit log", schema: teamsSchema })).toThrow(
      /must end in a word made of letters, numbers/,
    );
    expect(() => definePlugin({ name: "acme:", schema: teamsSchema })).toThrow(
      /farm <name> migrate/,
    );
  });

  it("keeps a declaration one of Farm's own packages recorded itself", () => {
    const plugin = declareSchemaTables(
      { name: "farm:teams", schema: teamsSchema },
      { name: "orgs", schema: teamsSchema, resolveClient: async () => null },
    );
    expect(readSchemaTables(definePlugin(plugin))?.name).toBe("orgs");
  });

  it("registers schemas on plugins bound to an integration too", () => {
    const plugin = definePlugin.forIntegration<{ ok: true }>()({
      name: "farm:teams",
      schema: teamsSchema,
    });
    expect(readSchemaTables(plugin)?.name).toBe("teams");
  });

  it("reaches the database through the app's storage.client", async () => {
    const client = { query() {} };
    const [owner] = findSchemaTableOwners({ plugins: [teams()] });
    expect(await owner!.resolveClient({ storage: { client } })).toBe(client);
    expect(await owner!.resolveClient({ storage: { client: () => client } })).toBe(client);
  });

  it("keeps the tables in the plugin's own database when it sets one", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const own = new DatabaseSync(":memory:");
    const appDatabase = { query() {} };
    for (const client of [own, () => own, async () => own]) {
      const plugin = definePlugin({
        name: "farm:teams",
        schema: teamsSchema,
        database: { client, dialect: "sqlite" },
      });
      const [owner] = findSchemaTableOwners({ plugins: [plugin] });
      expect(owner!.dialect).toBe("sqlite");
      expect(await owner!.resolveClient({ storage: { client: appDatabase } })).toBe(own);
    }

    // And migrate and check use it, not storage.client.
    const config = {
      plugins: [
        definePlugin({ name: "farm:teams", schema: teamsSchema, database: { client: own } }),
      ],
      storage: { client: appDatabase },
    };
    await migrateSchemaTables(findSchemaTableOwners(config)[0]!, { config, apply: true });
    own.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL)');
    expect((await checkSchema(config)).issues).toEqual([]);
    own.close();
  });

  it("says when the plugin's own database gives no connection", async () => {
    const plugin = definePlugin({
      name: "farm:teams",
      schema: teamsSchema,
      database: { client: () => undefined },
    });
    await expect(
      findSchemaTableOwners({ plugins: [plugin] })[0]!.resolveClient({}),
    ).rejects.toThrow("The teams plugin's `database.client` returned no connection.");
  });

  it("refuses a database without a schema", () => {
    expect(() => definePlugin({ name: "farm:teams", database: { client: {} } })).toThrow(
      /sets `database` without a `schema`/,
    );
  });

  it("says to set storage.client when the app has not", async () => {
    const report = await checkSchema({ plugins: [teams()] });
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "client-unavailable",
        message: expect.stringContaining("set `storage.client` in farm.config"),
      }),
    ]);
  });

  it("rejects an invalid schema while the config loads", () => {
    const broken = defineSchema({
      models: {
        member: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            parentId: { type: "uuid", reference: { model: "member", field: "missing" } },
          },
        },
      },
    });
    expect(() => definePlugin({ name: "farm:teams", schema: broken })).toThrow(
      /"teams\.member\.parentId" targets missing field/,
    );
  });

  it("reports two plugins that would share one migrate command", async () => {
    const other = definePlugin({
      name: "acme:teams",
      schema: defineSchema({
        models: { seat: { fields: { id: { type: "uuid", primaryKey: true } } } },
      }),
    });
    const report = await checkSchema({ plugins: [teams(), other] });
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "owner-conflict",
        severity: "error",
        message: expect.stringContaining('2 plugins declare tables under the name "teams"'),
      }),
    );
    // The same plugin listed twice is not a conflict.
    const plugin = teams();
    const twice = await checkSchema({ plugins: [plugin, plugin] });
    expect(twice.issues.map((issue) => issue.code)).not.toContain("owner-conflict");
  });

  it("does not expose the declaration to config serialization", () => {
    expect(Object.keys(teams())).toEqual(["name", "schema"]);
  });
});

describe("external models", () => {
  it("are never collected for creation, generation, or conflicts", () => {
    const models = collectSchemaModels([["teams", teamsSchema]]);
    expect(models.map((model) => model.modelKey)).toEqual(["organization", "member"]);
    // An app that owns `user` itself does not conflict with the description.
    expect(() =>
      collectSchemaModels([
        ["teams", teamsSchema],
        [
          "app",
          defineSchema({
            models: { user: { fields: { id: { type: "string", primaryKey: true } } } },
          }),
        ],
      ]),
    ).not.toThrow();
  });

  it("emit no sql of their own, and no foreign key from tables that point at them", () => {
    // A database-enforced reference: it would get a foreign key if `user` were created here.
    const enforced = defineSchema({
      models: {
        ...teamsSchema.models,
        member: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            userId: { type: "string", required: true, reference: { model: "user", field: "id" } },
          },
        },
      },
    });
    for (const dialect of ["sqlite", "postgres", "mysql"] as FarmSqlDialect[]) {
      const sql = generateSqlStatements(collectSchemaModels([["teams", enforced]]), dialect)
        .map((statement) => statement.sql)
        .join("\n");
      expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS ["`]user["`]/u);
      expect(sql).not.toMatch(/REFERENCES ["`]user["`]/u);
    }
  });
});

describe("renameSchema", () => {
  it("returns the schema untouched without renames, and never mutates it", () => {
    const before = JSON.stringify(teamsSchema);
    expect(renameSchema(teamsSchema, undefined)).toBe(teamsSchema);
    renameSchema(teamsSchema, { user: { name: "members_auth", fields: { id: "user_id" } } });
    expect(JSON.stringify(teamsSchema)).toBe(before);
  });

  it("names the app's real table in the comment migrate writes for an external reference", () => {
    const renamed = renameSchema(teamsSchema, {
      user: { name: "members_auth", fields: { id: "user_id" } },
    });
    const sql = generateSqlStatements(collectSchemaModels([["teams", renamed]]), "postgres")
      .map((statement) => statement.sql)
      .join("\n");
    expect(sql).toContain("/* references members_auth.user_id */");
    expect(sql).not.toContain("references user.id");
  });

  it("changes table and column names, and references follow", () => {
    const renamed = renameSchema(teamsSchema, {
      user: { name: "members_auth", fields: { id: "user_id" } },
      member: { name: "team_members", fields: { userId: "user_ref" } },
    });
    const [organization, member] = collectSchemaModels([["teams", renamed]]);
    expect(organization!.modelName).toBe("organization");
    expect(member!.modelName).toBe("team_members");
    expect(member!.model.fields.userId!.name).toBe("user_ref");
    // Types, keys, and references are the author's; only names changed.
    expect(member!.model.fields.userId!.reference).toEqual(
      teamsSchema.models.member.fields.userId.reference,
    );
  });

  it("keeps the author's own overrides for the same model", () => {
    const schema = defineSchema({
      ...teamsSchema,
      override: { member: { fields: { userId: { index: true } } } },
    });
    const renamed = renameSchema(schema, { member: { fields: { userId: "user_ref" } } });
    const member = collectSchemaModels([["teams", renamed]]).find(
      (model) => model.modelKey === "member",
    );
    expect(member!.model.fields.userId).toMatchObject({ name: "user_ref", index: true });
  });

  it("names the models or fields that exist when a rename has a typo", () => {
    expect(() => renameSchema(teamsSchema, { usr: { name: "x" } } as never)).toThrow(
      /no such model\. Models: user, organization, member/,
    );
    expect(() => renameSchema(teamsSchema, { user: { fields: { ID: "x" } } } as never)).toThrow(
      /"user\.ID": the model has no such field\. Fields: id, email/,
    );
    // Inherited object keys are not models or fields.
    expect(() => renameSchema(teamsSchema, { constructor: { name: "x" } } as never)).toThrow(
      /no such model/,
    );
    expect(() =>
      renameSchema(teamsSchema, { user: { fields: { toString: "x" } } } as never),
    ).toThrow(/no such field/);
  });

  it("rejects empty names and two models on one table", () => {
    expect(() => renameSchema(teamsSchema, { user: { name: " " } })).toThrow(/non-empty string/);
    expect(() => renameSchema(teamsSchema, { user: { fields: { id: "" } } })).toThrow(
      /non-empty string/,
    );
    expect(() => renameSchema(teamsSchema, { member: { name: "USER" } })).toThrow(
      /"user" and "member" would both use the table "USER"/,
    );
    expect(() => renameSchema(teamsSchema, { user: { fields: { email: "id" } } })).toThrow(
      /duplicate field name "id"/,
    );
  });

  it("refuses something that is not a rename map", () => {
    expect(() => renameSchema(teamsSchema, "user" as never)).toThrow(/keyed by model name/);
    expect(() => renameSchema(teamsSchema, [] as never)).toThrow(/keyed by model name/);
  });
});

type TestDatabase = {
  dialect: FarmSqlDialect;
  client: unknown;
  run(sql: string): Promise<void>;
  rows(sql: string): Promise<Array<Record<string, unknown>>>;
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
];

describe.each(databases)("an app pointing a plugin at its own tables on %s", (_name, open) => {
  const suffix = `${process.pid}_${Date.now() % 100000}`;
  const names = {
    users: `members_auth_${suffix}`,
    organizations: `orgs_${suffix}`,
    members: `team_members_${suffix}`,
  };
  let db: TestDatabase;

  afterAll(async () => {
    for (const table of [names.members, names.organizations, names.users]) {
      await db?.run(`DROP TABLE IF EXISTS "${table}"`).catch(() => undefined);
    }
    await db?.close();
  });

  it("migrates, checks, and queries the real tables end to end", async () => {
    db = await open();
    const plugin = teams({
      schema: {
        user: { name: names.users, fields: { id: "user_id" } },
        organization: { name: names.organizations },
        member: { name: names.members, fields: { userId: "user_ref" } },
      },
    });
    const config = { plugins: [plugin], storage: { client: db.client } };

    // Before the app's auth tables exist: the plugin's reference names the real table.
    const [owner] = findSchemaTableOwners(config);
    await migrateSchemaTables(owner!, { config, apply: true });
    const before = await checkSchema(config);
    expect(before.issues).toEqual([
      expect.objectContaining({
        code: "reference-table-missing",
        message: expect.stringContaining(`references "${names.users}.user_id"`),
      }),
    ]);

    // The app's own migration creates its users table, with its own names.
    await db.run(
      `CREATE TABLE "${names.users}" ("user_id" TEXT PRIMARY KEY, "email" TEXT NOT NULL)`,
    );
    await db.run(
      `INSERT INTO "${names.users}" ("user_id", "email") VALUES ('u1', 'a@example.com')`,
    );

    const after = await checkSchema(config);
    expect(after.issues).toEqual([]);

    // Migrate created only the plugin's tables, under the app's names, and
    // running it again is a no-op.
    const rerun = await migrateSchemaTables(owner!, { config, apply: true });
    expect(rerun.applied).toEqual([]);

    // At runtime the plugin keeps using its own names.
    const orm = (await createIntegrationOrm({
      schema: plugin.schema!,
      client: db.client,
    })) as Record<
      string,
      {
        create(input: unknown): Promise<unknown>;
        findMany(input: unknown): Promise<Array<Record<string, unknown>>>;
      }
    >;
    await orm.organization!.create({ data: { id: "o1", name: "Acme" } });
    await orm.member!.create({ data: { id: "m1", organizationId: "o1", userId: "u1" } });

    expect(await orm.member!.findMany({})).toEqual([
      expect.objectContaining({ id: "m1", organizationId: "o1", userId: "u1" }),
    ]);
    expect(await orm.user!.findMany({})).toEqual([
      expect.objectContaining({ id: "u1", email: "a@example.com" }),
    ]);
    // And the rows are in the app's tables and columns.
    expect(await db.rows(`SELECT "user_ref" FROM "${names.members}"`)).toEqual([
      { user_ref: "u1" },
    ]);
  });
});
