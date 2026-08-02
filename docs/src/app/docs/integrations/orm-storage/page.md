---
title: "Database and ORM Clients"
description: "Use relational models through @farming-labs/orm, schema-backed Farm integrations, or an integration's own database adapter."
section: "Integrations"
---

# Database and ORM Clients

Use a database or ORM when data has named fields, relationships, unique constraints, joins, transactions, or queryable filters. This is separate from Farm's [`getStorage()` key/value API](/docs/storage).

Farm supports three database ownership patterns. Choose the owner before choosing the client:

| Data owner                                       | Recommended path                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Your application                                 | Create an app-owned ORM client and query it through `db.model`                 |
| A Farm integration that declares `schema`        | Pass a client through Farm config and query it through `ctx.args.db.model`     |
| Better Auth, Prisma, Drizzle, or another library | Configure that library's native database adapter and use the library's own API |

KV storage and database clients may use the same infrastructure, but they do not expose the same interface. `postgresStorage(...)` stores key/value records in a PostgreSQL-backed KV table. A raw `pg.Pool` or PostgreSQL ORM client provides relational access.

## Application-owned ORM

Use `@farming-labs/orm` directly when models belong to your application rather than to a Farm integration. Install the packages you import directly instead of relying on Farm's transitive dependencies:

```bash
pnpm add @farming-labs/orm @farming-labs/orm-sql pg
```

**src/lib/database.ts**

```ts
import { Pool } from "pg";

export const database = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

**src/lib/db.ts**

```ts
import { createOrm, defineSchema, id, model, string } from "@farming-labs/orm";
import { createPgPoolDriver } from "@farming-labs/orm-sql";
import { database } from "./database";

export const appSchema = defineSchema({
  project: model({
    table: "project",
    fields: {
      id: id(),
      name: string(),
      ownerId: string().map("owner_id"),
    },
  }),
});

export const db = createOrm({
  schema: appSchema,
  driver: createPgPoolDriver(database),
});
```

Application server code can now import `db` and query its own tables. Farm config is not required for this direct pattern.

## Schema-backed Farm integrations

Use Farm's integration ORM when a reusable integration owns models and should work across supported database clients. The integration declares the schema; the application supplies the runtime client.

### Pass a PostgreSQL client

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { billing } from "./src/integrations/billing";
import { database } from "./src/lib/database";

export default defineConfig({
  storage: {
    client: database,
    mounts: {
      cache: {
        driver: "redis",
        url: process.env.REDIS_URL!,
      },
    },
  },
  integrations: {
    billing,
  },
});
```

`storage.client` is the current beta config name for the integration runtime client. When its value is a raw `pg.Pool`, Farm detects PostgreSQL and builds the integration ORM from it. The `cache` mount remains a separate KV store and is read with `getStorage("cache")`.

The client can be a ready object or a lazy factory:

```ts
storage: {
  client: () => database,
}
```

### Declare an integration schema

**src/integrations/billing-schema.ts**

```ts
import { defineIntegrationSchema } from "@farm.js/core";

export const billingSchema = defineIntegrationSchema({
  models: {
    billingAccount: {
      name: "billing_account",
      fields: {
        id: {
          type: "id",
          primaryKey: true,
        },
        ownerId: {
          type: "string",
          name: "owner_id",
          required: true,
          index: true,
        },
        status: {
          type: "enum",
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
```

### Query through `ctx.args.db`

**src/integrations/billing.ts**

```ts
import { defineIntegration, integrationRoute } from "@farm.js/core";
import { billingSchema } from "./billing-schema";

export const billing = defineIntegration({
  category: "payment",
  type: "custom-billing",
  instance: {},
  schema: billingSchema,
  async setup(ctx) {
    const db = await ctx.args.getDb();
    await db.billingAccount.findMany();
  },
  routes: [
    integrationRoute.get("/api/billing/account", {
      async handler(_request, ctx) {
        const account = await ctx.args.db.billingAccount.findFirst({
          where: {
            ownerId: String(ctx.data.ownerId),
          },
          select: {
            status: true,
            seatQuantity: true,
            createdAt: true,
          },
        });

        return Response.json({ account });
      },
    }),
  ],
});
```

`ctx.args.db` is lazy in request handlers. Use `await ctx.args.getDb()` when setup or lifecycle code should resolve the client explicitly.

The integration schema controls the type of `ctx.args.db`:

- Model names become properties such as `ctx.args.db.billingAccount`.
- Field names become typed input and output fields.
- Enum values become string unions.
- Nullable fields include `null`.
- Datetime fields read as `Date`.
- Unique constraints can be used in unique lookups when the detected driver supports them.

## SQLite runtime client

The same integration can use a raw SQLite database instead of PostgreSQL:

```ts
import { defineConfig } from "@farm.js/core";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("farm.sqlite");

export default defineConfig({
  storage: {
    client: database,
  },
});
```

Create physical tables that match the integration schema before querying them. Switching clients does not migrate or reshape existing data automatically.

## Better Auth and other adapter-owned data

Some integrations own their database configuration. Better Auth is one example:

```ts
import { betterAuth } from "better-auth";
import { database } from "./database";

export const auth = betterAuth({
  database,
});
```

Here, Better Auth uses the PostgreSQL pool through its own database adapter and owns the `user`, `session`, `account`, and `verification` tables. Farm's Better Auth integration mounts the HTTP handler; it does not automatically route Better Auth queries through `ctx.args.db`.

The application may reuse the same pool for its own Farming Labs ORM models. Prefer Better Auth's APIs and database hooks for auth-owned writes. Making Better Auth itself query through `@farming-labs/orm` requires a dedicated Better Auth database adapter.

The same ownership rule applies to Prisma, Drizzle, and provider SDKs: configure their native client or adapter directly unless a Farm integration declares a schema for the records.

## Raw runtime client

Use the raw client only for operations that the integration ORM does not represent:

```ts
async setup(ctx) {
  const client = await ctx.args.storage.getClient();

  if (!client) {
    ctx.log.warn("No integration database client configured.");
    return;
  }

  // Use a provider-specific operation here.
}
```

`ctx.args.storage.getClient()` keeps its current name for compatibility. It returns the raw object from `storage.client`; it does not return a KV mount.

## Schema generation and migrations

Farm can generate artifacts for integration schemas, then run the application's migration command:

```bash
farm generate
farm migrate
```

```ts
export default defineConfig({
  storage: {
    client: database,
  },
  migrations: {
    commands: [
      {
        name: "apply database schema",
        command: "pnpm drizzle-kit migrate",
      },
    ],
  },
});
```

`farm migrate` orchestrates the configured command; it does not replace Prisma, Drizzle, SQL, Better Auth, or provider-specific migration tools. Run the migration process owned by each schema owner.

## Failure modes

- If an integration does not define `schema`, `ctx.args.db` throws. Use the integration's native API or raw runtime client instead.
- If `storage.client` is missing, Farm cannot construct a runtime-backed integration ORM.
- If the physical tables do not match the declared schema, the database fails at query time.
- Passing a raw database client does not configure the KV store used by `getStorage()`.
- A database-backed KV helper such as `postgresStorage(...)` is not a relational ORM client.

## Production checklist

- Share connection pools instead of creating one pool per request.
- Keep database credentials in server-only environment variables.
- Use provider-recommended connection and TLS settings.
- Run migrations before code that depends on the new schema.
- Keep each table's ownership clear and avoid bypassing auth or billing invariants with direct writes.
- Close clients during shutdown when the underlying driver requires it.
