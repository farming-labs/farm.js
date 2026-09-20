# Local-first example

A task list built with `@farm.js/sync`. Writes apply to the screen immediately,
rows survive a reload, and edits made offline queue and send themselves on
reconnect.

```bash
pnpm --filter farm-local-first dev
```

## What it demonstrates

| Behavior | Where it comes from |
| --- | --- |
| Rows render from the browser store, not a request | `useLiveQuery(db.tasks, predicate)` |
| Writes appear instantly, before the server replies | optimistic layer in the sync store |
| A rejected write reverts the row | layer removed on failure |
| Offline writes wait instead of failing | `networkMode: "online"` pause/resume |
| Reload paints from disk | `cache.client.adapter` persistence |
| One row, many views, one update | shared row store |

## How it is wired

**`src/schema.ts`** declares the data once. Field metadata does real work: the
`primaryKey` becomes the row key, `values` on the enum types the status column,
and a `datetime` named `updatedAt` turns on incremental sync automatically.

**`farm.config.ts`** exposes models to the browser and scopes them:

```ts
sync({
  schema,
  client: () => db,
  models: { tasks: "write" },
  where: ({ context }) => ({ listId: context.listId }),
  middleware: [/* puts listId on context */],
})
```

`where` is the security boundary. It is merged into the query on the server, so
a browser calling `db.tasks.update({ id: "someone-elses-row" })` matches zero
rows rather than being trusted and rejected afterwards. The columns it names
(`listId`) are server-owned: they are injected on insert and ignored if a client
sends them.

This demo scopes by a per-browser list id instead of a login so it runs with no
auth setup. A real app puts a session on `context` through the same middleware
and scopes by user or organisation.

**`src/db.ts`** is the server data layer — a small relational-shaped client over
a Farm storage mount, so the example runs with no external database. The plugin
only needs `findMany/create/update/deleteMany`, which is the shape an
`@farming-labs/orm` client already exposes; point `client` at a real ORM and
nothing else changes.

**`src/cache-adapter.ts`** is five callbacks over `localStorage`. Swap it for
IndexedDB, OPFS, or a native bridge without touching anything else.

## Try the local-first behavior

1. **Instant writes** — add a task; it appears with no spinner and no refetch.
2. **Warm start** — reload; the list paints from disk before the network answers.
3. **Offline** — go offline in devtools, mark a task done. The row updates and
   the banner shows the write waiting. Go back online and it sends itself.
4. **Scope enforcement** — from the console, try writing to a row id from
   another list. The request returns 404: the filter never matched it.

## Not in this example

Live cross-user updates (a second browser seeing your change without a refresh)
need the realtime stream, which is not implemented yet. Rows refresh on load and
after your own writes.
