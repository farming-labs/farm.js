---
title: "Routing"
description: "Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation."
section: "Core"
---

# Routing

Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation.

## File routes

| File                            | URL           |
| ------------------------------- | ------------- |
| src/app/page.tsx                | /             |
| src/app/about/page.tsx          | /about        |
| src/app/about/page.mdx          | /about        |
| src/app/blog/[slug]/page.tsx    | /blog/:slug   |
| src/app/docs/[...slug]/page.tsx | /docs/:slug\* |

## Dynamic params

**src/app/users/[id]/page.tsx**

```tsx
import type { PageProps } from "@farm.js/core";

export default function UserPage({ params }: PageProps) {
  return <div>User: {params?.id}</div>;
}
```

## Typed navigation

Farm generates src/farm-routes.d.ts from your app tree. Link hrefs accept real routes, query strings, and hash fragments without widening everything to plain string.

**Client navigation**

```tsx
import { Link } from "@farm.js/core/client";

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
import { createFarmRouter } from "@farm.js/core/router";

export const router = createFarmRouter(["/", "/dashboard", "/users/[id]", "/docs/[[...slug]]"]);
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
import { useRouter } from "@farm.js/core/client";

export function CurrentUserTab() {
  const router = useRouter({
    routes: ["/users/[id]", "/users/[id]/settings"],
  });

  return <span>{router.params.id}</span>;
}
```

## Navigation blocking

Use `useBlocker` when a client component needs to protect unsaved work before SPA navigation continues.

```tsx
"use client";

import { useBlocker } from "@farm.js/core/client";

export function ProductForm({ isDirty }: { isDirty: boolean }) {
  useBlocker({
    when: isDirty,
    message: "You have unsaved changes.",
  });

  return <form>{/* ... */}</form>;
}
```

Blockers apply to Farm SPA navigation and browser unload prompts. They improve UX, but they do not replace server-side validation or persistence checks.

## Page state

Use page state for shallow UI state that belongs in browser history but should not reload route data: modals, drawers, selected panels, or temporary filters.

```tsx
"use client";

import { usePageState, useRouter } from "@farm.js/core/client";

export function ProductToolbar() {
  const router = useRouter();
  const page = usePageState<{ modal?: "cart"; drawer?: "filters" }>();

  return (
    <>
      <button onClick={() => router.pushState({ modal: "cart" })}>Cart</button>
      <button onClick={() => router.replaceState({ drawer: "filters" })}>Filters</button>
      {page?.modal === "cart" ? <CartModal /> : null}
    </>
  );
}
```

Page state is stored in `history.state`, so back/forward navigation restores the previous state without changing the URL unless you pass an href.

## Scroll restoration

Farm restores window scroll during SPA navigation. Register nested scroll areas when a layout owns its own scroll container.

```tsx
"use client";

import { useScrollRestoration } from "@farm.js/core/client";

export function DocsSidebar() {
  const ref = useScrollRestoration<HTMLDivElement>("docs-sidebar");
  return <div ref={ref}>{/* links */}</div>;
}
```

Use stable keys per scroll container. If two elements share a key, the latest mounted element owns that stored position.

## Route data cache

Programmatic routes can cache the value returned from `data.main`. This is useful for product pages, docs pages, dashboards, and other route data that should be reused during server rendering or prefetching.

```tsx
import { createRoute, invalidate } from "@farm.js/core";
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

## Deferred route data

Use `defer()` for secondary data that should not delay the route shell. Farm returns the value from `data.main` as soon as its directly awaited work finishes, then streams explicitly deferred fields into nested React Suspense boundaries.

**src/features/products/page.tsx**

```tsx
import { Suspense, use } from "react";
import type { Deferred } from "@farm.js/core";

export function ProductPage({ data }: ProductPageProps) {
  return (
    <main>
      <h1>{data.product.name}</h1>
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews reviews={data.reviews} />
      </Suspense>
    </main>
  );
}

function Reviews({ reviews }: { reviews: Deferred<Review[]> }) {
  const resolvedReviews = use(reviews);
  return resolvedReviews.map((review) => <ReviewRow key={review.id} review={review} />);
}
```

**src/farm.routes.tsx**

```tsx
import { createRoute, defer } from "@farm.js/core";
import { ProductPage } from "./features/products/page";

export const ProductRoute = createRoute("/products/[id]", {
  data: {
    async main({ params }) {
      const reviews = defer(getProductReviews(params.id));
      const product = await getProduct(params.id);

      return {
        product,
        reviews,
      };
    },
  },
  component: ProductPage,
});
```

In this example, both requests start together, but only `getProduct` controls when the route shell is ready. `getProductReviews` does not block the shell. The component receives `reviews` as `Deferred<Review[]>`, so React `use()` resolves it with full type inference.

`data.after` runs after `main` returns and receives the deferred promise without waiting for it. This keeps logging and request cleanup hooks from extending the stream; await a deferred field inside `after` only when that delay is intentional.

Farm uses a streaming page-data response for SPA navigation and serializes settled deferred values for hydration. Rejections expose a generic `DeferredDataError` to the browser while the original error remains in server logs. Deferred values and their resolved results must be JSON-serializable when they cross into a hydrated component.

Use `defer()` for independent secondary sections such as reviews, recommendations, activity, or analytics. Keep data required for the title, authorization decision, redirect, or primary above-the-fold content directly awaited in `main`. `defer()` is explicit: ordinary nested promises are not automatically treated as streamed route data.

## Typed Search Params

Programmatic routes can validate URL search params and define cleanup rules in one place. Use `search.schema` for typed route input, `stripDefaults` for clean URLs, `preserve` for params that should carry across links, and `temporary` for one-time UI params.

```tsx
import { createRoute } from "@farm.js/core";
import { z } from "zod";

export const ProductRoute = createRoute("/products/[id]", {
  search: {
    schema: z.object({
      tab: z.enum(["info", "reviews"]).default("info"),
      locale: z.string().default("en"),
      toast: z.string().optional(),
    }),
    stripDefaults: true,
    preserve: ["locale"],
    temporary: ["toast"],
  },

  data: {
    async main({ params, search }) {
      return {
        product: await getProduct(params.id),
        tab: search.tab,
      };
    },
  },

  component: ProductPage,
});
```

With that route, `/products/123?tab=info&locale=am&toast=saved` gives the component typed search data:

```ts
{
  tab: "info",
  locale: "am",
  toast: "saved",
}
```

After the route has consumed it, Farm can clean the URL to `/products/123?locale=am`. `tab=info` is removed because it matches the schema default, and `toast=saved` is removed because it is temporary.

`preserve` is used by Farm links. If the current page is `/products?locale=am`, then a link to `/products/[id]` carries `locale=am` unless the link already provides its own `locale`.

Use this for tab state, pagination defaults, locale/tenant preservation, preview mode, and one-time params such as `toast=saved`. Keep security-sensitive values out of search params; they are user-editable URL state, not trusted server state.

## Route context

Use `context` in `farm.config.ts` for request-scoped dependencies that guards and route data need: sessions, tenants, feature flags, or database clients. The value is available to programmatic route `guard`, `data.before`, `data.main`, cache key functions, and `data.after`.

```ts
import { defineConfig } from "@farm.js/core";
import { db } from "./src/db";
import { getSession } from "./src/session";

export default defineConfig({
  context: async ({ request }) => ({
    session: await getSession(request),
    db,
  }),
});
```

Add a module augmentation when you want autocomplete in route files:

```ts
import type { db } from "./src/db";
import type { getSession } from "./src/session";

declare module "@farm.js/core" {
  interface FarmAppContext {
    session: Awaited<ReturnType<typeof getSession>>;
    db: typeof db;
  }
}
```

Route context is server-only. Farm passes it to guards and data hooks without serializing it into browser props, so keep raw database clients and secrets in `context` and return only safe page data from `data.main`.

## Route guards

Use `guard` when a route should be allowed or blocked before route data loads. Guards run after params/search validation and before `data.before` or `data.main`.

```tsx
import { createRoute, redirect } from "@farm.js/core";

export const DashboardRoute = createRoute("/dashboard", {
  guard: async ({ context }) => {
    if (!context.session.user) {
      redirect("/login");
    }
  },

  data: {
    async main({ context }) {
      return { stats: await getDashboardStats(context.db) };
    },
  },

  component: DashboardPage,
});
```

Use `guard` for route flow: auth redirects, role gates, tenant checks, and early `notFound()` decisions. Use `data.before` when you want to prepare values that `data.main` needs. A guard is not a complete authorization boundary; repeat sensitive authorization inside API routes and server functions because those can be requested directly.

## Route UI states

Programmatic routes can define local `pending`, `error`, and `notFound` components. `pending` is used as the Suspense fallback while route data resolves. `error` handles guard/data errors. `notFound` handles `notFound()` thrown from guard or data hooks.

```tsx
import { notFound } from "@farm.js/core";

export const ProductRoute = createRoute("/products/[id]", {
  data: {
    async main({ params }) {
      const product = await getProduct(params.id);
      if (!product) notFound();
      return { product };
    },
  },

  pending: ProductSkeleton,
  error: ProductError,
  notFound: ProductNotFound,
  component: ProductPage,
});
```

Redirects are not rendered through `error`; they escape so Farm can return a real redirect response.

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

## Metadata And OG Images

Export `metadata` for static head tags or `generateMetadata` when the values depend on route params, search params, middleware data, or route data. Farm merges layout metadata from root to leaf, then applies the page metadata last.

**src/app/products/[id]/page.tsx**

```tsx
import type { PageProps } from "@farm.js/core";

export const metadata = {
  description: "Product details",
  openGraph: {
    siteName: "Acme",
    type: "website",
  },
};

export async function generateMetadata({ params }: PageProps) {
  const product = await getProduct(params.id);

  return {
    title: product.name,
    openGraph: {
      title: product.name,
      description: product.summary,
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
    },
  };
}

export default function ProductPage() {
  return <main>Product</main>;
}
```

### Favicons

Place favicon files in `public/`, then declare them through the root layout metadata. Files in `public/` are served from the application root, so `public/favicon.svg` is available at `/favicon.svg`.

**src/app/layout.tsx**

```tsx
import type { Metadata } from "@farm.js/core";

export const metadata: Metadata = {
  icons: "/favicon.svg",
};
```

Use the object form when you need multiple browser icons or an Apple touch icon:

```tsx
import type { Metadata } from "@farm.js/core";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};
```

Root layout metadata applies the favicon to every route. Nested layouts and pages can override individual icon entries through their own metadata. Do not render a `<link rel="icon">` element from the layout component; declaring `metadata.icons` lets Farm place the tags in the document head in both development and production.

### Static metadata images

Place `opengraph-image.png` next to a page or layout segment for a zero-code, route-local social image. Farm supports `.png`, `.jpg`, `.jpeg`, `.gif`, and `.webp` files.

```txt
src/app/
  opengraph-image.png
  products/
    opengraph-image.png
    [id]/
      page.tsx
```

The root image is the application fallback. `/products/opengraph-image.png` applies to product pages and their descendants, while unrelated routes continue using the root image. Farm automatically reads the image dimensions and content type.

Add accessible preview text with an optional sidecar file:

**src/app/products/opengraph-image.alt.txt**

```txt
Acme product catalog preview
```

Farm serves the file through the extensionless `/products/opengraph-image` endpoint and adds a content fingerprint to the URL emitted in page metadata. Fingerprinted requests receive immutable caching, while direct unversioned requests revalidate with an `ETag`.

Use `twitter-image.png` when X/Twitter needs a different image. Otherwise, social platforms can use the Open Graph image. An explicit `metadata.openGraph.images` or `metadata.twitter.images` value always wins over a matching file.

Static images inside a dynamic segment are shared by every concrete route. Use a generated image when the preview must depend on route params.

### Generated metadata images

Place `opengraph-image.tsx` or `twitter-image.tsx` next to a route segment when the image needs data or route params. Farm automatically adds the nearest matching image to the page head when `openGraph.images` or `twitter.images` is not already set.

**src/app/products/[id]/opengraph-image.tsx**

```tsx
import type { PageProps } from "@farm.js/core";

export const size = { width: 1200, height: 630 };
export const alt = "Product preview";
export const contentType = "image/svg+xml";

export default function ProductOpenGraphImage({ params }: PageProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="#111827" />
      <text x="80" y="340" fill="white" fontSize="72">
        Product {params.id}
      </text>
    </svg>
  );
}
```

For `/products/42`, this file is served at `/products/42/opengraph-image` and Farm emits `og:image`, `og:image:width`, `og:image:height`, and `og:image:alt` tags. The default return value can be a React SVG element, a string, bytes, or a `Response`.

Keep only one implementation for each image kind in a segment. For example, defining both `opengraph-image.png` and `opengraph-image.tsx` produces a build error. For broad social-platform compatibility, prefer a 1200 by 630 PNG or JPEG unless the image must be generated dynamically.

## File Route States

Use `loading.tsx` and `error.tsx` next to a file route to define route-local loading and error states. Farm picks the nearest matching boundary, so `src/app/dashboard/error.tsx` handles `/dashboard` and nested dashboard pages unless a deeper segment defines its own boundary.

```txt
src/app/
  dashboard/
    page.tsx
    loading.tsx
    error.tsx
```

**src/app/dashboard/loading.tsx**

```tsx
import type { LoadingProps } from "@farm.js/core";

export default function DashboardLoading(props: LoadingProps) {
  return <p>Loading {props.path}</p>;
}
```

`loading.tsx` is used as the Suspense fallback when the page or nested content suspends while rendering.

**src/app/dashboard/error.tsx**

```tsx
"use client";

import type { ErrorProps } from "@farm.js/core";

export default function DashboardError({ error, reset }: ErrorProps) {
  const message = error instanceof Error ? error.message : "Something went wrong";

  return (
    <section>
      <h2>Could not load dashboard</h2>
      <p>{message}</p>
      <button onClick={reset}>Try again</button>
    </section>
  );
}
```

`error.tsx` receives `error`, `reset`, `params`, `path`, `search`, `searchParams`, middleware data, and plugin context. The closest route error boundary handles normal render/data failures. Redirects and `notFound()` still escape to Farm's redirect and not-found handling.

## Catch-all routes

Catch-all routes are useful for docs, CMS content, and nested marketing pages where the page is resolved from content instead of a fixed file for every URL.

**src/app/docs/[...slug]/page.tsx**

```tsx
import type { PageProps } from "@farm.js/core";

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

## Pending Navigation UI

Use `useNavigation()` for global route-transition UI: top progress bars, disabled navigation buttons, optimistic shells, or app-wide busy indicators. It tracks SPA navigations started by `Link` and `navigateTo`.

```tsx
"use client";

import { useNavigation } from "@farm.js/core/client";

export function TopProgress() {
  const navigation = useNavigation();

  return <div data-pending={navigation.pending} aria-hidden={!navigation.pending} />;
}
```

`navigation.state` is `"loading"` while route data is being fetched and returns to `"idle"` after the route is committed. `navigation.to` includes the target `pathname`, `search`, `hash`, and full `href`. Use route `loading.tsx` for segment-level Suspense fallbacks, and `useNavigation()` when the surrounding app shell should react to a navigation.

## View Transitions

Pass `viewTransition` to `Link` or `navigateTo` when a navigation should use the browser View Transitions API. Farm starts the transition after route data is ready and falls back to normal SPA navigation when the browser does not support it.

```tsx
import { Link, navigateTo } from "@farm.js/core/client";

export function GalleryLink() {
  return (
    <Link href="/gallery" viewTransition>
      Gallery
    </Link>
  );
}

await navigateTo("/gallery", { viewTransition: true });
```

Use this for image galleries, dashboards that keep the same app shell, settings panes, and modal-to-page flows. Keep important loading states in `loading.tsx` or `useNavigation()`; view transitions are visual polish, not a loading boundary.

## Navigation workflow

1. Add or rename route files.
2. Keep `farm dev` running; Farm regenerates route and API types when route files change.
3. Use `Link` for internal navigation and plain anchors for external URLs.
4. Keep dynamic route values encoded in the href string, such as `/blog/${slug}`.

Run `farm generate` when you want to refresh generated types outside the dev server, such as in CI or after a large file move.
