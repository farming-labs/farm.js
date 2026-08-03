---
title: "KV Storage"
description: "Use Farm's key/value API for caches, settings, counters, idempotency records, and object-backed values."
section: "Data and APIs"
---

# KV Storage

Farm's `@farm.js/core/storage` module is a **key/value API**. Every value is stored under a string key and read with operations such as `getItem`, `setItem`, `getKeys`, and `removeItem`.

Use it for caches, feature flags, application settings, idempotency records, checkpoints, and object-backed values. Do not use it as a relational ORM for users, accounts, products, or other records that need model fields, relations, joins, or typed filters. Request-rate enforcement uses a separate atomic counter contract described below.

## Choose the right data API

| What you need                                     | Use                                                         |
| ------------------------------------------------- | ----------------------------------------------------------- |
| Cache entries, flags, settings, counters, or JSON | Farm KV storage through `getStorage(name)`                  |
| Rate limiting shared across production instances  | An atomic adapter such as `redisRateLimitStorage(...)`      |
| Files or values addressed by one key              | An object-backed KV helper such as `s3Storage(...)`         |
| Application models, relations, joins, and filters | An application-owned `@farming-labs/orm` or another ORM     |
| Models owned by a schema-backed Farm integration  | Farm's integration ORM through `ctx.args.db`                |
| Better Auth users, accounts, and sessions         | Better Auth's configured database adapter and instance APIs |
| Provider-specific SQL or database operations      | The raw integration runtime client through `getClient()`    |

The current beta config groups two different inputs under the `storage` key:

- `storage.driver`, `storage.mounts`, and a Farm storage client configure the KV system used by `getStorage()`.
- A raw database or ORM object passed to `storage.client` is reserved for schema-backed integrations and is documented under [Database and ORM Clients](/docs/integrations/orm-storage).

These paths do not convert into each other. In particular, a raw PostgreSQL pool supplied as `storage.client` does not become the value returned by `getStorage()`, and it does not make the default in-memory KV store durable.

## Create a KV client

**src/lib/storage.ts**

```ts
import { sqliteStorage } from "@farm.js/core/storage";

export const appStorage = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});
```

KV helpers return ready-to-use clients, so application code can import and call them directly. Mounting the clients is useful when you want one central configuration and a stable name that any server-side module can retrieve later.

## Register named mounts

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { appStorage } from "./src/lib/storage";

export default defineConfig({
  storage: {
    mounts: {
      app: appStorage,
    },
  },
});
```

Each property under `mounts` is a KV namespace:

- `app` is an application-defined name. Farm does not attach special behavior to it.
- You can add names such as `cache`, `sessions`, `uploads`, or `webhooks` when the application needs more stores.

A mount name is not a URL, route, database table, or filesystem directory. It is the lookup name that connects configuration to later server-side calls.

`getStorage(name)` always returns a namespaced key/value view. When the name matches a configured mount, operations use that mount's driver. When no matching mount exists, Farm uses the same namespace on the root store instead. The default root store is in memory, so a missing or misspelled production mount does not throw but may store data only for the lifetime of one process. Rate-limit middleware is an exception: enforcement requires its dedicated atomic storage contract and never treats a generic KV mount as atomic.

## Use a mounted store

Call `getStorage("app")` from server-side code to retrieve the client registered under the `app` mount.

It is not limited to API routes. You can call it from any module that executes on the server after Farm initializes storage. Prefer resolving the store inside the request handler, action, job, or lifecycle function that uses it so the configured storage is ready before lookup.

**src/app/api/settings/route.ts**

```ts
import { createEndpoint } from "@farm.js/core/api";
import { getStorage } from "@farm.js/core/storage";
import { z } from "zod";

type AppSettings = {
  theme: "light" | "dark";
  productName: string;
};

const settingsSchema = z.object({
  theme: z.enum(["light", "dark"]),
  productName: z.string().min(1),
});

const defaultSettings: AppSettings = {
  theme: "dark",
  productName: "Farm.js App",
};

export const GET = createEndpoint("/api/settings", { method: "GET" }, async () => {
  const appStore = getStorage("app");
  const settings = await appStore.getItem<AppSettings>("settings");

  return {
    settings: settings ?? defaultSettings,
  };
});

export const POST = createEndpoint(
  "/api/settings",
  {
    method: "POST",
    body: settingsSchema,
  },
  async (ctx) => {
    const appStore = getStorage("app");
    await appStore.setItem("settings", ctx.body);

    return {
      saved: true,
      settings: ctx.body,
    };
  },
);
```

The same mount can be used from other server-only application surfaces:

| Surface                             | Example use                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| API routes                          | Persist settings, idempotency keys, webhook state, or cached provider responses. |
| Middleware                          | Read feature flags, request policy, tenant configuration, or custom counters.    |
| Server components and pages         | Load data needed during server rendering.                                        |
| Server actions and server functions | Save form state or invalidate application-owned cached values.                   |
| Integration server handlers         | Read application key/value data that is separate from an integration schema.     |
| Jobs and workflows                  | Store checkpoints, deduplication markers, or lightweight progress state.         |

Do not call `getStorage()` from a client component or browser bundle. Expose the required operation through an API route, server action, or server function instead.

## KV operations

Mounted stores expose the standard Farm KV API:

```ts
const appStore = getStorage("app");

await appStore.setItem("feature:checkout", { enabled: true });

const feature = await appStore.getItem<{ enabled: boolean }>("feature:checkout");
const exists = await appStore.hasItem("feature:checkout");
const keys = await appStore.getKeys("feature:");

await appStore.removeItem("feature:checkout");
await appStore.clear();
```

`clear()` only clears the selected namespace. Calling `getStorage("app").clear()` does not clear `ratelimit`, `cache`, or another mounted store.

Use descriptive keys such as `settings:global`, `tenant:acme:flags`, or `webhook:event_123`. Namespaced keys make inspection and targeted cleanup easier.

## Atomic rate-limit storage

The built-in rate limiter uses an atomic `increment(key, windowMs)` contract. Its default adapter is atomic inside one process, which is useful for local development and a single long-running server. Production deployments with multiple processes or regions should pass a shared atomic adapter explicitly:

```bash
pnpm add @farm.js/cache-redis ioredis
```

**src/app/api/middleware.ts**

```ts
import { redisRateLimitStorage } from "@farm.js/cache-redis";
import { middleware } from "@farm.js/core/middleware";
import Redis from "ioredis";

const rateLimits = redisRateLimitStorage({
  client: () => new Redis(process.env.REDIS_URL!),
  prefix: "storefront-ratelimit",
});

export default middleware().rateLimit({
  requests: 100,
  window: "1m",
  storage: rateLimits,
  keyGenerator: (ctx) => {
    return ctx.request.socket.remoteAddress ?? "unknown";
  },
});
```

The Redis adapter uses one Lua operation to increment the counter and establish its expiry. A generic `get()` followed by `set()` adapter is rejected because concurrent requests can read the same count and overwrite each other. Limited responses include `Retry-After`; all responses include the [`RateLimit` and `RateLimit-Policy` fields from the current IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/).

Choose a trusted rate-limit identity when possible. An authenticated user or tenant ID is usually more useful than an IP address for application-level limits:

```ts
export default middleware().rateLimit({
  requests: 20,
  window: "1m",
  keyGenerator: (ctx) => {
    const userId = ctx.data.get("userId") as string | undefined;
    return userId ? `user:${userId}` : `ip:${ctx.request.socket.remoteAddress ?? "unknown"}`;
  },
});
```

Adapters may implement `get(key)` so `getRateLimitStatus()` can inspect a counter. Enforcement itself only depends on atomic `increment()`.

## Choosing mounts and drivers

Mount names describe the responsibility; drivers decide where the values live:

| Use case                                    | Suggested mount              | Typical driver                                        |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| Application settings and durable JSON state | `app` or `settings`          | SQLite, Postgres, MySQL, or libSQL                    |
| Shared cache entries                        | `cache`                      | Redis, Upstash Redis, or memory for local development |
| Rate-limit counters                         | Dedicated rate-limit adapter | `redisRateLimitStorage(...)` or another atomic store  |
| Idempotency and webhook deduplication       | `webhooks` or `idempotency`  | Redis or a durable SQL store                          |
| Bucket-backed objects or metadata           | `uploads`                    | S3 or Vercel Blob                                     |
| Tests and disposable local state            | Any descriptive name         | Memory or local filesystem                            |

The mount names are conventions chosen by the application. Two mounts may use the same driver type while remaining isolated, or use different drivers based on durability and latency requirements. A mount named `ratelimit` is still generic KV storage and is not accepted as proof of atomic increment support.

## Supported KV drivers

Farm supports KV storage at three levels:

1. Farm convenience helpers for common databases, caches, and object stores.
2. Direct driver configuration through `driver: "name"`.
3. Existing or custom `unstorage` driver instances through `databaseStorage()`, `driverStorage()`, or `defineStorageClient()`.

The root store and every mount can use a different supported driver.

### Farm KV helpers

Import these helpers from `@farm.js/core/storage`:

| Helper                                        | Driver                   | Common use                                                                        |
| --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `memoryStorage()`                             | `memory`                 | Tests, local development, and disposable process-local state.                     |
| `localStorage({ base })`                      | Farm alias for `fs-lite` | Local persistent files, development caches, and self-hosted single-instance apps. |
| `sqliteStorage({ path, tableName })`          | `sqlite` / `node-sqlite` | Durable local application state with no external service.                         |
| `postgresStorage(...)` / `pgStorage(...)`     | `postgres`               | Shared durable key/value state backed by Postgres.                                |
| `mysqlStorage(...)` / `mysql2Storage(...)`    | `mysql`                  | Shared durable key/value state backed by MySQL.                                   |
| `pgliteStorage(...)`                          | `pglite`                 | Embedded Postgres-compatible storage.                                             |
| `planetscaleStorage(...)`                     | `planetscale`            | PlanetScale-backed durable storage.                                               |
| `libsqlStorage(...)`                          | `libsql`                 | Local or remote libSQL/Turso-compatible storage.                                  |
| `redisStorage(...)`                           | `redis`                  | Shared caches, sessions, counters, and short-lived state.                         |
| `upstashStorage(...)`                         | `upstash`                | HTTP-based Redis storage for serverless and edge-style deployments.               |
| `mongodbStorage(...)`                         | `mongodb`                | Durable document-backed key/value storage.                                        |
| `s3Storage(...)`                              | `s3`                     | S3-compatible object-backed values.                                               |
| `netlifyBlobsStorage(...)`                    | `netlify-blobs`          | Named or deploy-scoped Netlify Blob stores.                                       |
| `vercelKVStorage(...)`                        | `vercel-kv`              | Vercel KV/Redis-backed shared state.                                              |
| `vercelBlobStorage(...)`                      | `vercel-blob`            | Public Vercel Blob-backed values.                                                 |
| `createStorageClient({ driver, ...options })` | Any supported name       | Create a reusable client from direct driver configuration.                        |
| `databaseStorage(database, { tableName })`    | `db0`                    | Reuse an existing `db0` database instance.                                        |
| `driverStorage(driver)`                       | Custom                   | Wrap an existing `unstorage` driver or driver factory.                            |
| `defineStorageClient(factory)`                | Custom                   | Lazily create a custom synchronous or asynchronous driver.                        |

### Configure drivers directly

Helpers and direct configuration produce the same Farm storage client behavior. Driver options can be written inline or inside `options`. If both are present, values inside `options` take precedence.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  storage: {
    driver: "sqlite",
    path: "./.farm/storage/root.sqlite",
    tableName: "farm_root",
    mounts: {
      cache: {
        driver: "redis",
        url: process.env.REDIS_URL!,
        ttl: 300,
      },
      uploads: {
        driver: "s3",
        endpoint: "https://s3.us-east-1.amazonaws.com",
        region: "us-east-1",
        bucket: process.env.S3_BUCKET!,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    },
  },
});
```

In this example, `getStorage()` uses SQLite, `getStorage("cache")` uses Redis, and `getStorage("uploads")` uses S3.

### Database-backed KV drivers

Farm resolves these names through `db0` and exposes the result as key/value storage:

| Accepted driver names          | Database connector      | Important configuration                                           |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------- |
| `sqlite`, `node-sqlite`        | Node SQLite             | `path` or `name`, plus optional `tableName`.                      |
| `sqlite3`                      | `sqlite3`               | `path` or `name`, plus optional `tableName`.                      |
| `better-sqlite3`               | `better-sqlite3`        | `path` or `name`, plus optional `tableName`.                      |
| `postgres`, `postgresql`, `pg` | PostgreSQL              | `url` or standard `pg` client options, plus optional `tableName`. |
| `mysql`, `mysql2`              | MySQL                   | Standard `mysql2` connection options, plus optional `tableName`.  |
| `pglite`                       | PGlite                  | PGlite connector options, plus optional `tableName`.              |
| `planetscale`                  | PlanetScale             | PlanetScale client options, plus optional `tableName`.            |
| `libsql`, `libsql-node`        | libSQL Node client      | `url`, optional `authToken`, and optional `tableName`.            |
| `libsql-http`                  | libSQL HTTP client      | `url`, optional `authToken`, and optional `tableName`.            |
| `db0`                          | Existing `db0` database | Pass `{ database, tableName? }` inside `options`.                 |

These drivers create or use a key/value table for Farm KV storage. They do not expose tables, models, joins, or arbitrary SQL through `getStorage()`. Passing a raw database or ORM object through `storage.client` is a separate integration database path.

### Complete built-in driver set

Farm also accepts the built-in driver names exported by its installed `unstorage` version. Kebab-case and camel-case names shown on the same row are aliases.

| Category                | Accepted driver names                               | Intended use                                                                            |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Process memory          | `memory`                                            | Fast, process-local, non-durable state.                                                 |
| Disabled storage        | `null`                                              | Discard writes and always read empty state. Useful for explicitly disabling a store.    |
| Layered storage         | `overlay`                                           | Combine multiple driver layers. Requires configured driver instances in `layers`.       |
| Bounded memory          | `lru-cache`, `lruCache`                             | Process-local cache with size and TTL controls.                                         |
| Filesystem              | `local`, `fs-lite`, `fsLite`, `fs`                  | Persistent files. `local` is Farm's shorthand for `fs-lite`; `fs` adds watcher support. |
| Remote HTTP             | `http`                                              | Read and write through an HTTP storage endpoint.                                        |
| GitHub content          | `github`                                            | Read-only, cached repository content access.                                            |
| Redis                   | `redis`                                             | Shared cache, counters, sessions, and short-lived state.                                |
| Upstash Redis           | `upstash`                                           | REST-based Redis for serverless runtimes.                                               |
| MongoDB                 | `mongodb`                                           | MongoDB collection-backed values.                                                       |
| S3-compatible objects   | `s3`                                                | AWS S3, Cloudflare R2's S3 API, and compatible providers.                               |
| UploadThing             | `uploadthing`                                       | UploadThing-backed object values.                                                       |
| Netlify                 | `netlify-blobs`, `netlifyBlobs`                     | Named or deploy-scoped Netlify Blob storage.                                            |
| Vercel KV               | `vercel-kv`, `vercelKV`                             | Vercel-managed Redis-compatible key/value storage.                                      |
| Vercel Blob             | `vercel-blob`, `vercelBlob`                         | Vercel Blob object storage.                                                             |
| Vercel Runtime Cache    | `vercel-runtime-cache`, `vercelRuntimeCache`        | Ephemeral regional runtime cache with TTL and tags.                                     |
| Cloudflare KV binding   | `cloudflare-kv-binding`, `cloudflareKVBinding`      | A KV namespace bound to a Cloudflare runtime.                                           |
| Cloudflare KV HTTP      | `cloudflare-kv-http`, `cloudflareKVHttp`            | Cloudflare KV through the REST API.                                                     |
| Cloudflare R2 binding   | `cloudflare-r2-binding`, `cloudflareR2Binding`      | An R2 bucket bound to a Cloudflare runtime.                                             |
| Azure App Configuration | `azure-app-configuration`, `azureAppConfiguration`  | Azure App Configuration key/value data.                                                 |
| Azure Cosmos DB         | `azure-cosmos`, `azureCosmos`                       | Cosmos DB container-backed values.                                                      |
| Azure Key Vault         | `azure-key-vault`, `azureKeyVault`                  | Secret-backed values in Azure Key Vault.                                                |
| Azure Blob Storage      | `azure-storage-blob`, `azureStorageBlob`            | Azure container-backed object values.                                                   |
| Azure Table Storage     | `azure-storage-table`, `azureStorageTable`          | Azure table-backed key/value state.                                                     |
| Deno KV                 | `deno-kv`, `denoKV`                                 | Deno runtime KV storage.                                                                |
| Deno KV from Node       | `deno-kv-node`, `denoKVNode`                        | Deno KV through the Node-compatible client.                                             |
| IndexedDB               | `indexedb`                                          | IndexedDB-backed values in a compatible browser runtime.                                |
| Web Storage             | `localstorage`, `session-storage`, `sessionStorage` | Browser local or session storage.                                                       |
| Capacitor               | `capacitor-preferences`, `capacitorPreferences`     | Capacitor Preferences-backed mobile storage.                                            |

Farm KV storage normally initializes on the server. Browser-only drivers require a compatible custom runtime and should not be used as a reason to call `getStorage()` from client components.

Most remote and platform drivers load an optional provider SDK. Install the package required by the selected driver, such as `ioredis`, `mongodb`, `@upstash/redis`, `@vercel/kv`, `@vercel/blob`, `@netlify/blobs`, `aws4fetch`, `uploadthing`, the relevant Azure SDK, `@deno/kv`, `idb-keyval`, or `lru-cache`. Database aliases may likewise require `sqlite3`, `better-sqlite3`, `mysql2`, `@electric-sql/pglite`, `@planetscale/database`, or `@libsql/client`; the `sqlite` alias uses Node's built-in `node:sqlite`. Cloudflare binding drivers instead require the corresponding runtime binding.

### Custom drivers

Use `driverStorage()` when a compatible driver already exists:

```ts
import { driverStorage } from "@farm.js/core/storage";
import createCustomDriver from "my-unstorage-driver";

export const customStorage = driverStorage(() =>
  createCustomDriver({
    endpoint: process.env.CUSTOM_STORAGE_URL!,
  }),
);
```

The wrapped driver can be mounted or used as the root Farm storage client just like a built-in helper.

## Database and ORM clients are separate

The current beta API uses `storage.client` for two distinguishable object shapes:

- A Farm storage client, such as `sqliteStorage(...)`, becomes the root key/value store used by `getStorage()`.
- A raw database, ORM, or provider object becomes the runtime client for schema-backed integrations. That object is not returned by `getStorage(name)`.

```ts
import { defineConfig } from "@farm.js/core";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("farm.sqlite");

export default defineConfig({
  storage: {
    client: db,
  },
});
```

In this example, the raw SQLite database is available only to integrations. Because no KV driver or Farm storage client is configured, `getStorage()` continues to use the default in-memory KV store.

When an integration also defines a schema, Farm exposes a typed ORM layer at `ctx.args.db`. The integration does not need to know whether the app passed SQLite, PostgreSQL, or another supported runtime client.

Use this rule of thumb:

- Use `getStorage("name")` for key/value operations against a named namespace or mount.
- Use `ctx.args.db` inside an integration that declares models and needs ORM-style queries.
- Use `ctx.args.storage.getClient()` inside integration server code only when provider-specific operations require the raw configured runtime client.

See [Database and ORM Clients](/docs/integrations/orm-storage) for application-owned ORM usage, integration schemas, PostgreSQL pools, Better Auth ownership, and migrations.

## KV client or database client

| Config                                      | Use it for                                             |
| ------------------------------------------- | ------------------------------------------------------ |
| `sqliteStorage(...)`                        | Farm KV storage with a Farm storage client.            |
| `redisStorage(...)`                         | Cache or queue-like key/value data.                    |
| `storage.mounts`                            | Multiple named key/value stores.                       |
| `storage.client` with a Farm storage client | Reuse a created Farm storage client as the root store. |
| `storage.client` with a DB/runtime object   | Give integrations a runtime database client.           |

## Production notes

- Use a shared durable KV driver for production state that must survive restarts or be visible across instances.
- Keep memory KV storage for tests and explicitly disposable local state.
- Do not assume that a PostgreSQL-backed KV helper provides relational database access.
- Configure KV mounts and database clients independently when an application needs both.
