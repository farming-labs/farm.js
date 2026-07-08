---
title: "Storage"
description: "Use Farm storage clients for key-value data and pass storage clients to framework features and integrations."
section: "Data and APIs"
---

# Storage

Use Farm storage clients for key-value data and pass storage clients to framework features and integrations.

## Create a storage client

**src/lib/storage.ts**

```ts
import { sqliteStorage } from "@farmjs/core/storage";

export const appStorage = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});

await appStorage.setItem("settings", { theme: "light" });
```

## Mount stores

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";
import { redisStorage, sqliteStorage } from "@farmjs/core/storage";

export default defineFarmConfig({
  storage: {
    mounts: {
      app: sqliteStorage({ path: "./.farm/storage/app.sqlite" }),
      ratelimit: redisStorage({ url: process.env.REDIS_URL! }),
    },
  },
});
```

## Supported drivers

- memory, local filesystem, SQLite, libSQL, PGlite, Postgres, MySQL, Redis, Upstash Redis, MongoDB, S3, and Vercel KV.

## Runtime clients for integrations

`storage.client` can also carry an app-owned database client for schema-backed integrations.

```ts
import { defineFarmConfig } from "@farmjs/core";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("farm.sqlite");

export default defineFarmConfig({
  storage: {
    client: db,
  },
});
```

When an integration defines a schema, Farm exposes a typed ORM layer at `ctx.args.db`. The integration does not need to know whether the app passed SQLite, Postgres, or another supported runtime client.

## Schema migrations

Farm can generate integration schema artifacts with `farm generate`, then run your app-owned migration command with `farm migrate`.

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  storage: {
    client: db,
  },
  migrations: {
    commands: [
      {
        name: "apply schema",
        command: "pnpm drizzle-kit migrate",
      },
    ],
  },
});
```

`farm migrate` does not hide the database tool. It gives the project one consistent place to run Prisma, Drizzle, SQL files, Better Auth setup, or provider-specific schema commands before `farm build`.

## Storage client or runtime client

| Config | Use it for |
| --- | --- |
| `sqliteStorage(...)` | Farm key/value storage with a Farm storage client. |
| `redisStorage(...)` | Cache, rate-limit, or queue-like key/value data. |
| `storage.mounts` | Multiple named key/value stores. |
| `storage.client` with a Farm storage client | Reuse a created Farm storage client as the root store. |
| `storage.client` with a DB/runtime object | Give integrations a runtime database client. |

## Production notes

- Use durable storage for production state.
- Keep local/memory storage for development and tests.
- Pass one runtime client through config so integrations do not each invent storage options.
- Create physical tables/migrations that match integration schemas, then run them with `farm migrate`.
- Close database clients during app shutdown when the underlying driver requires it.
