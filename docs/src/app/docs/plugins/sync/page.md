---
title: "Sync Plugin"
description: "Turn a schema into browser-side collections with optimistic writes, offline queueing, and warm starts, backed by your own database."
section: "Plugin Ecosystem"
---

# Sync Plugin

`@farm.js/sync` gives a model rows that live in the browser. Reads render from a
local store, writes apply before the server answers, edits made offline queue
until the connection returns, and a revisit paints from disk.

It is a layer over your existing data, not a replacement for it: every read and
write goes through your database, filtered by a rule you control on the server.

> **Choosing between this and the patterns guide**
>
> [Local-first patterns](/docs/local-first) covers what Farm's cache, mutations,
> and persistence already do for ordinary queries and server functions — no new
> package. Reach for this plugin when you want the unit of data to be a **row**
> rather than a cached response: one row shown in several views, updated once.

## Install

```bash
pnpm add @farm.js/sync
```

## Declare the data once

```ts title="src/schema.ts"
import { defineSchema } from "@farm.js/core";

export const schema = defineSchema({
  models: {
    tasks: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        title: { type: "string", required: true },
        status: { type: "enum", values: ["open", "done"], default: "open" },
        orgId: { type: "uuid", required: true, index: true },
        updatedAt: { type: "datetime" },
      },
    },
  },
});
```

Field metadata does real work, so configuration does not repeat it:

| Declaration                  | What it decides                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| `primaryKey: true`           | the row key                                                        |
| `type: "enum"` + `values`    | the column's type, and validation before the optimistic write      |
| `reference`                  | relationships between models                                       |
| `datetime` named `updatedAt` | incremental sync — after the first load only changed rows are sent |
| `name` on a model or field   | the real table or column name in an existing database              |

## Configure the plugin

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { sync } from "@farm.js/sync";
import { schema } from "./src/schema";

export default defineConfig({
  plugins: [
    sync({
      schema,
      storage: "app",
      models: { tasks: "write", projects: "read" },
      middleware: [withOrg],
      where: ({ context }) => ({ orgId: context.org.id }),
    }),
  ],
});
```

### Options

| Option       | Purpose                                                             |
| ------------ | ------------------------------------------------------------------- |
| `schema`     | the declarative schema above                                        |
| `storage`    | a mount name from `storage.mounts`                                  |
| `client`     | your database instead of a mount; see below                         |
| `models`     | which models the browser may touch: `"write"`, `"read"`, or `false` |
| `where`      | the row filter applied to every read and write, server side         |
| `middleware` | request middleware producing the context `where` reads              |
| `persist`    | keep rows on the device for warm starts. Default `true`             |
| `path`       | the endpoint the browser calls. Default `/_farm/sync`               |

## Point it at your database

`storage` names a Farm mount and needs no other setup, which makes it the
quickest way to run the plugin. A mount is key-value, so it stores rows as
serialized values rather than in tables you can query with SQL.

For a real database, pass the connection:

```ts
import { Pool } from "pg";

sync({
  schema,
  client: () => new Pool({ connectionString: process.env.DATABASE_URL }),
  models: { tasks: "write" },
  where: ({ context }) => ({ orgId: context.org.id }),
});
```

`@farming-labs/orm` detects which driver the connection needs and builds the
data layer from your schema, so the same configuration works for a `pg` pool, a
Drizzle or Prisma client, a D1 binding, or a Mongo client. Sync never generates
SQL and has no per-database code path.

### Where the tables come from

Sync reads and writes rows. It never creates or alters tables, so what you need
before the first query depends on where the data lives.

| Setup                                       | What you do first                                                 |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `storage: "app"`                            | nothing. A mount is key-value, so there is no table to create     |
| A database you already use                  | nothing. Describe the existing tables with `name` mappings, below |
| A raw `pg`, `sqlite`, or `mysql` connection | `farm sync migrate`                                               |
| A database behind Prisma or Drizzle         | their own migration, as usual                                     |

If a query fails with _relation "tasks" does not exist_, the table has not been
created yet — sync will not create one mid-request.

### farm sync migrate

When sync talks to a database connection directly, it can emit the tables your
schema describes. The command prints SQL and stops:

```bash
pnpm farm sync migrate
```

```sql
-- Generated by `farm sync migrate` from the sync schema.
-- Dialect: postgres
-- Review before applying. Sync never alters existing tables.

create table if not exists "tasks" (
  "id" uuid primary key,
  "title" text not null,
  "status" text default 'open',
  "orgId" uuid not null,
  "updatedAt" timestamptz
);

create index if not exists "tasks_orgId_idx" on "tasks" ("orgId");
```

Read it, then run it:

| Flag             | What it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| _(none)_         | print the statements                                          |
| `--write <file>` | save them to a file to commit alongside your other migrations |
| `--apply`        | execute them                                                  |

The command only ever creates. A table that exists but no longer matches the
schema is reported, not altered:

```
These tables exist but no longer match the schema. Sync will not change them:
  tasks
    missing in the database: priority
    not in the schema: legacy_note
```

A rename and a drop-plus-add are indistinguishable from the schema alone, and
one of them loses data, so that call stays yours. Take the column change to your
own migration tooling.

Storage mounts have no tables, so the command says so and exits cleanly.

### Keeping an ORM's migrations in charge

If the project already uses Prisma or Drizzle, keep them. Sync reads through
their client, and their migrations stay the source of truth — don't run
`farm sync migrate` against a schema they own. Wire them into Farm so the
migration runs with everything else:

```ts title="farm.config.ts"
export default defineConfig({
  migrations: {
    commands: ["pnpm prisma migrate deploy"],
  },
});
```

### Syncing tables you already have

Describe the existing tables instead of creating new ones. `name` maps a model
to its table and a field to its column:

```ts
tasks: {
  name: "todo_items",
  fields: {
    id: { type: "uuid", primaryKey: true },
    title: { type: "string", name: "item_title" },
    orgId: { type: "uuid", name: "organization_id", index: true },
    updatedAt: { type: "datetime", name: "updated_at" },
  },
},
```

No migration runs. Models you do not describe stay invisible to the browser.

## Read

```tsx title="src/app/tasks/page.tsx"
"use client";

import { db } from "@farm.js/sync/client";
import { useLiveQuery } from "@farm.js/sync/react";

export default function TasksPage() {
  const open = useLiveQuery(db.tasks, (task) => task.status === "open", {
    orderBy: (task) => task.updatedAt,
    direction: "desc",
  });

  if (open.status === "loading") return <Skeleton />;

  return (
    <ul>
      {open.rows.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  );
}
```

The predicate runs in the browser over rows already on the device, so any
expression is fine. Which rows reach the device is decided separately, by the
server's row filter.

| Field     | Meaning                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| `rows`    | matching rows                                                                        |
| `status`  | `"loading"` only on a genuine cold start; a revisit with persistence on is `"ready"` |
| `error`   | a failed read. Previously loaded rows stay visible                                   |
| `pending` | writes in flight against this model                                                  |
| `paused`  | writes waiting for the connection to return                                          |
| `isEmpty` | no rows matched                                                                      |

`useRow(db.tasks, id)` subscribes to a single row.

## Write

```ts
db.tasks.insert({ title: "Write the RFC" });
db.tasks.update({ id, status: "done" });
db.tasks.delete({ id });
```

Each call applies to the local store immediately, so every view showing that row
re-renders in the same frame, then persists in the background. Fields the schema
fills in — the key, defaults, the cursor, and the columns owned by `where` — can
be omitted.

Every write returns a handle, usable whichever way suits the call site:

```ts
tasks.insert({ title }); // fire and forget
await tasks.insert({ title }); // wait for the server
await tasks.insert({ title }).persisted; // the same, named explicitly
tasks.insert({ title }).catch(showError); // handle the failure inline

const handle = tasks.insert({ title });
handle.key; // the row key, available before any network call
handle.state; // "pending" | "paused" | "completed" | "failed"
```

Ignoring the handle is safe: a write the interface already rolled back does not
surface as an unhandled rejection.

### What happens when a write fails

| Situation            | Behavior                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| Server rejects it    | the row reverts to its previous values, and the handle rejects          |
| Network error or 5xx | retried with backoff; the row stays on screen throughout                |
| Offline              | the write pauses, `paused` increments, and it sends itself on reconnect |
| Reload while pending | the pending write is lost; optimistic state is in memory only           |

Because a rejected write reverts silently, surface the reason:

```tsx
const [error, setError] = useState<string | null>(null);

<button
  onClick={() => {
    setError(null);
    db.tasks.update({ id, status: "done" }).catch((cause) => setError(cause.message));
  }}
>
  Done
</button>;

{
  error && <p role="alert">{error}</p>;
}
```

## Security

`where` is the boundary, and it is enforced by the query rather than by checking
what the browser sent:

```ts
where: ({ context }) => ({ orgId: context.org.id });
```

A client calling `db.tasks.update({ id: "another-org-row" })` produces a query
filtered by both the id and the scope, so it matches nothing and returns
`not_found`. Three consequences follow:

- **Columns named by `where` are server-owned.** They are injected on insert and
  ignored when a client sends them, so no separate read-only list is needed.
- **Synced rows are scoped too.** A device only holds rows that passed the
  filter, so the local store cannot leak another tenant's data offline.
- **A writable model with no filter fails the build.** Set `where: false` on a
  model to expose every row deliberately.

The context `where` reads comes from your own middleware, the same kind used by
server functions:

```ts
const withOrg = createServerMiddleware({
  async handler({ request, next }) {
    const session = await getSession(request);
    if (!session.user) throw new UnauthorizedError();
    return next({ context: { org: await loadOrg(session.user.orgId) } });
  },
});
```

Sync never inspects authentication itself; it reads the object your middleware
built, so any auth provider works.

## Persistence

Rows are stored in the browser so a revisit paints before the network answers.
Entries load stale-but-visible and are revalidated on the first read, so disk
data is never treated as fresh.

Only server-confirmed rows are written; an optimistic guess in flight never
reaches disk. Set `persist: false` to disable it, or replace the store:

```ts
import { setSyncPersistence, clearSyncedRows } from "@farm.js/sync/client";

setSyncPersistence(myIndexedDbStore);
await clearSyncedRows(); // on logout, so a shared device stays clean
```

## Operations beyond table writes

Anything that is not a row-level change stays an ordinary server function, and
composes with collections through invalidation:

```ts
export const archiveProject = createServerFn({
  input: z.object({ projectId: z.string() }),
  invalidates: () => [{ key: ["tasks"] }],
  async handler({ input, context }) {
    /* ... */
  },
});
```

## Limits

- **Live cross-user updates are not implemented.** Rows refresh on load and
  after your own writes; another user's change appears on the next load.
- **A pending write does not survive a reload.** Durable offline queueing is
  tracked separately.
- **`storage` mounts are key-value.** Point `client` at a database when you need
  your existing relational tables.
- **Tables are never created or altered.** Sync only reads and writes rows; see
  [where the tables come from](#where-the-tables-come-from).

## Example

`examples/local-first` is a runnable task list covering instant writes, warm
starts, offline queueing, and scope enforcement.
