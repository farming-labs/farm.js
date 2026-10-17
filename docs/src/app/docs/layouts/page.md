---
title: "Layouts and Route Boundaries"
description: "Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX."
section: "Core"
---

# Layouts and Route Boundaries

Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX.

The examples below use the default React renderer. Preact and Solid use the equivalent `.tsx` files,
Vue uses `.vue` files and exposes layout children through `<slot />`, and Svelte uses `.svelte` files
with a `children` snippet. See [Renderers](/docs/renderers) for renderer-specific conventions.

## Root layout

Farm owns the document shell; return application UI or a fragment from a root layout.
The compatibility path for existing full-document layouts preserves Unicode content and
React Suspense reveal payloads in both development and production.

**src/app/layout.tsx**

```tsx
import type { LayoutProps } from "@farm.js/core";
import "./globals.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <main>
      <nav>Farm app</nav>
      {children}
    </main>
  );
}
```

## Nested layouts

A layout file wraps every page below its folder. Use this for dashboards, docs, account settings, or any area with shared navigation and chrome.

With experimental React Server Components enabled, layouts compose in the same order: the root layout wraps the nested layout, which wraps the page. Adding a dashboard layout does not remove the root navigation or its Client Component providers. Layouts receive `children` and the matched `params`, following `LayoutProps`; server-only layouts do not require client hydration just because they wrap interactive children.

**src/app/dashboard/layout.tsx**

```tsx
import type { LayoutProps } from "@farm.js/core";

export default function DashboardLayout({ children }: LayoutProps) {
  return (
    <div className="dashboard">
      <aside>Navigation</aside>
      <section>{children}</section>
    </div>
  );
}
```

## Route boundaries

- `loading.*` provides pending UI for a route segment.
- `error.*` catches render failures in that segment.
- `not-found.*` at the root of `src/app` renders when a route calls `notFound()` or no route matches.

The extension follows the selected renderer: `.tsx`/`.jsx` for React, Preact, or Solid, `.vue` for
Vue, and `.svelte` for Svelte.

## Loading UI

Use `loading.tsx` when a segment can suspend during data loading. Farm can render the route shell while the segment waits, which pairs well with PPR pages.

**src/app/dashboard/loading.tsx**

```tsx
export default function DashboardLoading() {
  return <div aria-busy="true">Loading dashboard...</div>;
}
```

## Error UI

Error boundaries should be client components because they need to recover in the browser.

**src/app/dashboard/error.tsx**

```tsx
"use client";

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section>
      <h2>Dashboard failed to load</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </section>
  );
}
```

## Not found UI

Add `not-found.tsx` at the root of `src/app` to replace Farm's built-in 404 page. It renders inside
the root layout for `notFound()` calls and for URLs that match no route. Farm reads only the root
file; a `not-found.tsx` inside a nested folder is ignored.

**src/app/not-found.tsx**

```tsx
import { Link } from "@farm.js/core/client";

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <Link href="/">Back home</Link>
    </main>
  );
}
```

For a URL that matches no route, the 404 document takes its title and meta tags from the root layout's metadata, so a title template and description carry over. It is titled `404 - Page Not Found` unless the root `not-found` file exports its own `metadata` (or `generateMetadata`):

**src/app/not-found.tsx**

```tsx
// With a root layout title template of "%s | Acme", the tab reads "Page not found | Acme".
export const metadata = { title: "Page not found" };
```

## Design guidance

- Put global providers in the root layout.
- Put product area navigation in nested layouts.
- Keep route boundaries close to the route that owns the failure or loading state.
- Avoid fetching highly specific page data in a parent layout unless every child needs it.
