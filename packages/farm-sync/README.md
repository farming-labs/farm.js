# @farm.js/sync

Local-first collections for Farm.js. The `sync()` plugin exposes models from a `defineSchema`
schema to the browser through one endpoint: reads render from a local store, writes apply before the
server answers, writes made offline wait for the connection, and confirmed rows stay on the device
for the next visit. Every read and write still goes through your database, filtered by a rule you
control on the server.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/sync
```

`react` is an optional peer dependency, needed only for the hooks in `@farm.js/sync/react`. The
package requires Node.js 22.13 or later.

## Configure

Declare the data once with `defineSchema`. Each exposed model needs exactly one `primaryKey` field,
and a `datetime` field named `updatedAt` turns on incremental loads after the first one.

```ts
// src/schema.ts
import { defineSchema } from "@farm.js/core";

export const schema = defineSchema({
  models: {
    tasks: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        title: { type: "string", required: true },
        status: { type: "enum", values: ["open", "done"], default: "open" },
        listId: { type: "string", required: true, index: true, default: "" },
        updatedAt: { type: "datetime" },
      },
    },
  },
});
```

Then register the plugin with a data source, the models the browser may use, and the row filter:

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { localStorage as fileStorage } from "@farm.js/core/storage";
import { sync } from "@farm.js/sync";
import { schema } from "./src/schema";

export default defineConfig({
  storage: {
    mounts: {
      app: fileStorage({ base: "./.farm/data" }),
    },
  },
  plugins: [
    sync({
      schema,
      storage: "app",
      models: { tasks: "write" },
      middleware: [
        ({ request }) => {
          const match = (request.headers.get("cookie") ?? "").match(/farm_list=([^;]+)/);
          return { listId: match?.[1] ?? "demo" };
        },
      ],
      where: ({ context }) => ({ listId: context.listId }),
    }),
  ],
});
```

A `storage` mount is key-value. Pass `client` instead (a `pg` pool, a Drizzle or Prisma client, a
D1 binding, a Mongo client, or a function returning one) to read and write real tables. Sync never
creates tables mid-request: for a raw SQL connection, `farm sync migrate` prints the SQL for the
exposed models and `--apply` runs it.

## Read and write

```tsx
// src/app/tasks/page.tsx
"use client";

import { useLiveQuery, useSyncAction } from "@farm.js/sync/react";

export default function TasksPage() {
  const open = useLiveQuery("tasks", (task) => task.status === "open");
  const tasks = useSyncAction("tasks");

  return (
    <ul>
      {open.rows.map((task) => (
        <li key={task.id}>
          {task.title}
          <button onClick={() => tasks.update(task.id, { status: "done" })}>Done</button>
        </li>
      ))}
    </ul>
  );
}
```

Farm generates a `SyncModels` map into `src/farm.d.ts` from the schema, so model names and row
fields are type-checked. `useLiveQuery` returns `rows`, `status`, `error`, `pending`, `queued`,
`isPersisted(row)`, and `failures`, the queue of rolled-back writes, each with `retry()` and
`dismiss()`. `useRow(model, key)` subscribes to one row.

`insert`, `update`, and `delete` apply locally at once and return a handle that can be ignored,
awaited, or read through `.persisted`, `.key`, and `.state`. Pass any promise-returning function,
such as a typed API call, as `useSyncAction(fn, "tasks", { optimistic })` for a transition the
server rules on.

## Options

| Option           | Default       | Notes                                                                    |
| ---------------- | ------------- | ------------------------------------------------------------------------ |
| `schema`         |               | Required. A schema from `defineSchema`.                                  |
| `models`         |               | Required. `"write"`, `"read"`, `false`, or `{ access, where, persist }`. |
| `storage`        |               | A mount name from `storage.mounts`.                                      |
| `client`         |               | Your database connection, instead of `storage`.                          |
| `where`          |               | Row filter for every read and write, applied on the server.              |
| `middleware`     |               | Functions `({ request, context })` that build the context `where` reads. |
| `persist`        | `true`        | Keep confirmed rows on the device for warm starts.                       |
| `path`           | `/_farm/sync` | The POST endpoint the browser calls.                                     |
| `allowedOrigins` |               | Extra origins allowed to call the endpoint.                              |
| `dialect`        |               | SQL dialect for `farm sync migrate` when it cannot be detected.          |

## Security

`where` is enforced by the query, not by checking what the browser sent, so a write outside the
caller's scope matches nothing and returns `not_found`. Columns the filter names are server-owned
and stamped on inserts. A model with no filter, global or its own, fails when the config loads; set
`where: false` on a model to expose every row deliberately. The endpoint rejects cross-site POSTs
with `403` unless the origin is listed in `allowedOrigins`.

## Entry points

| Import                 | Provides                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `@farm.js/sync`        | `sync()` and its server types, such as `SyncPluginOptions` and `SyncMiddleware`.     |
| `@farm.js/sync/client` | The renderer-neutral browser runtime: `db`, `setSyncPersistence`, `clearSyncedRows`. |
| `@farm.js/sync/react`  | `useLiveQuery`, `useRow`, and `useSyncAction`.                                       |

Call `clearSyncedRows()` when the session changes without a page reload, such as sign-out or an
organization switch, so the next account never sees the previous one's rows.

## Documentation

- [Sync Plugin](https://farmjs.dev/docs/plugins/sync)
- [Local-First Patterns](https://farmjs.dev/docs/local-first)

The runnable `examples/local-first` app covers instant writes, warm starts, offline queueing, and
scope enforcement.

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
