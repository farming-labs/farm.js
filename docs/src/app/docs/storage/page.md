---
title: "Storage"
description: "Store key/value data with getStorage(), query SQL models with @farming-labs/orm on PostgreSQL, MySQL, or SQLite, and let Farm.js Infra host the database when you don't want to run one."
section: "Data and APIs"
---

# Storage

**Farm gives server code two kinds of storage: a key/value store through `getStorage()`, and SQL tables with typed models through the Farming Labs ORM.**

Every store is a named mount with its own driver. A driver can point at a service you run, such as PostgreSQL, Redis, or S3, or at a database that [Farm.js Infra](https://app.farmjs.dev) provisions for the project. Your server code calls the same functions either way.

## Choose the right storage

| What you need                                        | Use                                                            | Section                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cache entries, flags, settings, counters, or JSON    | `getStorage(name)` on a KV mount                               | [Key/value storage](#keyvalue-storage)                                                              |
| Files or values addressed by one key                 | `getStorage(name)` on `s3Storage(...)` or a blob driver        | [Supported KV drivers](#supported-kv-drivers)                                                       |
| Models, relations, joins, and filters in your own DB | `@farming-labs/orm` with a PostgreSQL, MySQL, or SQLite driver | [SQL databases and models](#sql-databases-and-models)                                               |
| The same models without running a database           | `farmStorage({ type: "sql", schema })` and `getDatabase(name)` | [Hosted by Farm.js Infra](#hosted-by-farmjs-infra)                                                  |
| Rate limiting shared across production instances     | An atomic adapter such as `redisRateLimitStorage(...)`         | [Atomic rate-limit storage](#atomic-rate-limit-storage)                                             |
| Models owned by a schema-backed Farm integration     | Farm's integration ORM through `ctx.args.db`                   | [Database and ORM Clients](/docs/integrations/orm-storage)                                          |
| Better Auth users, accounts, and sessions            | Better Auth's own database adapter                             | [Database and ORM Clients](/docs/integrations/orm-storage#better-auth-and-other-adapter-owned-data) |

A KV store does not become a relational database because its driver is PostgreSQL. `postgresStorage({ url })` keeps key/value records in one table. Use the ORM when you need columns, relations, or filters.

## At a glance

One config can mix the two kinds and both hosting models:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { farmStorage, redisStorage, sqliteStorage } from "@farm.js/core/storage";
import { schema } from "./src/lib/schema";

export default defineConfig({
  storage: {
    mounts: {
      settings: sqliteStorage({ path: "./.farm/storage/settings.sqlite" }),
      cache: redisStorage({ url: process.env.REDIS_URL! }),
      app: farmStorage({ type: "sql", schema }),
    },
  },
});
```

- `settings` is KV in a local SQLite file. Good for a single long-running server.
- `cache` is KV in a Redis you run.
- `app` is a SQL database hosted by Farm.js Infra, with typed models from `schema`.

Server code reads each mount by name:

```ts title="src/app/api/projects/route.ts"
import { createEndpoint } from "@farm.js/core/api";
import { getDatabase, getStorage } from "@farm.js/core/storage";

export const GET = createEndpoint("/api/projects", { method: "GET" }, async () => {
  const theme = await getStorage("settings").getItem<string>("theme");

  const db = await getDatabase("app");
  const projects = await db.project.findMany({
    select: { id: true, name: true },
  });

  return { theme, projects };
});
```

## Key/value storage

Farm's `getStorage()` is a **key/value API**. It stores each value under a string key and exposes operations such as `getItem`, `setItem`, `getKeys`, and `removeItem`.

Use it for caches, feature flags, application settings, idempotency records, checkpoints, and object-backed values. Do not use it for users, accounts, products, or other records that need model fields, relations, joins, or typed filters; use [SQL](#sql-databases-and-models) for those. Request-rate enforcement uses a separate [atomic counter contract](#atomic-rate-limit-storage).

### Create a KV client

```ts title="src/lib/storage.ts"
import { sqliteStorage } from "@farm.js/core/storage";

export const appStorage = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});
```

Local SQLite and the other self-configured KV helpers return ready-to-use clients, so application code can import and call them directly. Mounting the clients is useful when you want one central configuration and a stable name that any server-side module can retrieve later.

### Register named mounts

```ts title="farm.config.ts"
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

A name made only of separators or spaces, such as `" "`, `"/"`, or `"::"`, names no namespace, so `getStorage()` throws for it instead of returning the root store. Call `getStorage()` without an argument for the root store.

The development server and a built app both apply `storage` from `farm.config` before they serve the first request. A production build bundles the drivers the config names (such as `local` or `sqlite`), and the server disposes the configured drivers when it shuts down.

### Use a mounted store

Call `getStorage("app")` from server-side code to retrieve the client registered under the `app` mount.

It is not limited to API routes. You can call it from any module that executes on the server after Farm initializes storage. Prefer resolving the store inside the request handler, action, job, or lifecycle function that uses it so the configured storage is ready before lookup.

```ts title="src/app/api/settings/route.ts"
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

### KV operations

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

### Choosing mounts and drivers

Mount names describe the responsibility; drivers decide where the values live:

| Use case                                    | Suggested mount              | Typical driver                                                    |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| Application settings and durable JSON state | `app` or `settings`          | SQLite, Postgres, MySQL, libSQL, or `farmStorage({ type: "kv" })` |
| Shared cache entries                        | `cache`                      | Redis, Upstash Redis, or memory for local development             |
| Rate-limit counters                         | Dedicated rate-limit adapter | `redisRateLimitStorage(...)` or another atomic store              |
| Idempotency and webhook deduplication       | `webhooks` or `idempotency`  | Redis or a durable SQL store                                      |
| Bucket-backed objects or metadata           | `uploads`                    | S3 or Vercel Blob                                                 |
| Tests and disposable local state            | Any descriptive name         | Memory or local filesystem                                        |

The mount names are conventions chosen by the application. Two mounts may use the same driver type while remaining isolated, or use different drivers based on durability and latency requirements. A mount named `ratelimit` is still generic KV storage and is not accepted as proof of atomic increment support.

The full list of KV drivers is in [Supported KV drivers](#supported-kv-drivers).

## SQL databases and models

Use SQL when records have named fields, relations, unique constraints, or filters. Farm uses [`@farming-labs/orm`](https://github.com/farming-labs/orm) for this: you write one schema, and the same typed query API runs on PostgreSQL, MySQL, SQLite, or a database hosted by Farm.js Infra. Only the driver line changes.

```bash
pnpm add @farming-labs/orm
```

### Define a schema

A schema is plain TypeScript: models, fields, and relations.

```ts title="src/lib/schema.ts"
import { belongsTo, datetime, defineSchema, hasMany, id, model, string } from "@farming-labs/orm";

export const schema = defineSchema({
  user: model({
    table: "users",
    fields: {
      id: id(),
      email: string().unique(),
      name: string(),
    },
    relations: {
      projects: hasMany("project", { foreignKey: "ownerId" }),
    },
  }),
  project: model({
    table: "projects",
    fields: {
      id: id(),
      name: string(),
      ownerId: string().map("owner_id").references("user.id"),
      createdAt: datetime().map("created_at").defaultNow(),
    },
    relations: {
      owner: belongsTo("user", { foreignKey: "ownerId" }),
    },
  }),
});
```

- Each key under `defineSchema` becomes a model on the client: `db.user`, `db.project`.
- `table` and `.map()` set the physical table and column names. Field keys stay camelCase in your code.
- Other field types include `integer()`, `boolean()`, `json()`, `decimal()`, `bigint()`, and `enumeration([...])`. Chain `.nullable()`, `.default(value)`, or `.unique()` on any of them.

### Pick a driver

| Database                                         | Install                                    | Driver                     |
| ------------------------------------------------ | ------------------------------------------ | -------------------------- |
| PostgreSQL through a `pg` pool                   | `@farming-labs/orm-sql pg`                 | `createPgPoolDriver(pool)` |
| SQLite through `node:sqlite` or `better-sqlite3` | `@farming-labs/orm-sql`                    | `createSqliteDriver(db)`   |
| MySQL through a `mysql2` pool                    | `@farming-labs/orm-runtime mysql2`         | `createOrmFromRuntime`     |
| Prisma, Drizzle, Kysely, D1, MongoDB, Redis      | `@farming-labs/orm-runtime`                | `createOrmFromRuntime`     |
| Hosted by Farm.js Infra                          | Nothing extra; `@farm.js/core` includes it | `getDatabase(name)`        |

Pass the first two to `createOrm({ schema, driver })`. `createOrmFromRuntime` and `getDatabase` return the client directly; await both.

`createOrmFromRuntime` inspects the client you pass and picks the matching driver, so you can keep the client your app already has.

### Connect your own PostgreSQL

```bash
pnpm add @farming-labs/orm @farming-labs/orm-sql pg
```

```ts title="src/lib/db.ts"
import { createOrm } from "@farming-labs/orm";
import { createPgPoolDriver } from "@farming-labs/orm-sql";
import { Pool } from "pg";
import { schema } from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = createOrm({ schema, driver: createPgPoolDriver(pool) });
```

The module creates one pool per server process. Import `db` only from server code so the connection string stays off the client.

Switching databases changes only the driver:

```ts title="src/lib/db.ts (SQLite)"
import { createOrm } from "@farming-labs/orm";
import { createSqliteDriver } from "@farming-labs/orm-sql";
import { DatabaseSync } from "node:sqlite";
import { schema } from "./schema";

export const db = createOrm({
  schema,
  driver: createSqliteDriver(new DatabaseSync("./.farm/app.sqlite")),
});
```

```ts title="src/lib/db.ts (MySQL)"
import { createOrmFromRuntime } from "@farming-labs/orm-runtime";
import { createPool } from "mysql2/promise";
import { schema } from "./schema";

export const db = await createOrmFromRuntime({
  schema,
  client: createPool(process.env.DATABASE_URL!),
});
```

### Query models

The query API is the same on every driver, including the hosted one:

```ts title="src/app/api/signup/route.ts"
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { db } from "../../../lib/db";

const signup = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export const POST = createEndpoint("/api/signup", { method: "POST", body: signup }, async (ctx) => {
  const user = await db.transaction(async (tx) => {
    const user = await tx.user.create({ data: ctx.body });
    await tx.project.create({
      data: { name: "My first project", ownerId: user.id },
    });
    return user;
  });

  const projects = await db.project.findMany({
    where: { ownerId: user.id },
    select: { id: true, name: true, owner: { select: { email: true } } },
  });

  return { user, projects };
});
```

- `findMany`, `findFirst`, `findUnique`, and `count` read. `findUnique` takes a unique field such as `email`.
- `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, and `deleteMany` write.
- `select` picks columns and follows relations, as `owner` does above. The result type follows the `select`.
- `transaction` commits every write inside it together, or none of them. A second signup with the same email fails on the unique `email` column and creates no project.

### Create the tables

Defining a schema does not create tables. `renderSafeSql` turns the schema into `create table if not exists` statements for a dialect:

```ts
import { renderSafeSql } from "@farming-labs/orm";
import { schema } from "./src/lib/schema";

const sql = renderSafeSql(schema, { dialect: "postgres" });
```

Use `"postgres"`, `"mysql"`, or `"sqlite"`. Run the output with your migration tool, or wire that tool into `farm migrate` as shown in [Schema generation and migrations](/docs/integrations/orm-storage#schema-generation-and-migrations). The ORM can also generate Prisma and Drizzle schemas from the same declaration. For a hosted mount, see [Migrate a hosted database](#migrate-a-hosted-database).

## Hosted by Farm.js Infra

Don't want to run a database? [Farm.js Infra](https://app.farmjs.dev) provisions one for each mount you declare, per project and environment. You get:

- **One database per mount, holding one kind of data.** A key-value mount serves `getStorage(name)`; a SQL mount serves `getDatabase(name)`.
- **Typed models.** Pass your Farming Labs ORM schema to the mount and `getDatabase(name)` returns `db.<model>` with the same API as above.
- **No credentials in your app config.** Infra issues short-lived database credentials and Farm refreshes them.
- **A Storage view in the dashboard.** Browse keys, tables, rows, and foreign keys.

Hosted databases run on libSQL and speak SQLite. Setting `managed: true` on `postgresStorage` or `redisStorage` provisions a hosted SQLite database; it does not start a PostgreSQL server or Redis. Use your own connection when you need PostgreSQL-specific SQL, Redis commands, or provider options such as Redis TTL.

### Declare hosted mounts

Declare a mount in `farm.config.ts`. `@farm.js/core` includes the client it uses, so there is nothing else to install. Each named resource belongs to one project and environment.

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { farmStorage, postgresStorage, redisStorage, sqliteStorage } from "@farm.js/core/storage";

export default defineConfig({
  storage: {
    mounts: {
      drafts: farmStorage({ type: "sql" }),
      settings: farmStorage({ type: "kv" }),
      orders: postgresStorage({ managed: true }),
      cache: redisStorage({ managed: true }),
      scratch: sqliteStorage({ path: "./.farm/scratch.sqlite" }),
    },
  },
});
```

Every hosted mount holds one kind of data:

| Mount                                                                                                                                                                    | Kind      | Read it with        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------- |
| `farmStorage({ type: "kv" })`                                                                                                                                            | Key-value | `getStorage(name)`  |
| `farmStorage({ type: "sql" })`, optionally with `schema`                                                                                                                 | SQL       | `getDatabase(name)` |
| A database driver with `managed: true`: `sqliteStorage`, `postgresStorage`, `mysqlStorage`, `libsqlStorage`, `pgliteStorage`, `planetscaleStorage`                       | SQL       | `getDatabase(name)` |
| Any other driver with `managed: true`: `redisStorage`, `upstashStorage`, `vercelKVStorage`, `s3Storage`, `{ driver: "cloudflare-kv-binding", managed: true }`, and so on | Key-value | `getStorage(name)`  |

A driver helper takes its kind from the driver, so `orders` above is SQL and `cache` is key-value.
Calling the other API throws and names the right one: `getDatabase("cache")` says to use
`getStorage("cache")`. A schema needs a SQL mount, so `redisStorage({ managed: true, schema })`
throws. In this example `scratch` has no `managed` flag, so it stays a local SQLite file.

`farmStorage()` without `type` is deprecated. It still works and accepts both APIs, and
`farm storage plan` warns about it. Pick the kind by how you read the mount:

| Before                                                                 | After                                  |
| ---------------------------------------------------------------------- | -------------------------------------- |
| `farmStorage()` read with `getStorage()`                               | `farmStorage({ type: "kv" })`          |
| `farmStorage()` or `farmStorage({ schema })` read with `getDatabase()` | `farmStorage({ type: "sql", schema })` |

A mount that used both APIs needs two mounts: give the key-value one its own `namespace` and copy
its existing keys into it.

The mount name is the default resource name. Set `namespace` to reuse a resource,
for example `redisStorage({ managed: true, namespace: "sessions" })`. Mounts that share a
resource must hold the same kind: `farm storage plan` refuses a key-value mount and a SQL
mount on one database.
Omit `managed` or set it to `false` on a provider helper to keep using its own driver.
When switching an existing external store to Farm hosting, migrate its data separately.
Pass native connection options only when using the native driver.
For a custom driver instance or an existing database client, keep using
`driverStorage(driver)` or `databaseStorage(db)`.

### Provision and connect

1. List the resources your config declares. This runs locally:

   ```bash
   pnpm exec farm storage plan
   ```

2. In [app.farmjs.dev](https://app.farmjs.dev), create a Farm API key scoped to the project and environment, with the `databases:provision` permission. Set it as `FARMJS_API_KEY` in your shell or the app's `.env.local`.

3. Create the databases:

   ```bash
   pnpm exec farm storage apply
   ```

   Reapplying reuses each database and records the mount names and drivers for each namespace.

4. Give the deployed server a separate key with the `databases:connect` permission.

The deployed server reads these variables:

| Variable             | When to set it                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `FARMJS_API_KEY`     | Always. A `databases:connect` key on the server, a `databases:provision` key for `farm storage apply`. |
| `FARMJS_PROJECT_ID`  | When the key covers several projects.                                                                  |
| `FARMJS_ENVIRONMENT` | When the key covers several environments: `development`, `staging`, or `production`.                   |
| `FARMJS_API_URL`     | When you run your own Infra instance. Defaults to `https://app.farmjs.dev`.                            |

Infra returns the database's HTTPS address and a short-lived credential. The application sends SQL directly to that address.

### Query a hosted database

Use `getDatabase` from server-side code after Farm initializes storage.
The mount owns its optional Farming Labs ORM schema. With a schema on the
mount, `getDatabase(name)` returns its typed models. Without a schema it returns
the raw SQL client. Use `getDatabase(name, { raw: true })` for migrations on
either mount.

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { farmStorage } from "@farm.js/core/storage";
import { defineSchema, id, model, string } from "@farming-labs/orm";

const schema = defineSchema({
  draft: model({ table: "drafts", fields: { id: id(), title: string() } }),
});

export default defineConfig({
  storage: { mounts: { drafts: farmStorage({ type: "sql", schema }) } },
});
```

```ts
// In a server handler, after migrating the drafts table.
import { getDatabase } from "@farm.js/core/storage";

export async function listDrafts() {
  const db = await getDatabase("drafts");
  return db.draft.findMany({ select: { id: true, title: true } });
}
```

Install `@farming-labs/orm` in the app for the schema helpers. Dev, build, and
`pnpm exec farm generate` infer model types from the config into `src/farm.d.ts`.
Managed driver helpers also accept the schema, e.g. `postgresStorage({ managed: true, schema })`.
Each mount owns its model view, even when two mounts share a hosted namespace.
Existing calls to `getDatabase(name, { schema })` can still select a schema for one call.

Farm opens the connection on first use and refreshes credentials. Farm owns
the returned client's lifetime and closes it at shutdown. Use `db.transaction(async (tx) => …)`
for ORM writes that must commit together. Nested ORM transactions are unsupported. A key-value mount keeps
its keys in the reserved table `_farm_kv`. `getDatabase(name)` throws for a misspelled name, a key-value mount, and a mount that Farm.js Infra does not host; for your own database, use the ORM client from [Connect your own PostgreSQL](#connect-your-own-postgresql).

### Migrate a hosted database

Provisioning creates an empty database, and `farm schema migrate` covers plugin-owned tables, not storage mounts. Create your tables with the mount's raw SQL client, from server code that runs after Farm initializes storage, such as an admin-only API route:

```ts title="src/lib/migrate.ts"
import { renderSafeSql } from "@farming-labs/orm";
import { getDatabase } from "@farm.js/core/storage";
import { schema } from "./schema";

export async function migrateApp() {
  const sql = await getDatabase("app", { raw: true });
  await sql.executeMultiple(renderSafeSql(schema, { dialect: "sqlite" }));
}
```

`renderSafeSql` emits `create table if not exists`, so running it again is harmless. It does not alter existing tables. The raw client is a libSQL client, so `execute`, `batch`, and `executeMultiple` are available.

### Rename or remove a hosted mount

To rename the mount and keep its data, declare
`editor: farmStorage({ type: "sql", namespace: "drafts" })` and call
`getDatabase("editor")`. A resource name accepts 1–63 lowercase letters,
digits, and hyphens, starting with a letter. Removing a mount from config
keeps the database. Disconnecting its Farm project schedules deletion.

### Browse storage in Farm.js Infra

Open **Storage** in the Farm.js Infra sidebar. On a phone, open the navigation menu first.
Choose a project and environment. If you open Storage from a project, the dashboard carries
that project and environment into the list. You can bookmark your selection.

If the environment is empty, choose **Set up a database**. Once it has a database, choose
**Set up another database** below the list. Both show a mount declaration, provisioning key
instructions, and the CLI commands to apply it.

Members can inspect mount details. Organization owners and admins can open a **Ready**
resource to browse its data.

- **KV** shows keys and values. Filter by key prefix and open a key to inspect its value.
- **Tables** shows rows, column definitions, and foreign keys. Select a related table to inspect its rows.
- **Details** lists the mount names and configured drivers and shows how to connect from your app.

A key-value mount shows **KV**. A SQL mount, from `farmStorage({ type: "sql" })` or a
database driver, shows **Tables**. Only a mount from a deprecated untyped `farmStorage()`
shows both.
**Back to storage** returns to the selected project and environment.

### Existing SQLite mounts

Existing `sqliteStorage({ managed: true })` mounts use the same hosted resources.
Switch to `farmStorage({ type: "sql" })` with the same mount name to keep the data. For a
mount with `managed: { name: "drafts" }`, use `farmStorage({ type: "sql", namespace: "drafts" })`.

## Atomic rate-limit storage

The built-in rate limiter uses an atomic `increment(key, windowMs)` contract. Its default adapter is atomic inside one process, which is useful for local development and a single long-running server. Production deployments with multiple processes or regions should pass a shared atomic adapter explicitly:

```bash
pnpm add @farm.js/cache-redis ioredis
```

```ts title="src/app/api/middleware.ts"
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
});
```

The default bucket is the limit's policy (`requests` and `window`), the caller's address, and the
route the router serves: the path decoded once, without the base path, locale prefix, or a trailing
slash, so `/api/login/` and `/api/%6Cogin` count against the same bucket as `/api/login`. Two limits
on one path keep their own counts and windows; two with the same policy count a request once. A built app
takes that address from the server's own connection, as the development server
does. Behind a reverse proxy or a platform load balancer that connection belongs
to the proxy, so set `server.trustProxy` to key on the last `x-forwarded-for` hop, the
address the proxy appended, instead. When the runtime reports no address at all, the limiter refuses rather
than putting every caller in one bucket, so set `trustProxy` or supply a
`keyGenerator` that uses an identity you do have. Do not fall back to a constant
such as `"unknown"`: that is the shared bucket the limiter refuses, and one
caller then exhausts the window for everyone.

The Redis adapter uses one Lua operation to increment the counter and establish its expiry. A generic `get()` followed by `set()` adapter is rejected because concurrent requests can read the same count and overwrite each other. Limited responses include `Retry-After`; all responses include the [`RateLimit` and `RateLimit-Policy` fields from the current IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/).

Choose a trusted rate-limit identity when possible. An authenticated user or tenant ID is usually more useful than an IP address for application-level limits:

```ts
export default middleware().rateLimit({
  requests: 20,
  window: "1m",
  keyGenerator: (ctx) => {
    const userId = ctx.data.get("userId") as string | undefined;
    if (userId) return `user:${userId}`;
    const address = ctx.request.socket?.remoteAddress;
    // No identity and no address means this request cannot be bucketed on its
    // own, so reject it rather than sharing a bucket with every other caller.
    if (!address) throw new Error("Rate limit identity is unavailable for this request.");
    return `ip:${address}`;
  },
});
```

Adapters may implement `get(key)` so `getRateLimitStatus()` can inspect a counter. Enforcement itself only depends on atomic `increment()`.

`memoryRateLimitStorage({ maxEntries })` caps active keys (100,000 by default) and rejects a new key when that capacity is full; it never evicts an active counter to admit another key. Expired windows are reclaimed when needed, and repeated capacity rejections skip cleanup scans until a window could expire. Its `increment()` and `get()` results are snapshots: editing a returned counter does not change the stored count or expiry. Use a shared adapter for enforcement across processes or regions.

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
| `farmStorage({ type })`                       | Hosted by Farm.js Infra  | A key-value (`"kv"`) or SQL (`"sql"`) mount, with no database to run.             |
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

Passing `managed: true` to a provider helper switches it to the hosted database described in [Hosted by Farm.js Infra](#hosted-by-farmjs-infra). Database drivers become SQL mounts; every other driver becomes a key-value mount.

### Configure drivers directly

Helpers and direct configuration produce the same Farm storage client behavior. Driver options can be written inline or inside `options`. If both are present, values inside `options` take precedence.

```ts title="farm.config.ts"
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

These drivers create or use a key/value table for Farm KV storage. They do not expose tables, models, joins, or arbitrary SQL through `getStorage()`. For models on the same database, connect the ORM as shown in [SQL databases and models](#sql-databases-and-models).

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

## Integration database clients

The current beta config groups two different inputs under the `storage` key:

- `storage.driver`, `storage.mounts`, and a Farm storage client configure the KV system used by `getStorage()`.
- A raw database or ORM object passed to `storage.client` is the runtime client for schema-backed integrations. That object is not returned by `getStorage(name)` or `getDatabase(name)`.

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("farm.sqlite");

export default defineConfig({
  storage: {
    client: db,
  },
});
```

In this example, the raw SQLite database is available only to integrations. Because no KV driver or Farm storage client is configured, `getStorage()` continues to use the default in-memory KV store. A raw PostgreSQL pool passed the same way does not make the KV store durable either.

When an integration also defines a schema, Farm exposes a typed ORM layer at `ctx.args.db`. The integration does not need to know whether the app passed SQLite, PostgreSQL, or another supported runtime client.

| Config                                      | Use it for                                              |
| ------------------------------------------- | ------------------------------------------------------- |
| `sqliteStorage(...)`, `redisStorage(...)`   | Farm KV storage read with `getStorage(name)`.           |
| `farmStorage({ schema })`                   | Hosted KV and SQL models read with `getDatabase(name)`. |
| `storage.mounts`                            | Multiple named stores.                                  |
| `storage.client` with a Farm storage client | Reuse a created Farm storage client as the root store.  |
| `storage.client` with a DB/runtime object   | Give integrations a runtime database client.            |

Inside an integration, use `ctx.args.db` for ORM-style queries on the integration's own models, and `ctx.args.storage.getClient()` only when provider-specific operations need the raw configured client. See [Database and ORM Clients](/docs/integrations/orm-storage) for integration schemas, PostgreSQL pools, Better Auth ownership, and migrations.

## Production notes

- Use a shared durable KV driver for production state that must survive restarts or be visible across instances. A local SQLite file or the filesystem is durable only on a single long-running server.
- Keep memory KV storage for tests and explicitly disposable local state.
- Create one ORM client per process and reuse it. Do not open a new pool per request.
- Create tables before code that queries them. Provisioning a hosted database does not run migrations.
- Keep `DATABASE_URL`, provider tokens, and `FARMJS_API_KEY` in server-only environment variables.
- Do not assume that a PostgreSQL-backed KV helper provides relational database access.
- Configure KV mounts, ORM clients, and integration database clients independently when an application needs more than one.
