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
- `not-found.*` renders when the route intentionally returns a 404.

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

Use `not-found.tsx` for segment-specific missing states. A docs page might show docs navigation, while an account page might link back to settings.

**src/app/docs/not-found.tsx**

```tsx
import { Link } from "@farm.js/core/client";

export default function DocsNotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <Link href="/docs">Back to docs</Link>
    </main>
  );
}
```

## Design guidance

- Put global providers in the root layout.
- Put product area navigation in nested layouts.
- Keep route boundaries close to the route that owns the failure or loading state.
- Avoid fetching highly specific page data in a parent layout unless every child needs it.
