// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIntegrationOrm, farmIntegrationSchemaToOrmSchema } from "../integration-orm";
import { defineIntegrationSchema } from "../integrations";

type SqliteDatabase = {
  exec(sql: string): unknown;
  close(): unknown;
};

const requireModule = createRequire(import.meta.url);
const tempDirs = new Set<string>();

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
    expect(schema.models.billingAccount.fields.ownerId.config.mappedName).toBe("owner_id");
    expect(schema.models.billingAccount.constraints.unique).toEqual([["ownerId"]]);
  });

  it("uses storage.client as the unified ORM runtime client with real sqlite data", async () => {
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
  });

  it("supports lazy storage.client factories", async () => {
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
});
