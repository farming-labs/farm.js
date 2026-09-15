---
title: "Local-First Patterns"
description: "Layer local-first behavior over the API you already have: instant cached reads, optimistic writes, retry and reconnect recovery, and an installable offline shell."
section: "Data and APIs"
---

# Local-First Patterns

A local-first application renders immediately from data it already holds, applies writes to the
screen before the server confirms them, and treats the network as a background concern instead of a
prerequisite. You do not need a sync engine, a client database, or a second backend to get most of
that experience. Farm's server queries, API client cache, and mutation options compose into
local-first behavior on top of the routes and handlers you already ship.

This guide is organized as four patterns, from least to most involved. Each pattern keeps the write
path on your existing [API routes](/docs/api-routes) and [server functions](/docs/server-queries):
nothing bypasses your validation, authorization, or database code.

> **What Farm does and does not provide**
>
> Farm's browser cache is shared, typed, and invalidation-aware, but it lives in memory. A page
> reload starts from an empty client cache, and there is no built-in durable queue that replays
> mutations submitted while offline. The patterns here deliver instant navigation, optimistic
> writes, and graceful reconnection; they do not make cold starts or long offline editing sessions
> work without the network. The [limits section](#know-the-limits) covers where the boundary is and
> what to do when you need more.

## Pattern 1: Instant reads

The foundation of local-first UX is never replacing useful content with a spinner. Give reads a
`staleTime` so revisits render from cache, and keep stale data visible while Farm refreshes it in
the background.

**src/features/products/queries.ts**

```ts
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

export const productQuery = createServerQuery({
  input: z.object({ id: z.string() }),
  key: ({ input }) => ["product", input.id],
  staleTime: "30s",

  async handler({ input }) {
    return db.product.findUniqueOrThrow({ where: { id: input.id } });
  },
});
```

```tsx
"use client";

import { useServerQuery } from "@farm.js/core/server-query/client";
import { productQuery } from "@/features/products/queries";

export function ProductPanel({ id }: { id: string }) {
  const product = useServerQuery(productQuery, { id });

  if (product.pending) return <ProductSkeleton />;

  return (
    <div aria-busy={product.fetching}>
      <h2>{product.data?.name}</h2>
      <strong>{product.data?.price}</strong>
    </div>
  );
}
```

`pending` is true only while the very first read has no data. After that, navigation back to this
component renders the cached result immediately; `fetching` reports the quiet background refresh.
Render it as a subtle indicator, not a loading screen.

The same lifecycle exists on the typed API caller when the read goes through an
[API route](/docs/api-client):

```ts
const result = await apiClient.products.get(
  { query: { id } },
  {
    cache: {
      key: ["product", id],
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);
```

Use `policy: "cache-first"` for data that changes rarely, such as reference lists or configuration:
a fresh cache entry answers without any request at all.

### Load before the user asks

Prefetching on intent makes navigation feel local because the data is already resolved when the
next view mounts:

```tsx
"use client";

import { prefetchServerQuery } from "@farm.js/core/server-query/client";
import { productQuery } from "@/features/products/queries";

export function ProductLink({ id }: { id: string }) {
  return (
    <a href={`/products/${id}`} onPointerEnter={() => prefetchServerQuery(productQuery, { id })}>
      Open product
    </a>
  );
}
```

Concurrent prefetches and mounted consumers share one browser request, so prefetching on strong
signals such as pointer focus or viewport proximity does not multiply load.

## Pattern 2: Optimistic writes

Local-first writes apply to the screen synchronously and reconcile with the server afterward. Farm
implements this in the shared client cache: a mutation updates the cached read it affects, rolls
back if the request fails, and invalidates the key after the server responds so the canonical
result replaces the guess.

```ts
const products = await apiClient.products.get(
  { query: { category } },
  {
    cache: {
      key: ["products", category],
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);

await apiClient.products.post(
  { body: draft },
  {
    optimistic: {
      update: [
        [
          products.key,
          (current) => ({
            ...current,
            products: [{ ...draft, id: "optimistic" }, ...(current?.products ?? [])],
          }),
        ],
      ],
      rollbackOnError: true,
    },
    invalidate: [products.key],
  },
);
```

The updater runs before the POST resolves, so the list shows the new product immediately.
`products.key` carries the cached response type, so `current` is inferred. With
`rollbackOnError: true`, a failed mutation restores the exact previous entry; the user sees the
item disappear rather than a silently wrong list.

Because the cache is shared, this update also reaches `useServerQuery` consumers watching the same
structured key — declare the key once and reuse it across the route, the API caller, and the query.
Use `defineCacheKey` from `@farm.js/core/cache` when you want the updater's `current` parameter
typed from a shared key factory. See
[share keys with routes and APIs](/docs/server-queries#share-keys-with-routes-and-apis).

### Let the server declare what a write invalidates

When the mutation is a server function, put the invalidation next to the write instead of in every
caller:

```ts
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

export const renameProduct = createServerFn({
  input: z.object({ id: z.string(), name: z.string().min(1) }),

  invalidates: ({ input }) => [{ key: ["product", input.id] }],

  async handler({ input }) {
    await db.product.update({ where: { id: input.id }, data: { name: input.name } });
    return { ok: true };
  },
});
```

Farm carries the structured invalidations back with the action response. Mounted stale queries
refetch automatically, and concurrent consumers still share one request. The client did not need to
know which keys the write touched — the server, which owns the write, declared it.

### Keep button and form state local

`useMutation` and `useFetcher` add the pending/result lifecycle around the same request options, so
optimistic cache updates, invalidation, and retry settings pass straight through `request`:

```tsx
"use client";

import { useMutation } from "@farm.js/core/client";
import { apiClient } from "@/lib/api";

export function RenameButton({ id, name }: { id: string; name: string }) {
  const rename = useMutation(apiClient.products.patch, {
    request: {
      invalidate: { targets: [[apiClient.products.get]], refetch: true },
    },
  });

  return (
    <button disabled={rename.pending} onClick={() => rename.mutate({ body: { id, name } })}>
      {rename.pending ? "Saving..." : "Save"}
    </button>
  );
}
```

`invalidate: { targets, refetch: true }` refreshes the previously cached read in the background
after the mutation succeeds, so watchers converge on the canonical server result without a visible
loading state. A route reference target resolves with the input in its tuple:
`[apiClient.products.get]` matches a read made without input, and a read made with input needs the
same input in the target, `[apiClient.products.get, { query: { category } }]`, or an explicit
shared cache key so the two resolve to the same entry.

## Pattern 3: Survive a flaky network

Local-first behavior is mostly about what happens when requests fail or the connection drops.

**Retry transient failures.** The API client retries with a count and a fixed or backoff delay:

```ts
const result = await apiClient.products.get(
  { query: { id } },
  {
    retry: {
      count: 3,
      delay: (attempt) => attempt * 500,
    },
  },
);
```

**Recover on reconnect.** Stale `useServerQuery` reads refresh automatically on window focus and on
the browser `online` event. This is default behavior; disable it per consumer with
`refetchOnWindowFocus: false` or `refetchOnReconnect: false` when a view should stay still.

**Degrade to stale, not to blank.** If an automatic refresh fails, `useServerQuery` keeps the
previous data visible, exposes the `error`, and does not retry in a loop. The user keeps reading
cached content; `refetch()`, the next invalidation, or the next reconnect triggers another attempt.

```tsx
const product = useServerQuery(productQuery, { id });

return (
  <div>
    {product.error && product.data ? <StaleBanner onRetry={product.refetch} /> : null}
    <ProductView product={product.data} />
  </div>
);
```

**Design writes for retries.** A user on a bad connection will press the button again. Make
mutation handlers idempotent — accept a client-generated id in the body and upsert, or make the
second identical write a no-op — so a retried or duplicated request cannot double-apply.

## Pattern 4: Ship an offline shell

The [PWA plugin](/docs/plugins/pwa) makes the application itself load without a network: it
precaches immutable build assets and statically emitted HTML, serves a static offline fallback
page, and caches public images with stale-while-revalidate.

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { pwa } from "@farm.js/pwa";

export default defineConfig({
  plugins: [
    pwa({
      offline: "/offline",
      cache: "auto",
    }),
  ],
});
```

The generated worker only intercepts same-origin `GET` requests. Dynamic pages, API routes, server
actions, and integrations stay network-owned, so the service worker never serves a stale
authenticated response or swallows a write. Combined with the read patterns above, the result is an
app whose shell, static pages, and recently viewed data all survive a dropped connection.

## Know the limits

Be honest with yourself about where built-in behavior ends, and design inside it:

- **The client cache is memory-only.** A reload or new tab starts empty; the first read of each key
  after a cold start needs the network. Prefetch aggressively and lean on the PWA shell for static
  content, but do not promise users their dynamic data survives a restart.
- **Optimistic state is session-scoped.** A pending optimistic update that has not reached the
  server is lost on reload. Keep optimistic windows short: send the request immediately, and avoid
  batching user writes in client state.
- **There is no offline mutation queue.** A write attempted with no connectivity fails after its
  retries. Surface that clearly — disable submission or queue in application state when
  `navigator.onLine` is false, and reconcile through your normal mutation path once the `online`
  event fires — rather than letting writes fail silently.

If your product genuinely requires long offline editing sessions or multi-device merge — field
work, collaborative documents — pair Farm with a dedicated client store or sync engine for that
feature's data. The division of labor stays clean: the sync client owns the read path and local
persistence for those documents, while every write still flows through the Farm API routes and
server functions you already validate and authorize.

## Production practices

- Give every read a deliberate `staleTime`; `0` means "always revalidate", which turns navigation
  back into a network round trip.
- Use one structured key per data shape, shared across route data, API reads, queries, and
  optimistic updaters. Never share a key between different response contracts.
- Render `fetching` as a quiet indicator and reserve full skeletons for `pending`.
- Enable `rollbackOnError` for optimistic updates the user can see; a visible rollback beats a
  wrong list.
- Invalidate on the server with `invalidates` where the write lives, and reserve caller-side
  `invalidate` for keys only that screen knows about.
- Keep mutation handlers idempotent before adding `retry` to writes.
- Test the offline story in a real browser with the network disabled — production service worker
  behavior does not exist in the dev server.
