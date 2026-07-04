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
