---
title: "Cache and PPR"
description: "Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages."
section: "Runtime"
---

# Cache and PPR

Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages.

## Cache data

**server data**

```ts
import { createFarmCacheKey, getFarmDataCache } from "@farmjs/core/cache";

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
import { revalidatePath, revalidateTag } from "@farmjs/core/cache";

revalidateTag("products");
revalidatePath("/pricing");
```

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

**src/app/api/products/route.ts**

```ts
import { revalidatePath, revalidateTag } from "@farmjs/core/cache";

export async function POST(request: Request) {
  const input = await request.json();
  await updateProduct(input);

  revalidateTag("products");
  revalidatePath("/pricing");

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

- Use tags for data families, such as `products` or `billing`.
- Use paths for route-level invalidation, such as `/pricing`.
- Do not cache user-specific secrets in shared keys.
- Prefer PPR for pages with a mostly stable shell and a few dynamic sections.
