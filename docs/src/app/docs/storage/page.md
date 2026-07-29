---
title: "Storage"
description: "Use Farm storage clients for key-value data and pass storage clients to framework features and integrations."
section: "Data and APIs"
---

# Storage

Use Farm storage clients for key-value data and pass storage clients to framework features and integrations.

Farm storage has two related configuration paths:

- `storage.mounts` registers named key/value stores that server code reads with `getStorage(name)`.
- `storage.client` configures the root key/value store when it receives a Farm storage client, or supplies an application-owned database or ORM client to schema-backed integrations when it receives another runtime object.

Use mounts for values such as settings, feature flags, cache entries, rate-limit counters, idempotency keys, and small JSON records. Use a database or ORM object as `storage.client` when integrations need model-based access through `ctx.args.db`.

## Create a storage client

**src/lib/storage.ts**

```ts
import { redisStorage, sqliteStorage } from "@farm.js/core/storage";

export const appStorage = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});

export const rateLimitStorage = redisStorage({
  url: process.env.REDIS_URL!,
});
```

Storage helpers return ready-to-use clients, so application code can import and call them directly. Mounting the clients is useful when you want one central configuration and a stable name that any server-side module can retrieve later.

## Register named mounts

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { appStorage, rateLimitStorage } from "./src/lib/storage";

export default defineConfig({
  storage: {
    mounts: {
      app: appStorage,
      ratelimit: rateLimitStorage,
    },
  },
});
```

Each property under `mounts` is a storage namespace:

- `app` is an application-defined name. Farm does not attach special behavior to it.
- `ratelimit` is a Farm convention. The built-in `.rateLimit()` middleware uses this namespace automatically.
- You can add names such as `cache`, `sessions`, `uploads`, or `webhooks` when the application needs more stores.

A mount name is not a URL, route, database table, or filesystem directory. It is the lookup name that connects configuration to later server-side calls.

`getStorage(name)` always returns a namespaced key/value view. When the name matches a configured mount, operations use that mount's driver. When no matching mount exists, Farm uses the same namespace on the root store instead. The default root store is in memory, so a missing or misspelled production mount does not throw but may store data only for the lifetime of one process.

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

## Storage operations

Mounted stores expose the standard Farm storage API:

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

## How the rate-limit mount is used

The `ratelimit` name is recognized by Farm's built-in rate-limit middleware. Once that mount is configured, middleware can use it without calling `getStorage("ratelimit")` directly:

**src/app/api/middleware.ts**

```ts
import { middleware } from "@farm.js/core/middleware";

export default middleware().rateLimit({
  requests: 100,
  window: "1m",
  keyGenerator: (ctx) => {
    return ctx.request.socket.remoteAddress ?? "unknown";
  },
});
```

For each key, Farm stores a request count and reset time in the `ratelimit` namespace, increments the count, applies the configured TTL, and returns `429` when the limit is reached.

If no `ratelimit` mount is configured, the middleware still uses a `ratelimit` namespace on the root storage. The default root storage is in memory, which is useful for local development but is not shared between production instances and is cleared on restart. Use Redis, Upstash Redis, or another shared store for production rate limits.

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

You can inspect the namespace manually with `getStorage("ratelimit")`, but normal middleware usage does not require it.

## Choosing mounts and drivers

Mount names describe the responsibility; drivers decide where the values live:

| Use case                                    | Suggested mount             | Typical driver                                        |
| ------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| Application settings and durable JSON state | `app` or `settings`         | SQLite, Postgres, MySQL, or libSQL                    |
| Shared cache entries                        | `cache`                     | Redis, Upstash Redis, or memory for local development |
| Rate-limit counters                         | `ratelimit`                 | Redis or Upstash Redis                                |
| Idempotency and webhook deduplication       | `webhooks` or `idempotency` | Redis or a durable SQL store                          |
| Bucket-backed objects or metadata           | `uploads`                   | S3 or Vercel Blob                                     |
| Tests and disposable local state            | Any descriptive name        | Memory or local filesystem                            |

The names are conventions chosen by the application, except for framework-owned names such as `ratelimit`. Two mounts may use the same driver type while remaining isolated, or use different drivers based on durability and latency requirements.

## Supported drivers

Farm supports storage at three levels:

1. Farm convenience helpers for common databases, caches, and object stores.
2. Direct driver configuration through `driver: "name"`.
3. Existing or custom `unstorage` driver instances through `databaseStorage()`, `driverStorage()`, or `defineStorageClient()`.

The root store and every mount can use a different supported driver.

### Farm storage helpers

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
| `redisStorage(...)`                           | `redis`                  | Shared caches, rate limits, sessions, counters, and short-lived state.            |
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

### Database driver names

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

These drivers create or use a key/value table for Farm storage. They are separate from passing a raw database or ORM object through `storage.client` for integration models.

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
| Redis                   | `redis`                                             | Shared cache, counters, sessions, and rate limits.                                      |
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

Farm application storage normally initializes on the server. Browser-only drivers require a compatible custom runtime and should not be used as a reason to call `getStorage()` from client components.

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

## Runtime clients for integrations

`storage.client` has two behaviors based on the configured value:

- A Farm storage client, such as `sqliteStorage(...)`, becomes the root key/value store used by `getStorage()`.
- Another database, ORM, or provider object becomes the runtime client for schema-backed integrations. That object is not returned by `getStorage(name)`.

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

When an integration defines a schema, Farm exposes a typed ORM layer at `ctx.args.db`. The integration does not need to know whether the app passed SQLite, Postgres, or another supported runtime client.

Use this rule of thumb:

- Use `getStorage("name")` for key/value operations against a named namespace or mount.
- Use `ctx.args.db` inside an integration that declares models and needs ORM-style queries.
- Use `ctx.args.storage.getClient()` inside integration server code only when provider-specific operations require the raw configured runtime client.

## Schema migrations

Farm can generate integration schema artifacts with `farm generate`, then run your app-owned migration command with `farm migrate`.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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

| Config                                      | Use it for                                             |
| ------------------------------------------- | ------------------------------------------------------ |
| `sqliteStorage(...)`                        | Farm key/value storage with a Farm storage client.     |
| `redisStorage(...)`                         | Cache, rate-limit, or queue-like key/value data.       |
| `storage.mounts`                            | Multiple named key/value stores.                       |
| `storage.client` with a Farm storage client | Reuse a created Farm storage client as the root store. |
| `storage.client` with a DB/runtime object   | Give integrations a runtime database client.           |

## Production notes

- Use durable storage for production state.
- Keep local/memory storage for development and tests.
- Pass one runtime client through config so integrations do not each invent storage options.
- Create physical tables/migrations that match integration schemas, then run them with `farm migrate`.
- Close database clients during app shutdown when the underlying driver requires it.
