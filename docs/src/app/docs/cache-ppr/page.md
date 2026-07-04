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

const products = await cache.getOrSet(
  key,
  () => fetchProducts(),
  {
    tags: ["products"],
    paths: ["/pricing"],
    revalidate: 300,
  },
);
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
