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

When a shared adapter is present, Farm uses it as the authoritative cache instead of adding an
incoherent process-local front cache.

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

## Revalidate

**server action or route handler**

```ts
import { revalidatePath, revalidateTag } from "@farm.js/core/cache";

revalidateTag("products");
revalidatePath("/pricing");
```

`revalidatePath()` accepts a pathname or an HTTP(S) URL. Query strings and fragments do not change
the cache path and are removed during normalization.

## PPR shell

**src/app/dashboard/page.tsx**

```tsx
export const experimental_ppr = true;
export const revalidate = 60;

export default function DashboardPage() {
  return <main>Static shell with dynamic sections</main>;
}
```

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

PPR works best when the stable page shell is outside Suspense and request-specific or slow data lives inside Suspense.

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
