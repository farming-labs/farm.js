---
title: "Cache and PPR"
description: "Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages."
section: "Runtime"
---

# Cache and PPR

Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages.

## Configure a shared cache

Farm uses its process-local memory cache when `cache.adapter` is not configured. For multiple
servers or ephemeral deployments, configure one shared adapter in `farm.config.ts`:

```bash
pnpm add @farm.js/cache-redis ioredis
```

```ts
import { defineConfig } from "@farm.js/core";
import { redisCache } from "@farm.js/cache-redis";
import Redis from "ioredis";

export default defineConfig({
  cache: {
    adapter: redisCache({
      client: () => new Redis(process.env.REDIS_URL!),
    }),
    namespace: process.env.FARM_CACHE_NAMESPACE || "storefront",
  },
});
```

The adapter is selected once. Routes, queries, endpoints, server functions, ISR, and PPR continue
using Farm cache keys and invalidation helpers; application handlers do not import a Redis client.

If framework configuration is reloaded or a test calls `configureFarmCache()` again, Farm starts a
new cache generation. A fill that began under the previous adapter or namespace can still return to
its original caller, but it cannot populate the newly configured cache.

When a shared adapter is present, Farm uses it as the authoritative cache instead of adding an
incoherent process-local front cache.

The `cache` option also carries the browser-side counterpart: `cache.client.adapter` points at a
client module that persists opt-in reads on the device. See
[persist the client cache](/docs/api-client#persist-the-client-cache); the two adapters configure
different caches on different machines and never share a store.

## Cache data

**server data**

```ts
import { createFarmCacheKey, getFarmDataCache } from "@farm.js/core/cache";

const cache = getFarmDataCache();
const key = createFarmCacheKey(["products", "featured"]);

const products = await cache.getOrSet(key, () => fetchProducts(), {
  tags: ["products"],
  paths: ["/pricing"],
  revalidate: 300,
});
```

`clear()` invalidates entries and any fills already in progress. Existing callers still receive
their result, but an older fill cannot repopulate the cache after it has been cleared.

## Memoize a function

`unstable_cache()` wraps an async function so its results are cached and shared across requests,
processes, and restarts.

```ts
import { unstable_cache } from "@farm.js/core/cache";

const getProduct = unstable_cache(async (id: string) => fetchProduct(id), ["product"], {
  tags: ["products"],
  revalidate: 300,
});
```

The cache key is built from the function's identity (its name and a hash of its source), the active
locale, the `keyParts` array, and the call arguments. Identity comes from the source rather than the
closure instance so the key stays stable across processes and restarts — which lets a shared adapter
reuse entries between server instances.

Because of that, **list every variable the function closes over that is not one of its arguments in
`keyParts`.** Two closures with identical source text but different captured values otherwise share a
cache entry and return each other's data:

```ts
// Collides: `table` is captured, not an argument, so it never reaches the key.
const makeLoader = (table: string) => unstable_cache(async (id: string) => db.get(table, id));

// Correct: the captured value disambiguates the two closures.
const makeLoader = (table: string) =>
  unstable_cache(async (id: string) => db.get(table, id), [table]);
```

Values passed as call arguments already participate in the key, so they do not need to be repeated
in `keyParts`.

## Revalidate

**server action or route handler**

```ts
import { revalidatePath, revalidateTag } from "@farm.js/core/cache";

revalidateTag("products");
revalidatePath("/pricing");
```

`revalidatePath()` accepts a pathname or an HTTP(S) URL. Query strings and fragments do not change
the cache path and are removed during normalization.

### Invalidation counts under a shared adapter

The `count` reported on invalidation events (`cache.revalidateTag`, `cache.revalidatePath`) and the
`ppr.shell.invalidated` event are derived from Farm's process-local entry tracking. When a shared
`cache.adapter` is configured, entries and PPR shells live in the adapter rather than in local
memory, so these counts reflect only what the current process has tracked — they can read as `0`,
and `ppr.shell.invalidated` may not be emitted, even though the invalidation is still propagated to
the adapter and applied. Treat these counts and events as best-effort observability signals rather
than a confirmation of how many entries or shells were affected across a distributed deployment.

## PPR shell

Partial Prerendering is experimental and disabled by default. Enable it once in
`farm.config.ts`, then opt routes in individually. Without the flag, route-level PPR
declarations are ignored and those routes render fully dynamically.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    ppr: true,
  },
});
```

**src/app/dashboard/page.tsx**

```tsx
export const experimental_ppr = true;
export const revalidate = 60;

export default function DashboardPage() {
  return <main>Static shell with dynamic sections</main>;
}
```

Farm's own `export const ppr = true` and a top-of-file `"use ppr"` (or `"use ppr; 60"`)
directive are equivalent opt-ins; `experimental_ppr` matches the Next.js export name.
`farm explain <path>` reports whether a route's PPR declaration is active or ignored.

## Cache keys and tags

Use stable keys for data and broad tags for invalidation. Keys identify one cached value, while tags let multiple values be refreshed together.

```ts
const key = createFarmCacheKey(["products", productId]);

const product = await cache.getOrSet(key, () => getProduct(productId), {
  tags: ["products", `product:${productId}`],
  paths: ["/pricing"],
  revalidate: 300,
});
```

## Invalidate after writes

After a mutation, invalidate the route path and any data tags that feed the page.

For structured route data and [`createServerQuery`](/docs/server-queries) entries, call `invalidate(["resource", id])`. Farm uses the same route-data tag on the server and carries the invalidation to browser query and API consumers after a server action.

Server functions can declare the same relationship. Farm applies the targets only after the
handler succeeds and its output passes validation:

```ts
import { createServerFn } from "@farm.js/core/server-fn";

export const updateProduct = createServerFn({
  input: UpdateProduct,
  invalidates: ({ input, result }) => [
    { key: ["product", input.id] },
    { key: ["products", "list"] },
    { tag: "products" },
    { path: `/products/${result.id}` },
  ],
  async handler({ input }) {
    return db.product.update({
      where: { id: input.id },
      data: { name: input.name },
    });
  },
});
```

Endpoints accept the same `{ key }`, `{ tag }`, and `{ path }` targets. Imperative
`invalidate(...)`, `revalidateTag(...)`, and `revalidatePath(...)` remain supported. Await them
when calling outside a Farm action/endpoint request; Farm action requests automatically wait for
registered distributed invalidations before completing.

If a tag is invalidated while its value is still being generated, that caller can finish with the
generated value, but Farm keeps the stored entry stale so the next read regenerates it.

## Adapter contract

Custom adapters implement asynchronous entry persistence plus optional shared tag versions:

```ts
import type { FarmCacheAdapter } from "@farm.js/core/cache";

export const adapter: FarmCacheAdapter = {
  async get(key) {
    return backend.get(key);
  },
  async set(key, entry) {
    await backend.set(key, entry);
  },
  async delete(key) {
    await backend.delete(key);
  },
  async getTagVersions(tags) {
    return backend.getTagVersions(tags);
  },
  async invalidateTags(tags) {
    await backend.invalidateTags(tags);
  },
};
```

`getTagVersions` and `invalidateTags` coordinate invalidation without scanning every cached entry.
Provider-specific adapters should use atomic increments or transactions when their backing service
supports them. Lease-capable adapters return an ownership token from `acquireLease` and only
release the lease when `releaseLease(key, token)` still matches that owner.

For any Farm/unstorage-compatible client, `storageCacheAdapter(storage)` provides a portable
baseline. `@farm.js/cache-redis` adds Redis-native atomic tag increments and regeneration leases.

**src/app/api/products/route.ts**

```ts
import { revalidatePath, revalidateTag } from "@farm.js/core/cache";

export async function POST(request: Request) {
  const input = await request.json();
  await updateProduct(input);

  await revalidateTag("products");
  await revalidatePath("/pricing");

  return Response.json({ ok: true });
}
```

## PPR with Suspense holes

PPR works best when the stable page shell is outside Suspense and request-specific or slow data lives inside Suspense. As above, the route export only takes effect with `experimental.ppr` enabled in `farm.config.ts`.

When a production render actually suspends, Farm currently buffers that response for late status
errors and bypasses the shared PPR shell cache. This preserves fresh request-specific content
instead of caching a completed response as though it were a reusable partial shell.

```tsx
import { Suspense } from "react";

export const experimental_ppr = true;
export const revalidate = 60;

export default function BillingPage() {
  return (
    <main>
      <h1>Billing</h1>
      <Suspense fallback={<div>Loading subscription...</div>}>
        <SubscriptionStatus />
      </Suspense>
    </main>
  );
}
```

## Observability events

Cache and PPR emit events such as `cache.hit`, `cache.miss`, `cache.stale`, `cache.revalidatePath`, `cache.revalidateTag`, `ppr.shell.hit`, `ppr.shell.cached`, and `ppr.suspense.holeDetected`. Subscribe in `farm.config.ts` when debugging refresh behavior.

## Production notes

- Use one namespace per application or intentionally shared cache domain.
- Do not share authenticated values unless the cache key partitions by user or tenant.
- Treat adapter failures as production errors; declared mutations wait for invalidation.
- Use tags for data families, such as `products` or `billing`.
- Use paths for route-level invalidation, such as `/pricing`.
- Do not cache user-specific secrets in shared keys.
- Prefer PPR for pages with a mostly stable shell and a few dynamic sections.
