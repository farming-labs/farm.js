---
title: "ORM Storage for Integrations"
description: "Pass one storage client through farm.config.ts and let integrations use ctx.args.db through the unified farming-labs/orm-style API."
section: "Integrations"
---

# ORM Storage for Integrations

Farm integrations can declare a schema and then use `ctx.args.db` inside route handlers, middleware, and lifecycle hooks. The app decides which storage client backs the data. The integration only depends on the ORM-shaped API.

This keeps integration code storage agnostic. A Stripe, auth, jobs, email, or custom integration can define models once and work across the supported runtime clients that `@farming-labs/orm` understands.

## Pass a client

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";
import { DatabaseSync } from "node:sqlite";
import { billing } from "./src/integrations/billing";

const sqlite = new DatabaseSync("farm.sqlite");

export default defineFarmConfig({
  storage: {
    client: sqlite,
  },
  integrations: {
    billing,
  },
});
```

`storage.client` can be a ready runtime client or a lazy factory. Farm storage clients still power Farm's key/value storage. Other objects or functions are treated as runtime clients for schema-backed integration persistence.

## Declare a schema

**src/integrations/billing.ts**

```ts
import { defineIntegrationSchema } from "@farmjs/core";

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
```

## Use db in integration hooks

**src/integrations/billing.ts**

```ts
import { defineIntegration, integrationRoute } from "@farmjs/core";
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

        return Response.json({
          account,
        });
      },
    }),
  ],
});
```

`ctx.args.db` is lazy, so you can access it like a property in handlers. `ctx.args.getDb()` is useful in setup code when you want to await the ORM client directly.

## SQLite shape

For SQLite, create the database client in app code and pass the instance through `storage.client`.

```ts
import { defineFarmConfig } from "@farmjs/core";
import { DatabaseSync } from "node:sqlite";

const sqlite = new DatabaseSync("farm.sqlite");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS billing_account (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'free',
    seat_quantity INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

export default defineFarmConfig({
  storage: {
    client: sqlite,
  },
});
```

Integration code stays the same if the app moves to a different supported client. The schema is the contract; the storage client is an app-level deployment choice.

## What gets typed

The schema controls the type of `ctx.args.db`:

- Model names become properties such as `ctx.args.db.billingAccount`.
- Field names become typed input and output fields.
- Enum values become string unions.
- Nullable fields include `null`.
- Datetime fields read as `Date`.
- Unique constraints can be used in `findUnique` and `where` shapes when the ORM supports them.

## Raw storage access

Use raw storage access when an integration needs the app's client directly:

```ts
async setup(ctx) {
  const client = await ctx.args.storage.getClient();

  if (!client) {
    ctx.log.warn("No runtime storage client configured.");
  }
}
```

Prefer `ctx.args.db` for schema-backed records. Use `ctx.args.storage.getClient()` for provider-specific operations that cannot be represented through the integration schema.

## Failure modes

- If an integration does not define `schema`, `ctx.args.db` throws with a clear error.
- If `storage.client` is missing, the ORM layer cannot create a runtime-backed integration DB.
- If the physical tables do not match the schema, the database client will fail at query time.
- If a model method does not exist on the underlying ORM client, Farm raises an integration ORM method error.
