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

When sync talks to a database connection directly, it can create the tables your
schema describes. The command prints the SQL and stops; `--apply` runs it:

```bash
pnpm farm sync migrate
```

```sql
-- Generated by `farm sync migrate` from the sync schema.
-- Dialect: postgres
-- Review before applying. Farm never alters existing tables.

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "orgId" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "tasks_orgId_idx" ON "tasks" ("orgId");
```

Only models you listed in `models` are created. A model declared in the schema
but never exposed to the browser belongs to the rest of your app, so sync leaves
it alone.

Existing tables are reported, never altered, and an ORM-owned schema should keep
using its own migrations. See [Plugin Tables](/docs/plugins/schema-tables) for
the flags, the drift output, and how any plugin declares tables this way.

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

import { useLiveQuery } from "@farm.js/sync/react";

export default function TasksPage() {
  const open = useLiveQuery("tasks", (task) => task.status === "open", {
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

The model name is not a loose string. Farm generates a `SyncModels` map into
`src/farm.d.ts` from the schema, so `"tasks"` autocompletes, a wrong name is a
compile error, and `task` in the predicate is fully typed, enum unions
included. There is nothing to import or instantiate for this: write the
schema, and the types follow.

The predicate runs in the browser over rows already on the device, so any
expression is fine. Which rows reach the device is decided separately, by the
server's row filter.

| Field              | Meaning                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `rows`             | matching rows                                                                                    |
| `status`           | `"loading"` only on a genuine cold start; a revisit with persistence on is `"ready"`             |
| `error`            | a failed read. Previously loaded rows stay visible                                               |
| `pending`          | writes in flight against this model                                                              |
| `queued`           | writes waiting for the connection to return (`paused` is the same number)                        |
| `isEmpty`          | no rows matched                                                                                  |
| `isPersisted(row)` | true once the server confirmed the row; false while it is optimistic                             |
| `failures`         | rolled-back writes awaiting the user; see [when a write fails](#what-happens-when-a-write-fails) |

`useRow("tasks", id)` subscribes to a single row.

## Write

Writes hang off the same handle the live query returned, so a component has
one object for the model:

```ts
const tasks = useLiveQuery("tasks");

tasks.insert({ title: "Write the RFC" });
tasks.update(id, { status: "done" });
tasks.delete(id);
```

Each call applies to the local store immediately, so every view showing that row
re-renders in the same frame, then persists in the background. Fields the schema
fills in — the key, defaults, the cursor, and the columns owned by `where` — can
be omitted, and the generated types know it: `insert` marks them optional.

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

A rejected write reverts on screen, but it does not vanish: it lands in the
model's `failures` queue with the exact input that failed, the reason, and two
verbs. Render the queue once and every rollback in the app is accounted for:

```tsx
{
  tasks.failures.map((failure) => (
    <p key={failure.id} role="alert">
      {failure.error.message}
      <button onClick={() => failure.retry()}>Retry</button>
      <button onClick={() => failure.dismiss()}>Dismiss</button>
    </p>
  ));
}
```

`retry()` re-applies the optimistic state and sends the write again; a second
refusal records once, not once per attempt. `failures` is a queue rather than a
single error slot because fire-and-forget writes can fail out of order, minutes
after the gestures that caused them.

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

## Server-ruled transitions

A plain write cannot express "the server gets to say no before it becomes
true". Transitions with rules — complete, claim, approve — are ordinary server
functions, written once against your real database, and bound to a model with
`useSyncAction` so calling one behaves like every other sync write:

```ts title="src/actions.ts"
export const completeTask = createServerFn({
  async handler({ input, request }) {
    const task = await db.tasks.findFirst({ where: { id: input.id, ...scope(request) } });
    if (task?.status !== "open") throw new Error("Only an open task can be completed.");
    return db.tasks.update({ where: { id: input.id }, data: { status: "done" } });
  },
});
```

```tsx title="src/app/tasks/page.tsx"
import { completeTask } from "../actions";

const complete = useSyncAction(completeTask, "tasks", {
  optimistic: { status: "done" },
});

complete({ id: task.id }); // fire and forget, like any other write
```

The optimistic patch shows the transition instantly; the row the handler
returns replaces it when the server confirms, and a refusal rolls it back into
the same `failures` queue plain writes use. Every `useLiveQuery` over the model
follows along — the action writes the same store the queries read.

The patch resolves in tiers, so most actions declare nothing:

1. **Derived.** When the input carries the model's key plus fields that are
   schema columns — `rename({ id, title })` — those fields are the patch.
2. **Declared.** For transitions the input does not spell out, pass
   `optimistic` as a patch object, or as `(input) => patch` when it depends on
   the input.
3. **None.** Skip both and the action still lands: the returned rows commit
   into the store on arrival. Only the instant preview is missing.

The handler returning the changed row (or an array of rows) is what makes the
commit precise; return nothing row-shaped and the model refreshes instead. Do
not put the outcome in the input to game tier one — the handler owns the
transition, the patch is only the client's drawing of it.

Anything that is not a row-level change at all stays a plain server function
and composes through invalidation:

```ts
export const exportBoard = createServerFn({
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
