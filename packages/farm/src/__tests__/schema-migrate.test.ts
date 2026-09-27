// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createIntegrationOrm } from "../integration-orm";
import { defineSchema } from "../schema";
import {
  applySchemaMigration,
  createSchemaExecutor,
  describeSchemaDrift,
  formatSchemaMigration,
  planSchemaMigration,
  type FarmSchemaExecutor,
} from "../schema-migrate";
import {
  collectSchemaModels,
  escapeSqlString,
  generateSqlStatements,
  renderSqlSchemaFile,
  resolveSchemaModels,
  type FarmSqlDialect,
} from "../schema-sql";
import {
  collectOwnerModels,
  declareSchemaTables,
  findSchemaTableOwners,
  migrateSchemaTables,
} from "../schema-tables";

const schema = defineSchema({
  models: {
    tasks: {
      name: "todo_items",
      fields: {
        id: { type: "uuid", primaryKey: true },
        title: { type: "string", required: true },
        status: { type: "enum", values: ["open", "done"], default: "open" },
        priority: { type: "integer", default: 0 },
        listId: { type: "string", required: true, index: true, name: "list_id" },
        slug: { type: "string", unique: true },
        updatedAt: { type: "datetime", name: "updated_at" },
      },
      constraints: [{ type: "index", fields: ["listId", "status"] }],
    },
  },
});

const models = (only?: readonly string[]) => collectSchemaModels([["sync", schema, only]]);
const requireModule = createRequire(import.meta.url);
const postgresTestUrl = process.env.FARM_TEST_POSTGRES_URL;
const itWithPostgres = postgresTestUrl ? it : it.skip;

describe("schema name resolution", () => {
  /**
   * The runtime orm reads `model.name ?? modelKey`, so generated artifacts have
   * to agree with it. Defaulting to anything else describes tables the app
   * cannot read.
   */
  it("falls back to the schema's own keys, matching the runtime orm", () => {
    const resolved = resolveSchemaModels("billing", {
      models: {
        invoiceLines: {
          fields: { id: { type: "uuid", primaryKey: true }, lineTotal: { type: "integer" } },
        },
      },
    });

    expect(resolved.invoiceLines!.name).toBe("invoiceLines");
    expect(resolved.invoiceLines!.fields.lineTotal!.name).toBe("lineTotal");
  });

  it("still honors explicit name mappings", () => {
    const resolved = resolveSchemaModels("sync", schema);

    expect(resolved.tasks!.name).toBe("todo_items");
    expect(resolved.tasks!.fields.listId!.name).toBe("list_id");
  });

  it("rejects models with multiple field-level primary keys", () => {
    expect(() =>
      collectSchemaModels([
        [
          "organizations",
          {
            models: {
              memberships: {
                fields: {
                  organizationId: { type: "uuid", primaryKey: true },
                  userId: { type: "uuid", primaryKey: true },
                },
              },
            },
          },
        ],
      ]),
    ).toThrow(
      'Schema model "organizations.memberships" defines multiple primary-key fields: "organizationId", "userId". Composite primary keys are not supported.',
    );
  });

  it("validates primary keys after applying field overrides", () => {
    const resolved = resolveSchemaModels("organizations", {
      models: {
        memberships: {
          fields: {
            organizationId: { type: "uuid", primaryKey: true },
            userId: { type: "uuid", primaryKey: true },
          },
        },
      },
      override: {
        memberships: {
          fields: { userId: { primaryKey: false } },
        },
      },
    });

    expect(resolved.memberships!.fields.organizationId!.primaryKey).toBe(true);
    expect(resolved.memberships!.fields.userId!.primaryKey).toBe(false);
  });

  it("rejects internal references to missing target field keys", () => {
    expect(() =>
      resolveSchemaModels("billing", {
        models: {
          accounts: {
            fields: { id: { type: "uuid", primaryKey: true } },
          },
          invoices: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              accountId: {
                type: "uuid",
                reference: { model: "accounts", field: "missing" },
              },
            },
          },
        },
      }),
    ).toThrow(
      'Schema reference "billing.invoices.accountId" targets missing field "billing.accounts.missing".',
    );
  });

  it("resolves extension and override target fields before validating references", () => {
    const extended = defineSchema({
      models: {
        accounts: {
          fields: { id: { type: "uuid", primaryKey: true } },
        },
        invoices: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            accountId: {
              type: "uuid",
              reference: { model: "accounts", field: "externalId" },
            },
          },
        },
      },
      extend: {
        accounts: {
          fields: { externalId: { type: "uuid" } },
        },
      },
      override: {
        accounts: {
          fields: { externalId: { name: "external_id" } },
        },
      },
    });
    const resolved = resolveSchemaModels("billing", extended);
    const sql = generateSqlStatements(collectSchemaModels([["billing", extended]]), "postgres")
      .map((statement) => statement.sql)
      .join("\n");

    expect(resolved.accounts!.fields.externalId!.name).toBe("external_id");
    expect(sql).toContain('REFERENCES "accounts" ("external_id")');
  });

  it("allows references to models managed outside the schema owner", () => {
    const external = defineSchema({
      models: {
        invoices: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            customerId: {
              type: "uuid",
              reference: { model: "customers", field: "externalId" },
            },
          },
        },
      },
    });

    const sql = generateSqlStatements(collectSchemaModels([["billing", external]]), "postgres")[0]!
      .sql;

    expect(sql).toContain("/* references customers.externalId */");
  });

  it("rejects constraints that reference missing field keys", () => {
    expect(() =>
      resolveSchemaModels("billing", {
        models: {
          invoices: {
            fields: { id: { type: "uuid", primaryKey: true } },
            constraints: [{ type: "index", fields: ["missing"] }],
          },
        },
      }),
    ).toThrow('Schema index constraint on "billing.invoices" references missing field "missing".');
  });

  it("validates extension and override constraints against resolved field keys", () => {
    const extended = resolveSchemaModels("billing", {
      models: {
        invoices: {
          fields: { id: { type: "uuid", primaryKey: true } },
        },
      },
      extend: {
        invoices: {
          fields: { accountId: { type: "uuid", name: "account_id" } },
          constraints: [{ type: "index", fields: ["accountId"] }],
        },
      },
    });

    expect(extended.invoices!.constraints).toEqual([{ type: "index", fields: ["accountId"] }]);
    expect(extended.invoices!.fields.accountId!.name).toBe("account_id");

    expect(() =>
      resolveSchemaModels("billing", {
        models: {
          invoices: {
            fields: { id: { type: "uuid", primaryKey: true } },
          },
        },
        override: {
          invoices: {
            constraints: [{ type: "unique", fields: ["missing"] }],
          },
        },
      }),
    ).toThrow('Schema unique constraint on "billing.invoices" references missing field "missing".');
  });

  it("rejects two models that would claim the same table", () => {
    expect(() =>
      collectSchemaModels([
        ["alpha", { models: { tasks: { fields: { id: { type: "uuid" } } } } }],
        ["beta", { models: { tasks: { fields: { id: { type: "uuid" } } } } }],
      ]),
    ).toThrow(/conflicts with/);
  });

  it("claims only the models an owner was given", () => {
    const shared = defineSchema({
      models: {
        tasks: { fields: { id: { type: "uuid", primaryKey: true } } },
        secrets: { fields: { id: { type: "uuid", primaryKey: true } } },
      },
    });

    expect(collectSchemaModels([["sync", shared, ["tasks"]]]).map((m) => m.modelKey)).toEqual([
      "tasks",
    ]);
  });
});

describe("sql generation", () => {
  it.each(["postgres", "sqlite", "mysql"] as FarmSqlDialect[])(
    "rejects list fields instead of emitting a scalar column for %s",
    (dialect) => {
      const listSchema = defineSchema({
        models: {
          tasks: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              tags: { type: "string", list: true },
            },
          },
        },
      });

      expect(() =>
        generateSqlStatements(collectSchemaModels([["sync", listSchema]]), dialect),
      ).toThrow(
        `Schema field "sync.tasks.tags" declares list: true, but ${dialect} SQL generation does not support list fields. Use type: "json" for an array value or model the values in a related table.`,
      );
    },
  );

  it("uses the mapped table and column names, not the model keys", () => {
    const sql = generateSqlStatements(models(), "postgres")
      .map((statement) => statement.sql)
      .join("\n");

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "todo_items"');
    expect(sql).toContain('"list_id"');
    expect(sql).toContain('"updated_at"');
    expect(sql).not.toContain('"listId"'); // the schema key never reaches sql
  });

  it("carries primary key, not null, defaults, and unique across", () => {
    const [table] = generateSqlStatements(models(), "postgres");

    expect(table!.sql).toContain('"id" TEXT PRIMARY KEY');
    expect(table!.sql).toContain('"title" TEXT NOT NULL');
    expect(table!.sql).toContain("DEFAULT 'open'");
    expect(table!.sql).toContain('"priority" INTEGER');
    expect(table!.sql).toContain("UNIQUE");
  });

  it("emits an index per indexed field and per declared constraint", () => {
    const indexes = generateSqlStatements(models(), "postgres").filter(
      (statement) => statement.kind === "index",
    );

    expect(indexes.map((statement) => statement.target)).toEqual([
      "todo_items_list_id_idx",
      "todo_items_list_id_status_index",
    ]);
  });

  it("declares mysql indexes inside create table, which has no create index if not exists", () => {
    const statements = generateSqlStatements(models(), "mysql");
    const sql = statements.map((statement) => statement.sql).join("\n");

    // MySQL rejects `CREATE INDEX IF NOT EXISTS` with a syntax error, so the
    // indexes have to ride along with the table instead.
    expect(sql).not.toContain("IF NOT EXISTS `todo_items_list_id_idx`");
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/);
    expect(statements.filter((statement) => statement.kind === "index")).toEqual([]);

    expect(statements[0]!.sql).toContain("KEY `todo_items_list_id_idx` (`list_id`)");
    expect(statements[0]!.sql).toContain(
      "KEY `todo_items_list_id_status_index` (`list_id`, `status`)",
    );
  });

  it("declares a mysql unique constraint as a unique key on the table", () => {
    const unique = models();
    unique[0]!.model.constraints = [{ type: "unique", fields: ["listId", "status"] }];

    const [table] = generateSqlStatements(unique, "mysql");

    expect(table!.sql).toContain(
      "UNIQUE KEY `todo_items_list_id_status_unique` (`list_id`, `status`)",
    );
  });

  it("still uses standalone create index if not exists where the dialect supports it", () => {
    for (const dialect of ["postgres", "sqlite"] as FarmSqlDialect[]) {
      const sql = generateSqlStatements(models(), dialect)
        .map((statement) => statement.sql)
        .join("\n");

      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "todo_items_list_id_idx"');
    }
  });

  it.each(["postgres", "sqlite", "mysql"] as FarmSqlDialect[])(
    "renders valid multi-word on delete actions for %s",
    (dialect) => {
      const references = defineSchema({
        models: {
          parents: {
            fields: { id: { type: "uuid", primaryKey: true } },
          },
          children: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              cascadeParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id", onDelete: "cascade" },
              },
              restrictParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id", onDelete: "restrict" },
              },
              nullableParentId: {
                type: "uuid",
                nullable: true,
                reference: { model: "parents", field: "id", onDelete: "setNull" },
              },
              retainedParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id", onDelete: "noAction" },
              },
            },
          },
        },
      });
      const sql = generateSqlStatements(collectSchemaModels([["references", references]]), dialect)
        .map((statement) => statement.sql)
        .join("\n");

      expect(sql).toContain("ON DELETE CASCADE");
      expect(sql).toContain("ON DELETE RESTRICT");
      expect(sql).toContain("ON DELETE SET NULL");
      expect(sql).toContain("ON DELETE NO ACTION");
      expect(sql).not.toContain("ON DELETE SETNULL");
      expect(sql).not.toContain("ON DELETE NOACTION");
    },
  );

  it.each(["postgres", "sqlite", "mysql"] as FarmSqlDialect[])(
    "creates referenced tables before dependents for %s",
    (dialect) => {
      const forwardReference = defineSchema({
        models: {
          children: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              parentId: {
                type: "uuid",
                reference: { model: "parents", field: "id" },
              },
            },
          },
          parents: {
            fields: { id: { type: "uuid", primaryKey: true } },
          },
        },
      });
      const collected = collectSchemaModels([["references", forwardReference]]);

      expect(
        generateSqlStatements(collected, dialect)
          .filter((statement) => statement.kind === "table")
          .map((statement) => statement.target),
      ).toEqual(["parents", "children"]);

      const file = renderSqlSchemaFile(collected, dialect);
      expect(file.indexOf('model "parents"')).toBeLessThan(file.indexOf('model "children"'));
    },
  );

  itWithPostgres(
    "applies a forward-reference schema against Postgres",
    async () => {
      type PostgresTestClient = {
        connect(): Promise<void>;
        end(): Promise<void>;
        query(sql: string): Promise<unknown>;
      };
      const { Client } = requireModule("pg") as {
        Client: new (options: { connectionString: string }) => PostgresTestClient;
      };
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const parentTable = `farm_schema_parent_${suffix}`;
      const childTable = `farm_schema_child_${suffix}`;
      const client = new Client({ connectionString: postgresTestUrl! });
      const forwardReference = defineSchema({
        models: {
          children: {
            name: childTable,
            fields: {
              id: { type: "uuid", primaryKey: true },
              parentId: {
                type: "uuid",
                reference: { model: "parents", field: "id" },
              },
            },
          },
          parents: {
            name: parentTable,
            fields: { id: { type: "uuid", primaryKey: true } },
          },
        },
      });

      await client.connect();
      try {
        for (const statement of generateSqlStatements(
          collectSchemaModels([["references", forwardReference]]),
          "postgres",
        )) {
          await client.query(statement.sql);
        }

        await client.query(`INSERT INTO "${parentTable}" ("id") VALUES ('parent_1')`);
        await client.query(
          `INSERT INTO "${childTable}" ("id", "parentId") VALUES ('child_1', 'parent_1')`,
        );
      } finally {
        await client.query(`DROP TABLE IF EXISTS "${childTable}"`);
        await client.query(`DROP TABLE IF EXISTS "${parentTable}"`);
        await client.end();
      }
    },
    30_000,
  );

  it("allows a table to reference itself", () => {
    const selfReference = defineSchema({
      models: {
        categories: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            parentId: {
              type: "uuid",
              nullable: true,
              reference: { model: "categories", field: "id" },
            },
          },
        },
      },
    });

    expect(
      generateSqlStatements(collectSchemaModels([["references", selfReference]]), "postgres")[0]!
        .sql,
    ).toContain('REFERENCES "categories" ("id")');
  });

  it("rejects cross-table reference cycles before emitting SQL", () => {
    const cycle = defineSchema({
      models: {
        authors: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            profileId: {
              type: "uuid",
              reference: { model: "profiles", field: "id" },
            },
          },
        },
        profiles: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            authorId: {
              type: "uuid",
              reference: { model: "authors", field: "id" },
            },
          },
        },
      },
    });
    const collected = collectSchemaModels([["accounts", cycle]]);
    const message =
      'Schema table references contain a cycle: "accounts.authors" -> "accounts.profiles" -> "accounts.authors".';

    expect(() => generateSqlStatements(collected, "postgres")).toThrow(message);
    expect(() => renderSqlSchemaFile(collected, "postgres")).toThrow(message);
  });

  it.each(["app", "none"] as const)(
    "allows a cycle closed by an enforced: %s reference",
    (enforced) => {
      const cycle = defineSchema({
        models: {
          authors: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              profileId: {
                type: "uuid",
                reference: { model: "profiles", field: "id", enforced },
              },
            },
          },
          profiles: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              authorId: {
                type: "uuid",
                reference: { model: "authors", field: "id" },
              },
            },
          },
        },
      });
      const statements = generateSqlStatements(
        collectSchemaModels([["accounts", cycle]]),
        "postgres",
      ).map((statement) => statement.sql);

      expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS "authors"');
      expect(statements[0]).not.toContain("REFERENCES");
      expect(statements[1]).toContain('REFERENCES "authors" ("id")');
    },
  );

  it.each([
    ["the default", undefined, true],
    ['enforced: "db"', "db", true],
    ['enforced: "app"', "app", false],
    ['enforced: "none"', "none", false],
  ] as const)("uses database references for %s", (_label, enforced, expected) => {
    const reference = defineSchema({
      models: {
        parents: {
          fields: { id: { type: "uuid", primaryKey: true } },
        },
        children: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            parentId: {
              type: "uuid",
              reference: {
                model: "parents",
                field: "id",
                ...(enforced ? { enforced } : {}),
              },
            },
          },
        },
      },
    });
    const table = generateSqlStatements(
      collectSchemaModels([["references", reference]]),
      "postgres",
    ).find((statement) => statement.target === "children")!;

    expect(table.sql.includes('REFERENCES "parents" ("id")')).toBe(expected);
    if (!expected) {
      expect(table.sql).toContain("/* references parents.id */");
    }
  });

  it.each([
    ["postgres", "TIMESTAMPTZ", '"todo_items"'],
    ["sqlite", "TEXT", '"todo_items"'],
    ["mysql", "DATETIME", "`todo_items`"],
  ] as Array<[FarmSqlDialect, string, string]>)(
    "maps types and quoting for %s",
    (dialect, dateType, quotedTable) => {
      const [table] = generateSqlStatements(models(), dialect);

      expect(table!.sql).toContain(quotedTable);
      expect(table!.sql).toContain(dateType);
    },
  );

  it("renders a reviewable file naming the owner of each model", () => {
    const file = renderSqlSchemaFile(models(), "postgres");

    expect(file).toContain("-- Generated by Farm.js CLI");
    expect(file).toContain('-- Owner "sync" model "tasks"');
  });
});

/** An executor over an in-memory sqlite database. */
async function sqliteExecutor() {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  const executor: FarmSchemaExecutor = {
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
    const plan = await planSchemaMigration(models(), "sqlite", executor);

    expect(plan.statements.length).toBeGreaterThan(0);
    expect(plan.upToDate).toEqual([]);
    expect(plan.drift).toEqual([]);
  });

  it("plans nothing once the table matches the schema", async () => {
    const { executor } = await sqliteExecutor();
    await applySchemaMigration(await planSchemaMigration(models(), "sqlite", executor), executor);

    const second = await planSchemaMigration(models(), "sqlite", executor);
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

    const plan = await planSchemaMigration(models(), "sqlite", executor);

    expect(plan.statements).toEqual([]); // nothing is emitted for it
    expect(plan.drift).toHaveLength(1);
    expect(plan.drift[0]!.missingColumns).toEqual(
      expect.arrayContaining(["status", "priority", "slug", "updated_at"]),
    );
    expect(plan.drift[0]!.extraColumns).toEqual(["legacy_note"]);

    const applied = await applySchemaMigration(plan, executor);
    expect(applied.applied).toEqual([]);
    expect(applied.skipped).toHaveLength(1);

    // The pre-existing column is untouched.
    const columns = await executor.query("pragma table_info('todo_items')");
    expect(columns.map((row) => row.name)).toContain("legacy_note");
  });

  it("reports definition and index drift even when every column name matches", async () => {
    const { database, executor } = await sqliteExecutor();
    database.exec(`
      create table todo_items (
        id INTEGER,
        title INTEGER,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        list_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const plan = await planSchemaMigration(models(), "sqlite", executor);

    expect(plan.statements).toEqual([]);
    expect(plan.upToDate).toEqual([]);
    expect(plan.drift).toHaveLength(1);
    expect(plan.drift[0]).toMatchObject({
      missingColumns: [],
      extraColumns: [],
      changedColumns: [
        {
          column: "id",
          differences: expect.arrayContaining(["type", "nullability", "primaryKey"]),
        },
        {
          column: "title",
          differences: ["type", "nullability"],
        },
        {
          column: "status",
          differences: ["default"],
        },
      ],
      missingIndexes: expect.arrayContaining([
        expect.objectContaining({ columns: ["list_id"], unique: false }),
        expect.objectContaining({ columns: ["slug"], unique: true }),
        expect.objectContaining({ columns: ["list_id", "status"], unique: false }),
      ]),
    });

    expect(describeSchemaDrift(plan.drift)).toContain(
      'changed column status: default expected "open", found none',
    );
    expect(describeSchemaDrift(plan.drift)).toContain("missing indexes:");
  });

  it("reports an index removed from an otherwise matching table", async () => {
    const { database, executor } = await sqliteExecutor();
    await applySchemaMigration(await planSchemaMigration(models(), "sqlite", executor), executor);
    database.exec(`drop index "todo_items_list_id_idx"`);
    database.exec(`create index "legacy_title_idx" on "todo_items" ("title")`);

    const plan = await planSchemaMigration(models(), "sqlite", executor);

    expect(plan.upToDate).toEqual([]);
    expect(plan.drift).toHaveLength(1);
    expect(plan.drift[0]!.changedColumns).toEqual([]);
    expect(plan.drift[0]!.missingIndexes).toEqual([
      {
        name: "todo_items_list_id_idx",
        columns: ["list_id"],
        unique: false,
      },
    ]);
    expect(plan.drift[0]!.extraIndexes).toEqual([
      {
        name: "legacy_title_idx",
        columns: ["title"],
        unique: false,
      },
    ]);
  });

  it("reports changed foreign-key actions without altering the table", async () => {
    const references = collectSchemaModels([
      [
        "app",
        defineSchema({
          models: {
            parents: { fields: { id: { type: "uuid", primaryKey: true } } },
            children: {
              fields: {
                id: { type: "uuid", primaryKey: true },
                parentId: {
                  type: "uuid",
                  name: "parent_id",
                  reference: { model: "parents", field: "id", onDelete: "cascade" },
                },
              },
            },
          },
        }),
      ],
    ]);
    const { database, executor } = await sqliteExecutor();
    const generated = await sqliteExecutor();
    await applySchemaMigration(
      await planSchemaMigration(references, "sqlite", generated.executor),
      generated.executor,
    );

    const matching = await planSchemaMigration(references, "sqlite", generated.executor);
    expect(matching.upToDate).toEqual(["parents", "children"]);
    expect(matching.drift).toEqual([]);

    database.exec(`
      create table parents (id TEXT primary key);
      create table children (
        id TEXT primary key,
        parent_id TEXT NOT NULL references parents (id) on delete restrict
      );
    `);

    const plan = await planSchemaMigration(references, "sqlite", executor);

    expect(plan.upToDate).toEqual(["parents"]);
    expect(plan.drift).toHaveLength(1);
    expect(plan.drift[0]).toMatchObject({
      table: "children",
      missingReferences: [
        {
          column: "parent_id",
          referencedTable: "parents",
          referencedColumn: "id",
          onDelete: "cascade",
        },
      ],
      extraReferences: [
        {
          column: "parent_id",
          referencedTable: "parents",
          referencedColumn: "id",
          onDelete: "restrict",
        },
      ],
    });
  });

  it("only creates the tables that are missing, leaving the rest alone", async () => {
    const { database, executor } = await sqliteExecutor();
    const two = collectSchemaModels([
      [
        "sync",
        defineSchema({
          models: {
            present: { fields: { id: { type: "uuid", primaryKey: true } } },
            absent: { fields: { id: { type: "uuid", primaryKey: true } } },
          },
        }),
      ],
    ]);
    database.exec(`create table present (id TEXT primary key)`);

    const plan = await planSchemaMigration(two, "sqlite", executor);

    expect(plan.upToDate).toEqual(["present"]);
    expect(plan.statements.map((statement) => statement.target)).toEqual(["absent"]);
  });

  it("renders a migration file, including when there is nothing to do", async () => {
    const { executor } = await sqliteExecutor();
    const plan = await planSchemaMigration(models(), "sqlite", executor);

    const sql = formatSchemaMigration(plan, "sync");
    expect(sql).toContain("Generated by `farm sync migrate`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");

    await applySchemaMigration(plan, executor);
    const empty = formatSchemaMigration(
      await planSchemaMigration(models(), "sqlite", executor),
      "sync",
    );
    expect(empty).toContain("Nothing to create");
  });
});

describe("generated sql against the runtime orm", () => {
  /**
   * The point of the command: what it creates is what the app then reads. This
   * fails if the emitter and `createIntegrationOrm` ever disagree on a name.
   */
  it("produces tables the runtime orm can read and write", async () => {
    const { database, executor } = await sqliteExecutor();
    // No `name` anywhere: the defaults are what must line up.
    const appSchema = defineSchema({
      models: {
        tasks: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            title: { type: "string", required: true },
            listId: { type: "string", required: true, index: true },
          },
        },
      },
    });

    await applySchemaMigration(
      await planSchemaMigration(collectSchemaModels([["app", appSchema]]), "sqlite", executor),
      executor,
    );

    const orm = await createIntegrationOrm({ schema: appSchema, client: database });
    await orm.tasks.create({ data: { id: "t1", title: "round trip", listId: "list-a" } });
    const rows = await orm.tasks.findMany({});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "round trip", listId: "list-a" });
  });
});

describe("client detection", () => {
  it("reports a key-value storage mount as having no tables", async () => {
    const { createStorage } = await import("unstorage");
    expect(createSchemaExecutor(createStorage(), "sync")).toBeNull();
  });

  it("names the owner when a client cannot run migrations", () => {
    expect(() => createSchemaExecutor({ notADatabase: true }, "jobs")).toThrow(
      /jobs: the configured client cannot run migrations/,
    );
  });
});

describe("table owners", () => {
  /** A plugin-shaped object that declares it owns the schema's tables. */
  function ownerPlugin(name: string, client: unknown) {
    return declareSchemaTables(
      { name: `farm:${name}` },
      { name, schema, resolveClient: async () => client },
    );
  }

  it("finds owners across plugins and integrations", () => {
    const owners = findSchemaTableOwners({
      plugins: [{ name: "farm:unrelated" }, ownerPlugin("sync", null)],
      integrations: { jobs: ownerPlugin("jobs", null) },
    });

    expect(owners.map((owner) => owner.name)).toEqual(["sync", "jobs"]);
  });

  it("does not expose the declaration to config serialization", () => {
    const plugin = ownerPlugin("sync", null);
    expect(Object.keys(plugin)).toEqual(["name"]);
    expect(JSON.parse(JSON.stringify(plugin))).toEqual({ name: "farm:sync" });
  });

  it("resolves a declaration down to the models tooling works with", () => {
    const owner = findSchemaTableOwners({ plugins: [ownerPlugin("sync", null)] })[0]!;
    expect(collectOwnerModels(owner).map((model) => model.modelName)).toEqual(["todo_items"]);
  });

  it("creates an owner's tables, then reports it is up to date", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const owner = findSchemaTableOwners({ plugins: [ownerPlugin("sync", database)] })[0]!;
    const logs: string[] = [];

    const first = await migrateSchemaTables(owner, {
      apply: true,
      log: (message) => logs.push(message),
    });
    expect(first.applied).toContain("todo_items");

    const columns = database.prepare("pragma table_info('todo_items')").all() as any[];
    expect(columns.map((row) => row.name)).toEqual(
      expect.arrayContaining(["id", "title", "list_id", "updated_at"]),
    );

    const second = await migrateSchemaTables(owner, {
      apply: true,
      log: (message) => logs.push(message),
    });
    expect(second.applied).toEqual([]);
    expect(logs.join("\n")).toContain("Already up to date");
  });

  it("prints sql without touching the database unless asked", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");

    const result = await migrateSchemaTables(
      findSchemaTableOwners({ plugins: [ownerPlugin("sync", database)] })[0]!,
    );

    expect(result.sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(result.applied).toEqual([]);
    const present = database
      .prepare("select name from sqlite_master where type='table'")
      .all() as any[];
    expect(present.map((row) => row.name)).not.toContain("todo_items");
  });

  it("names the owner when it stores through a storage mount", async () => {
    const { createStorage } = await import("unstorage");
    const logs: string[] = [];

    const result = await migrateSchemaTables(
      findSchemaTableOwners({ plugins: [ownerPlugin("jobs", createStorage())] })[0]!,
      { log: (message) => logs.push(message) },
    );

    expect(result.applied).toEqual([]);
    expect(logs.join("\n")).toContain("jobs stores data through a storage mount");
  });

  it("hands the app config to an owner that reads its client from there", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    // An integration configured through `storage.client` rather than its own
    // options — the shape @farm.js/stripe uses.
    const integration = declareSchemaTables(
      { type: "stripe" },
      {
        name: "stripe",
        schema,
        resolveClient: async (config) =>
          (config.storage as { client?: unknown } | undefined)?.client,
      },
    );

    const result = await migrateSchemaTables(
      findSchemaTableOwners({ integrations: { billing: integration } })[0]!,
      { apply: true, config: { storage: { client: database } } },
    );

    expect(result.applied).toContain("todo_items");
  });

  it("finds nothing when no plugin declares tables", () => {
    expect(findSchemaTableOwners({ plugins: [{ name: "farm:unrelated" }] })).toEqual([]);
    expect(findSchemaTableOwners({})).toEqual([]);
  });
});

/** The declaration contract is structural, so a third party can satisfy it. */
describe("a third-party plugin", () => {
  it("gets migrations by declaring its schema and client", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");

    const plugin = declareSchemaTables(
      { name: "acme:webhooks" },
      {
        name: "webhooks",
        schema: defineSchema({
          models: {
            webhooks: {
              fields: {
                id: { type: "uuid", primaryKey: true },
                url: { type: "string", required: true },
                deliveredAt: { type: "datetime", name: "delivered_at" },
              },
            },
          },
        }),
        resolveClient: async () => database,
      },
    );

    const result = await migrateSchemaTables(findSchemaTableOwners({ plugins: [plugin] })[0]!, {
      apply: true,
    });

    expect(result.applied).toEqual(["webhooks"]);
    const columns = database.prepare("pragma table_info('webhooks')").all() as any[];
    expect(columns.map((row) => row.name)).toEqual(["id", "url", "delivered_at"]);
  });
});

describe("dialect-specific introspection", () => {
  function recordingExecutor(resolveRows: (sql: string) => Record<string, unknown>[] = () => []) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const executor: FarmSchemaExecutor = {
      async execute() {},
      async query(sql, params) {
        queries.push({ sql, params });
        return resolveRows(sql);
      },
    };
    return { executor, queries };
  }

  const primaryKeyModels = () =>
    collectSchemaModels([
      [
        "app",
        defineSchema({
          models: { records: { fields: { id: { type: "uuid", primaryKey: true } } } },
        }),
      ],
    ]);

  it("binds $1 and scopes to the current schema on Postgres", async () => {
    // pg rejects `?` outright, so introspection threw and migrate could not
    // run at all against Postgres.
    const { executor, queries } = recordingExecutor();
    await planSchemaMigration(models(), "postgres", executor);

    const lookup = queries.find((entry) => entry.sql.includes("information_schema.columns"));
    expect(lookup?.sql).toContain("table_name = $1");
    expect(lookup?.sql).toContain("table_schema = current_schema()");
    expect(lookup?.sql).not.toContain("table_name = ?");
  });

  it("binds ? and scopes to the current database on MySQL", async () => {
    const { executor, queries } = recordingExecutor();
    await planSchemaMigration(models(), "mysql", executor);

    const lookup = queries.find((entry) => entry.sql.includes("information_schema.columns"));
    expect(lookup?.sql).toContain("table_name = ?");
    expect(lookup?.sql).toContain("table_schema = database()");
  });

  it("normalizes Postgres column and primary-key metadata", async () => {
    const { executor, queries } = recordingExecutor((sql) => {
      if (sql.includes("information_schema.columns")) {
        return [
          {
            column_name: "id",
            data_type: "text",
            udt_name: "text",
            is_nullable: "NO",
            column_default: null,
          },
        ];
      }
      if (sql.includes("pg_catalog.pg_index")) {
        return [
          {
            index_name: "records_pkey",
            is_unique: true,
            is_primary: true,
            column_name: "id",
            column_position: 1,
          },
        ];
      }
      return [];
    });

    const plan = await planSchemaMigration(primaryKeyModels(), "postgres", executor);

    expect(plan.upToDate).toEqual(["records"]);
    expect(plan.drift).toEqual([]);
    expect(queries.some((entry) => entry.sql.includes("referential_constraints"))).toBe(true);
  });

  it("normalizes MySQL column and primary-key metadata", async () => {
    const { executor, queries } = recordingExecutor((sql) => {
      if (sql.includes("information_schema.columns")) {
        return [
          {
            column_name: "id",
            data_type: "varchar",
            column_type: "varchar(255)",
            is_nullable: "NO",
            column_default: null,
          },
        ];
      }
      if (sql.includes("information_schema.statistics")) {
        return [
          {
            index_name: "PRIMARY",
            non_unique: 0,
            column_name: "id",
            seq_in_index: 1,
          },
        ];
      }
      return [];
    });

    const plan = await planSchemaMigration(primaryKeyModels(), "mysql", executor);

    expect(plan.upToDate).toEqual(["records"]);
    expect(plan.drift).toEqual([]);
    expect(queries.some((entry) => entry.sql.includes("referential_constraints"))).toBe(true);
  });

  it("escapes backslashes in MySQL string literals, and only there", () => {
    // MySQL treats a backslash as an escape character unless
    // NO_BACKSLASH_ESCAPES is set, so a default ending in one escaped the
    // closing quote and broke the generated DDL.
    expect(escapeSqlString("C:\\path\\", "mysql")).toBe("C:\\\\path\\\\");
    expect(escapeSqlString("C:\\path\\", "postgres")).toBe("C:\\path\\");
    expect(escapeSqlString("it's", "mysql")).toBe("it''s");
    expect(escapeSqlString("it's")).toBe("it''s");
  });

  it("identifies a mysql2-shaped client instead of assuming Postgres", () => {
    const mysqlClient = {
      query: async () => [[], []],
      escapeId: (value: string) => `\`${value}\``,
      format: (sql: string) => sql,
    };
    const pgClient = { query: async () => ({ rows: [] }) };

    expect(createSchemaExecutor(mysqlClient, "app")?.dialect).toBe("mysql");
    expect(createSchemaExecutor(pgClient, "app")?.dialect).toBe("postgres");
  });
});
