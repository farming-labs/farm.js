// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createIntegrationOrm, farmIntegrationSchemaToOrmSchema } from "../integration-orm";
import {
  defineIntegration,
  defineIntegrationSchema,
  dispatchIntegrationRequest,
  getRegisteredIntegrationRuntime,
  resolveIntegrationPlugins,
} from "../integrations";
import { PluginManager } from "../plugin";
import { collectSchemaModels, generateSqlStatements } from "../schema-sql";

type SqliteDatabase = {
  exec(sql: string): unknown;
  close(): unknown;
};

const requireModule = createRequire(import.meta.url);
const tempDirs = new Set<string>();
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const supportsNodeSqlite = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

async function createSqliteDatabase(filePath: string): Promise<SqliteDatabase> {
  const { DatabaseSync } = requireModule("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  return new DatabaseSync(filePath) as SqliteDatabase;
}

const billingSchema = defineIntegrationSchema({
  models: {
    billingAccount: {
      name: "billing_account",
      fields: {
        id: {
          type: "id",
          name: "id",
          primaryKey: true,
        },
        ownerId: {
          type: "string",
          name: "owner_id",
          required: true,
        },
        status: {
          type: "enum",
          name: "status",
          required: true,
          values: ["free", "active"],
          default: "free",
        },
        seatQuantity: {
          type: "integer",
          name: "seat_quantity",
          nullable: true,
        },
        createdAt: {
          type: "datetime",
          name: "created_at",
          required: true,
          default: "now",
        },
      },
      constraints: [
        {
          type: "unique",
          fields: ["ownerId"],
          name: "billing_account_owner_unique",
        },
      ],
    },
  },
});

describe("integration ORM storage", () => {
  afterEach(async () => {
    await Promise.all(
      [...tempDirs].map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
        tempDirs.delete(dir);
      }),
    );
  });

  it("converts Farm integration schemas to Farming Labs ORM schemas", async () => {
    const schema = await farmIntegrationSchemaToOrmSchema(billingSchema);

    expect(schema._tag).toBe("schema");
    expect(schema.models.billingAccount.table).toBe("billing_account");
    expect(schema.models.billingAccount.fields.id.config).toMatchObject({
      kind: "id",
      idType: "string",
      generated: "id",
      unique: true,
      nullable: false,
    });
    expect(schema.models.billingAccount.fields.ownerId.config.mappedName).toBe("owner_id");
    expect(schema.models.billingAccount.constraints.unique).toEqual([["ownerId"]]);
  });

  it("rejects list fields instead of exposing a scalar runtime field", async () => {
    await expect(
      farmIntegrationSchemaToOrmSchema({
        models: {
          tasks: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              tags: { type: "string", list: true },
            },
          },
        },
      }),
    ).rejects.toThrow(
      'Schema field "tasks.tags" declares list: true, but the Farm integration runtime ORM does not support list fields. Use type: "json" for an array value or model the values in a related table.',
    );
  });

  it("only creates ORM references when database enforcement is selected", async () => {
    const schema = await farmIntegrationSchemaToOrmSchema(
      defineIntegrationSchema({
        models: {
          parents: {
            fields: { id: { type: "uuid", primaryKey: true } },
          },
          children: {
            fields: {
              defaultParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id" },
              },
              databaseParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id", enforced: "db" },
              },
              applicationParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id", enforced: "app" },
              },
              unenforcedParentId: {
                type: "uuid",
                reference: { model: "parents", field: "id", enforced: "none" },
              },
            },
          },
        },
      }),
    );

    const fields = schema.models.children.fields;
    expect(fields.defaultParentId.config.references).toBe("parents.id");
    expect(fields.databaseParentId.config.references).toBe("parents.id");
    expect(fields.applicationParentId.config.references).toBeUndefined();
    expect(fields.unenforcedParentId.config.references).toBeUndefined();
  });

  it("keeps runtime primary keys aligned with generated SQL", async () => {
    const customKeys = defineIntegrationSchema({
      models: {
        sessions: {
          fields: {
            legacyId: { type: "uuid" },
            token: { type: "string", primaryKey: true },
          },
        },
        counters: {
          fields: {
            sequence: { type: "integer", primaryKey: true },
          },
        },
      },
    });
    const runtimeSchema = await farmIntegrationSchemaToOrmSchema(customKeys);
    const { createManifest } = await import("@farming-labs/orm");
    const manifest = createManifest(runtimeSchema);
    const sql = generateSqlStatements(collectSchemaModels([["auth", customKeys]]), "sqlite")
      .map((statement) => statement.sql)
      .join("\n");

    expect(manifest.models.sessions.fields.legacyId).toMatchObject({
      kind: "string",
      unique: false,
      generated: undefined,
    });
    expect(manifest.models.sessions.fields.token).toMatchObject({
      kind: "id",
      idType: "string",
      unique: true,
      generated: undefined,
    });
    expect(manifest.models.counters.fields.sequence).toMatchObject({
      kind: "id",
      idType: "integer",
      unique: true,
      generated: undefined,
    });
    expect(sql).toContain('"legacyId" TEXT NOT NULL');
    expect(sql).toContain('"token" TEXT PRIMARY KEY');
    expect(sql).toContain('"sequence" INTEGER PRIMARY KEY');
  });

  it("rejects unsupported runtime primary-key field types", async () => {
    await expect(
      farmIntegrationSchemaToOrmSchema(
        defineIntegrationSchema({
          models: {
            flags: {
              fields: { enabled: { type: "boolean", primaryKey: true } },
            },
          },
        }),
      ),
    ).rejects.toThrow(
      'Schema primary-key field "integration.flags.enabled" uses unsupported type "boolean".',
    );
  });

  it.skipIf(!supportsNodeSqlite)(
    "uses extensions and overrides in generated tables and the runtime ORM",
    async () => {
      const customizedSchema = defineIntegrationSchema({
        models: {
          accounts: {
            name: "legacy_accounts",
            fields: {
              id: { type: "uuid", primaryKey: true },
              displayName: { type: "string", name: "legacy_display_name" },
            },
          },
        },
        extend: {
          accounts: {
            fields: {
              handle: { type: "string", required: true },
              createdAt: { type: "datetime", default: "now" },
            },
            constraints: [{ type: "unique", fields: ["handle"] }],
          },
          profiles: {
            name: "legacy_profiles",
            fields: {
              id: { type: "uuid", primaryKey: true },
              accountId: {
                type: "uuid",
                reference: { model: "accounts", field: "id" },
              },
              bio: { type: "text", nullable: true },
            },
          },
        },
        override: {
          accounts: {
            name: "accounts",
            fields: {
              displayName: { name: "display_name" },
              handle: { name: "user_handle" },
            },
          },
          profiles: {
            name: "user_profiles",
          },
        },
      });
      const dir = await createTempDir("farm-integration-orm-resolved-");
      const db = await createSqliteDatabase(path.join(dir, "integration.sqlite"));

      try {
        const statements = generateSqlStatements(
          collectSchemaModels([["custom", customizedSchema]]),
          "sqlite",
        );
        db.exec(statements.map((statement) => statement.sql).join("\n"));

        const runtimeSchema = await farmIntegrationSchemaToOrmSchema(customizedSchema);
        expect(Object.keys(runtimeSchema.models)).toEqual(["accounts", "profiles"]);
        expect(runtimeSchema.models.accounts.table).toBe("accounts");
        expect(runtimeSchema.models.accounts.fields.displayName.config.mappedName).toBe(
          "display_name",
        );
        expect(runtimeSchema.models.accounts.fields.handle.config.mappedName).toBe("user_handle");
        expect(runtimeSchema.models.accounts.constraints.unique).toEqual([["handle"]]);
        expect(runtimeSchema.models.profiles.table).toBe("user_profiles");

        const orm = await createIntegrationOrm({ schema: customizedSchema, client: db });
        await orm.accounts.create({
          data: {
            id: "account_1",
            displayName: "Ada",
            handle: "ada",
          },
        });
        await orm.profiles.create({
          data: {
            id: "profile_1",
            accountId: "account_1",
            bio: "First programmer",
          },
        });

        const account = await orm.accounts.findFirst({ where: { handle: "ada" } });
        const profile = await orm.profiles.findFirst({ where: { accountId: "account_1" } });

        expectTypeOf(account?.handle).toEqualTypeOf<string | undefined>();
        expectTypeOf(profile?.bio).toEqualTypeOf<string | null | undefined>();
        expect(account).toMatchObject({ displayName: "Ada", handle: "ada" });
        expect(account?.createdAt).toBeInstanceOf(Date);
        expect(profile).toMatchObject({ accountId: "account_1", bio: "First programmer" });
      } finally {
        db.close();
      }
    },
  );

  it.skipIf(!supportsNodeSqlite)(
    "uses storage.client as the unified ORM runtime client with real sqlite data",
    async () => {
      const dir = await createTempDir("farm-integration-orm-");
      const db = await createSqliteDatabase(path.join(dir, "integration.sqlite"));

      try {
        db.exec(`
        CREATE TABLE billing_account (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'free',
          seat_quantity INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(owner_id)
        );
      `);

        const orm = await createIntegrationOrm({
          schema: billingSchema,
          config: {
            storage: {
              client: db,
            },
          },
        });

        await orm.billingAccount.create({
          data: {
            id: "acct_1",
            ownerId: "user_1",
            status: "free",
            seatQuantity: 3,
          },
        });

        await orm.billingAccount.update({
          where: {
            ownerId: "user_1",
          },
          data: {
            status: "active",
            seatQuantity: 5,
          },
        });

        const account = await orm.billingAccount.findFirst({
          where: {
            ownerId: "user_1",
          },
        });

        expect(account).toMatchObject({
          id: "acct_1",
          ownerId: "user_1",
          status: "active",
          seatQuantity: 5,
        });
        expect(account?.createdAt).toBeInstanceOf(Date);
      } finally {
        db.close();
      }
    },
  );

  it.skipIf(!supportsNodeSqlite)("supports lazy storage.client factories", async () => {
    const dir = await createTempDir("farm-integration-orm-lazy-");
    const db = await createSqliteDatabase(path.join(dir, "integration.sqlite"));
    let calls = 0;

    try {
      db.exec(`
        CREATE TABLE billing_account (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'free',
          seat_quantity INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(owner_id)
        );
      `);

      const orm = await createIntegrationOrm({
        schema: billingSchema,
        config: {
          storage: {
            client: async () => {
              calls += 1;
              return db;
            },
          },
        },
      });

      await orm.billingAccount.create({
        data: {
          id: "acct_2",
          ownerId: "user_2",
          status: "active",
        },
      });

      const account = await orm.billingAccount.findUnique({
        where: {
          ownerId: "user_2",
        },
      });

      expect(calls).toBe(1);
      expect(account).toMatchObject({
        id: "acct_2",
        ownerId: "user_2",
        status: "active",
      });
    } finally {
      db.close();
    }
  });

  it.skipIf(!supportsNodeSqlite)("exposes schema-typed ORM on integration route args", async () => {
    const dir = await createTempDir("farm-integration-route-orm-");
    const db = await createSqliteDatabase(path.join(dir, "integration-route.sqlite"));

    try {
      db.exec(`
        CREATE TABLE billing_account (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'free',
          seat_quantity INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(owner_id)
        );

        INSERT INTO billing_account (
          id,
          owner_id,
          status,
          seat_quantity
        ) VALUES (
          'acct_route_1',
          'user_route_1',
          'active',
          7
        );
      `);

      const integration = defineIntegration({
        category: "custom",
        type: "typed-storage",
        instance: {},
        schema: billingSchema,
        routes: ({ route }) => [
          route.get("/api/typed-storage/account", {
            async handler(_request, context) {
              const account = await context.args.db.billingAccount.findFirst({
                where: {
                  ownerId: "user_route_1",
                },
                select: {
                  status: true,
                  seatQuantity: true,
                  createdAt: true,
                },
              });

              expectTypeOf(account?.status).toEqualTypeOf<"free" | "active" | undefined>();
              expectTypeOf(account?.seatQuantity).toEqualTypeOf<number | null | undefined>();
              expectTypeOf(account?.createdAt).toEqualTypeOf<Date | undefined>();

              return Response.json({
                status: account?.status,
                seatQuantity: account?.seatQuantity,
                createdAtIsDate: account?.createdAt instanceof Date,
              });
            },
          }),
        ],
      });

      const manager = new PluginManager({
        config: {
          storage: {
            client: db,
          },
          integrations: {
            typedStorage: integration,
          },
        } as any,
        isDev: true,
        isProd: false,
      });
      manager.addPlugins(
        resolveIntegrationPlugins({
          typedStorage: integration,
        }),
      );
      await manager.runHookParallel("init");

      const runtime = getRegisteredIntegrationRuntime("typedStorage");
      expect(runtime).toBeDefined();

      const response = await dispatchIntegrationRequest(
        runtime!,
        new Request("http://localhost/api/typed-storage/account"),
      );

      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({
        status: "active",
        seatQuantity: 7,
        createdAtIsDate: true,
      });
    } finally {
      db.close();
    }
  });

  it.skipIf(!supportsNodeSqlite)(
    "supports endpoint object definitions with schema-typed ORM route args",
    async () => {
      const dir = await createTempDir("farm-integration-endpoint-orm-");
      const db = await createSqliteDatabase(path.join(dir, "integration-endpoint.sqlite"));

      try {
        db.exec(`
        CREATE TABLE billing_account (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'free',
          seat_quantity INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(owner_id)
        );

        INSERT INTO billing_account (
          id,
          owner_id,
          status,
          seat_quantity
        ) VALUES (
          'acct_endpoint_1',
          'user_endpoint_1',
          'active',
          11
        );
      `);

        const integration = defineIntegration({
          category: "custom",
          type: "typed-storage-endpoints",
          instance: {},
          schema: billingSchema,
          endpoints: ({ endpoint }) => ({
            account: endpoint.get("/api/typed-storage/endpoint-account", {
              async handler(_request, context) {
                const account = await context.args.db.billingAccount.findFirst({
                  where: {
                    ownerId: "user_endpoint_1",
                  },
                  select: {
                    status: true,
                    seatQuantity: true,
                    createdAt: true,
                  },
                });

                expectTypeOf(account?.status).toEqualTypeOf<"free" | "active" | undefined>();
                expectTypeOf(account?.seatQuantity).toEqualTypeOf<number | null | undefined>();
                expectTypeOf(account?.createdAt).toEqualTypeOf<Date | undefined>();

                return Response.json({
                  status: account?.status,
                  seatQuantity: account?.seatQuantity,
                  createdAtIsDate: account?.createdAt instanceof Date,
                });
              },
            }),
          }),
        });

        const endpointOperation = integration.api.endpointAccount.get;
        expect(endpointOperation.path).toBe("/api/typed-storage/endpoint-account");
        expect(integration.routes).toHaveLength(1);

        const manager = new PluginManager({
          config: {
            storage: {
              client: db,
            },
            integrations: {
              typedStorageEndpoints: integration,
            },
          } as any,
          isDev: true,
          isProd: false,
        });
        manager.addPlugins(
          resolveIntegrationPlugins({
            typedStorageEndpoints: integration,
          }),
        );
        await manager.runHookParallel("init");

        const runtime = getRegisteredIntegrationRuntime("typedStorageEndpoints");
        expect(runtime).toBeDefined();

        const response = await dispatchIntegrationRequest(
          runtime!,
          new Request("http://localhost/api/typed-storage/endpoint-account"),
        );

        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual({
          status: "active",
          seatQuantity: 11,
          createdAtIsDate: true,
        });
      } finally {
        db.close();
      }
    },
  );
});
