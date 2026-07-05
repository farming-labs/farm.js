---
title: "ORM Storage for Integrations"
description: "Pass one storage client through farm.config.ts and let integrations use ctx.args.db through the unified farming-labs/orm-style API."
section: "Integrations"
---

# ORM Storage for Integrations

Pass one storage client through farm.config.ts and let integrations use ctx.args.db through the unified farming-labs/orm-style API.

## Pass a client

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";
import { client } from "./src/lib/db";

export default defineFarmConfig({
  storage: {
    client,
  },
});
```

## Use db in integration hooks

**custom integration**

```ts
export const billing = defineIntegration({
  category: "payment",
  type: "custom-billing",
  schema: billingSchema,
  async setup(ctx) {
    const db = await ctx.args.getDb();
    await db.billingAccount.findMany();
  },
});
```

## SQLite shape

For SQLite, the app owns the SQLite-compatible client instance and Farm passes it through storage.client. Integrations only depend on ctx.args.db, so the provider can change without rewriting integration code.
