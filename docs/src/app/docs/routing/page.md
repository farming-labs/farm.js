---
title: "Routing"
description: "Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation."
section: "Core"
---

# Routing

Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation.

## File routes

| File | URL |
| --- | --- |
| src/app/page.tsx | / |
| src/app/about/page.tsx | /about |
| src/app/about/page.mdx | /about |
| src/app/blog/[slug]/page.tsx | /blog/:slug |
| src/app/docs/[...slug]/page.tsx | /docs/:slug* |

## Dynamic params

**src/app/users/[id]/page.tsx**

```tsx
import type { PageProps } from "@farmjs/core";

export default function UserPage({ params }: PageProps) {
  return <div>User: {params?.id}</div>;
}
```

## Typed navigation

Farm generates src/farm-routes.d.ts from your app tree. Link hrefs accept real routes, query strings, and hash fragments without widening everything to plain string.

**Client navigation**

```tsx
import { Link } from "@farmjs/core/client";

export function Nav() {
  return (
    <>
      <Link href="/about">About</Link>
      <Link href="/blog/farm-routing?from=docs">Routing</Link>
    </>
  );
}
```

## Lightweight router helpers

Use the lightweight router when client components, layouts, breadcrumbs, tabs, or tests need to match app routes without adding a separate routing library.

**src/lib/router.ts**

```ts
import { createFarmRouter } from "@farmjs/core/router";

export const router = createFarmRouter([
  "/",
  "/dashboard",
  "/users/[id]",
  "/docs/[[...slug]]",
]);
```

```ts
const match = router.match("/users/ada?tab=settings");

if (match) {
  console.log(match.route.path); // /users/[id]
  console.log(match.params.id); // ada
}
```

Build hrefs from the same route patterns:

```ts
const href = router.build("/docs/[[...slug]]", {
  slug: ["core", "routing"],
});
```

This returns `/docs/core/routing`. Optional catch-all params can be omitted, static routes win over dynamic routes, and route groups such as `(marketing)` do not appear in the URL.

Client components can pass the same route list to `useRouter` when they want current route params:

```tsx
import { useRouter } from "@farmjs/core/client";

export function CurrentUserTab() {
  const router = useRouter({
    routes: ["/users/[id]", "/users/[id]/settings"],
  });

  return <span>{router.params.id}</span>;
}
```

## Route data cache

Programmatic routes can cache the value returned from `data.main`. This is useful for product pages, docs pages, dashboards, and other route data that should be reused during server rendering or prefetching.

```tsx
import { createRoute, invalidate } from "@farmjs/core";
import { z } from "zod";
import { ProductPage } from "./page";

export const ProductRoute = createRoute("/products/[id]", {
  params: z.object({ id: z.string() }),

  data: {
    key: ({ params }) => ["product", params.id],
    staleTime: "30s",

    async main({ params }) {
      return {
        product: await db.product.findUnique({ where: { id: params.id } }),
      };
    },
  },

  component: ProductPage,
});

export async function saveProduct(id: string, name: string) {
  await db.product.update({ where: { id }, data: { name } });
  await invalidate(["product", id]);
}
```

`key` enables caching. When a cached entry is still fresh, Farm reuses the previous `data.main` result. `before` still runs for each request, and `after` still runs with the returned data, so setup and logging hooks keep their normal behavior.

`staleTime` accepts a number of milliseconds or a duration string such as `"500ms"`, `"30s"`, `"5m"`, or `"1h"`. Omit `staleTime` when data should stay cached until invalidated.

Farm also tags route data by the rendered path, so `revalidatePath("/products/123")` invalidates the matching route data entry. Use `tags` or `paths` when one mutation should refresh more than one route:

```tsx
export const ProductRoute = createRoute("/products/[id]", {
  data: {
    key: ({ params }) => ["product", params.id],
    tags: ({ params }) => [`product:${params.id}`, "products"],
    paths: ({ params }) => [`/products/${params.id}`, "/products"],
    async main({ params }) {
      return { product: await getProduct(params.id) };
    },
  },
  component: ProductPage,
});
```

Cache keys are part of your data security model. If data depends on the current user, role, tenant, locale, or draft mode, include that value in `key` or avoid caching that route. Route cache invalidation improves freshness, but API routes and server functions still need their own authorization checks.

## Nested segments

Folders become URL segments. Use normal folders for visible path segments and dynamic folders when the value comes from the URL.

**Route tree**

```txt
src/app/
  page.tsx
  dashboard/
    page.tsx
    settings/
      page.tsx
  blog/
    [slug]/
      page.tsx
  docs/
    [...slug]/
      page.tsx
```

This creates `/`, `/dashboard`, `/dashboard/settings`, `/blog/:slug`, and `/docs/:slug*`.

## Markdown pages

Use `page.md` or `page.mdx` for static content routes. They behave like app pages, participate in layouts, and get route types.

**src/app/about/page.mdx**

```mdx
# About

This page renders at `/about` and exposes source at `/about.md`.
```

Do not place `page.tsx` and `page.mdx` in the same folder. Farm treats that as a duplicate route and asks you to choose one page source.

## Catch-all routes

Catch-all routes are useful for docs, CMS content, and nested marketing pages where the page is resolved from content instead of a fixed file for every URL.

**src/app/docs/[...slug]/page.tsx**

```tsx
import type { PageProps } from "@farmjs/core";

export default function DocsPage({ params }: PageProps) {
  const slug = params.slug?.split("/") ?? [];
  return <main>Docs path: {slug.join(" / ")}</main>;
}
```

## Route groups

Use route groups to organize files without adding URL segments. They are useful when an app has multiple shells.

**Route groups**

```txt
src/app/
  (marketing)/
    page.tsx
    pricing/
      page.tsx
  (app)/
    dashboard/
      page.tsx
```

The group names are organizational. The URLs are still `/`, `/pricing`, and `/dashboard`.

## Navigation workflow

1. Add or rename route files.
2. Keep `farm dev` running; Farm regenerates route and API types when route files change.
3. Use `Link` for internal navigation and plain anchors for external URLs.
4. Keep dynamic route values encoded in the href string, such as `/blog/${slug}`.

Run `farm generate` when you want to refresh generated types outside the dev server, such as in CI or after a large file move.
