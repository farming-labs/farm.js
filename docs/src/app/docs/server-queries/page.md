---
title: "Server Queries"
description: "Define typed server reads once, deduplicate requests, prefetch browser data, use stale-while-revalidate, and invalidate route, API, and query consumers with one key."
section: "Data and APIs"
---

# Server Queries

`createServerQuery` defines a typed server read with one structured cache key. The same declaration works during server rendering, through a generated browser server reference, with browser prefetch, and in `useServerQuery`.

The browser lifecycle is intentionally familiar to React Query and TanStack Query users: request
deduplication, prefetching, `staleTime`, stale-while-revalidate, focus and reconnect refresh, shared
invalidation, and optimistic cache writes. Farm implements this behavior in its own cache and
generated server references; it does not install or wrap TanStack Query.

## Declare a query

**src/features/products/queries.ts**

```ts
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

const Product = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
});

export const productQuery = createServerQuery({
  input: z.object({ id: z.string() }),
  output: Product,
  key: ({ input }) => ["product", input.id],
  staleTime: "30s",

  async handler({ input, request, signal, context }) {
    return db.product.findUniqueOrThrow({
      where: { id: input.id },
    });
  },
});
```

Farm adds the server-module boundary during compilation. Keep exported `createServerQuery` declarations out of files with `"use client"`, just like `createServerFn` declarations.

The `input`, `output`, and middleware contracts are the same as `createServerFn`. Input is validated before the key and handler run. Output is validated before it enters either the server or browser cache.

## Call on the server

```tsx
import { productQuery } from "@/features/products/queries";

export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await productQuery({ id: params.id });
  return <h1>{product.name}</h1>;
}
```

Matching calls in one render request share the same in-flight promise. The handler runs once and every caller receives the validated result.

## Prefetch in the browser

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

Concurrent prefetches and mounted consumers use one browser request. A successful prefetch is immediately available to `useServerQuery`.

## Read with browser SWR

```tsx
"use client";

import { useServerQuery } from "@farm.js/core/server-query/client";
import { productQuery } from "@/features/products/queries";

export function ProductPrice({ id }: { id: string }) {
  const product = useServerQuery(productQuery, { id });

  if (product.pending) return <ProductPriceSkeleton />;
  if (product.error && !product.data) return <p>{product.error.message}</p>;

  return (
    <div aria-busy={product.fetching}>
      <strong>{product.data?.price}</strong>
      <button type="button" onClick={() => product.refetch()}>
        Refresh
      </button>
    </div>
  );
}
```

The hook returns `data`, `error`, `status`, `pending`, `fetching`, `stale`, and `refetch`. Stale data remains visible while Farm refreshes it in the background. Stale queries also refresh on window focus and reconnect unless those options are disabled.

Use `fetchServerQuery(productQuery, input)` for an imperative browser read that should participate in deduplication and SWR. Calling the generated `productQuery(input)` reference directly still returns plain typed data, but the fetch helper supplies the browser cache lifecycle.

## Invalidate after a mutation

```ts
import { invalidate } from "@farm.js/core/cache";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

export const updateProduct = createServerFn({
  input: z.object({
    id: z.string(),
    name: z.string().min(1),
  }),

  async handler({ input }) {
    await db.product.update({
      where: { id: input.id },
      data: { name: input.name },
    });

    invalidate(["product", input.id]);
    return { ok: true };
  },
});
```

During a browser server-action call, Farm carries structured invalidations back with the action response. Mounted stale queries refetch automatically, and concurrent consumers still produce one request.

## Share keys with routes and APIs

Server queries use the existing route-data cache namespace and tag. They do not create a separate server cache.

For a key used in several features, keep its factory in a module that is safe to import from both
the browser and server. Plain string and array keys remain the default and require no helper:

```ts
export const productKey = (id: string) => ["product", id] as const;
```

Use `defineCacheKey` only when you want TypeScript to carry the value stored under that key into
optimistic cache updaters:

```ts
import { defineCacheKey } from "@farm.js/core/cache";
import type { Product } from "./types";

export const productKey = defineCacheKey<Product>()((id: string) => ["product", id] as const);
```

The helper adds no wrapper object or runtime cache format. `productKey("123")` is still the raw
`["product", "123"]` array, so typed and untyped keys interoperate and existing applications do
not need to migrate.

Use the same structured key in programmatic route data:

```ts
data: {
  key: ({ params }) => ["product", params.id],
  staleTime: "30s",
  async main({ params }) {
    return getProduct(params.id);
  },
}
```

Use it in an API client cache when the API response has the same data contract:

```ts
const result = await api.products.get(
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

The route, API caller, and server query now read and invalidate the same canonical key. Default API keys remain isolated by request origin; only an explicit structured key opts into cross-feature sharing.

### Share optimistic updates

API mutations can optimistically update data watched by `useServerQuery` when both features use the
same structured key and the same data shape:

```ts
const products = await api.products.get(
  { query: { category } },
  {
    cache: {
      key: ["products", category],
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);

await api.products.post(
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

This works through the shared Farm client cache; `useServerQuery` does not expose a separate
optimistic option. Keep the API response and server-query result contracts identical whenever they
share a key.

## Cache lifetime

| `staleTime`                         | Server behavior                                                     | Browser behavior                                                   |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| omitted or `0`                      | Deduplicate within the current request without retaining the result | Treat a result as immediately stale and refresh it when read again |
| duration such as `"30s"` or `30000` | Store in the shared route-data cache until stale                    | Return fresh data until the duration expires, then use SWR         |
| `false`                             | Store until explicit invalidation                                   | Keep fresh until explicit invalidation                             |

Numbers are milliseconds. Duration strings support `ms`, `s`, `m`, and `h`. Failed handlers and invalid output are never cached.

## Middleware and cancellation

Queries accept the same composable middleware as server functions:

```ts
export const accountQuery = createServerQuery({
  middleware: [requireSession],
  input: z.object({ accountId: z.string() }),
  key: ({ input, context }) => ["account", context.user.id, input.accountId],
  async handler({ input, context, signal }) {
    return getAccount(input.accountId, context.user.id, { signal });
  },
});
```

Authentication middleware still runs for every query invocation, including cache hits. The request signal aborts when the underlying server-action request is cancelled.

## Security practices

- Treat a server-query reference as transport, not authorization. Verify authentication, role, tenant, and resource ownership on the server.
- Include every identity that changes the result in a persistent key. For private data, use keys such as `["account", context.user.id, accountId]`, not only `["account", accountId]`.
- Prefer request-only caching by omitting `staleTime` when a safe shared persistent key is not available.
- Keep output schemas narrow so private database fields cannot enter the browser cache accidentally.
- Never place secrets, tokens, or raw session objects in keys; keys can appear in diagnostics and invalidation metadata.
- Use API routes instead of server queries for intentionally cross-origin or public HTTP contracts.

## Production practices

- Keep keys small, deterministic, and serializable.
- Use one key for one data shape. Route data, API responses, and queries should share a key only when their cached value contracts match.
- Prefetch on strong intent such as pointer focus, viewport proximity, or an immediately likely next step.
- Render stale data with a quiet `fetching` state instead of replacing useful content with a full loading screen.
- Invalidate immediately after the database transaction succeeds.
- Return typed expected states such as `notFound` or `forbidden`; reserve thrown errors for unexpected failures.
