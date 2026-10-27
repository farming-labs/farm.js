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

The memory cache retains at most 1,024 entries by default and evicts the least recently used entry
when it reaches that limit. Set `cache.maxEntries` to a larger positive integer when one process
must keep a larger working set:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  cache: {
    maxEntries: 4_096,
  },
});
```

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

`revalidate` is measured in seconds and must be a finite, non-negative number. `0` makes an entry
immediately stale, while `false` explicitly disables time-based expiry. Invalid numeric values are
rejected instead of being treated as an indefinite cache lifetime.

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

When Farm serves a cached shell with dynamic holes, the browser refresh request bypasses browser and
shared HTTP caches. The completed response is private and is not stored, so the refresh cannot
receive the same cached shell again.

The client waits for a shell's background refresh before hydrating. Farm applies the completed
response's page props, route slots, manifests, locale, and deferred values first, so hydration sees
the same data that produced the refreshed HTML.

The background refresh reconciles the completed response into the existing shell. Stable elements
keep their DOM identity, focus, text selection, form values, and scroll position while server-owned
attributes and content update.

If the background refresh fails, hydration still proceeds after the first attempt. Farm retries a
failed refresh with backoff, at most three times and only while the browser is online, and stops as
soon as hydration starts, so a retry never replaces DOM the client has taken over.

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

Adapter keys are opaque strings that can contain `/`, `:`, `?` and other URL characters, for example
a PPR shell key carries the request path and query string. A custom adapter must store each key
distinctly. If `get` returns an entry whose `key` belongs to another lookup, Farm treats the read as
a miss and regenerates the value.

Entries with a finite `revalidate` carry an `expiresAt` timestamp. It covers the fresh window plus
one more `revalidate` window as stale (never less than 60 seconds), so stale-while-revalidate readers
can still serve the previous value. Adapters with native expiry should pass it to their backend so
one-off keys, such as one PPR shell per query string or one server query entry per input, do not
accumulate forever. Farm also deletes an entry it reads after `expiresAt`. Entries with
`revalidate: false` or no `revalidate` never expire on their own and stay until they are replaced or
invalidated.

For any Farm/unstorage-compatible client, `storageCacheAdapter(storage)` provides a portable
baseline. It percent-encodes keys and tags before handing them to the storage client, because
unstorage drops everything after `?` and folds `/`, `\` and `:` into one separator, and it stores
keys longer than 200 encoded characters under their SHA-256 hash so they stay within driver key
limits. It passes the remaining lifetime as the unstorage `ttl` option, in seconds. Drivers that
support `ttl` (memory, Redis, Upstash, Cloudflare KV, and others) drop expired entries; drivers that
ignore it rely on the delete-on-read cleanup. `@farm.js/cache-redis` adds Redis-native atomic tag
increments, regeneration leases, and `PX` expiry.

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

A render that reads the request with `headers()`, `cookies()`, or `getCurrentRequest()` is one
visitor's HTML, wherever the read happens: the page, a layout, `generateMetadata`, or a helper they
import. Reading `request.headers` in a server function or server query the render calls counts too;
calling one that leaves the request alone does not. Farm never stores that render as a PPR shell, in development or production. Production
sends it with `X-Farm-PPR: bypass` and `Cache-Control: private, no-store`. The same applies to a `revalidate` route whose layout reads the
request: it renders per request instead of advertising a shared `s-maxage`. Reads in middleware do
not count, since they run before the page renders.

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

## Responses behind middleware

A CDN keys its copy of a page by URL and serves it without running your middleware again. When
middleware lets a visitor through on something other than a cookie or an `Authorization` header,
such as an IP allowlist, an API key header, or a VPN header, a shared copy of that response would
reach everyone. Farm cannot tell such a guard from harmless middleware, so in production every
response that matched middleware is sent with `Cache-Control: private, no-store`: config
middleware, `src/app/**/middleware.ts` files (a root `middleware.ts` matches every path),
integration guards such as `protectedRoutes`, and plugins with a `runtime.before` hook. This
covers `ssg`, `revalidate`, and PPR pages, docs pages and the docs API, Markdown sources and
mirrors, and API responses. A shared directive (`public`, `s-maxage`, `CDN-Cache-Control`,
`Vercel-CDN-Cache-Control`, `Netlify-CDN-Cache-Control`) is removed, including one that a Nitro
`swr` or `headers` route rule or a `headers()` entry in `farm.config.ts` adds for that path; a
policy that is already private, such as `private, max-age=60`, is kept. Responses the middleware returns itself, such as a `403` or a
redirect, are sent as written.

Middleware that never decides who may read a response, such as logging or response headers, can
opt back into shared caching with `cache: "public"`:

```ts
// farm.config.ts
export default defineConfig({
  middleware: [
    {
      matcher: "/blog/:path*",
      cache: "public",
      handler(ctx) {
        ctx.headers.set("x-area", "blog");
      },
    },
  ],
});
```

A middleware file declares it in its exported `config`, and a plugin on its `runtime` hooks:

```ts
// src/app/middleware.ts
export const config = { cache: "public" };
```

A response stays shareable only when every middleware that matched it opts in. Shared caches serve
it without running that middleware, so never set `cache: "public"` on a guard.

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
