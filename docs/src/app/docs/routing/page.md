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
2. Run `farm generate` when you want type updates immediately.
3. Use `Link` for internal navigation and plain anchors for external URLs.
4. Keep dynamic route values encoded in the href string, such as `/blog/${slug}`.
