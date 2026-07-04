---
title: "Layouts and Route Boundaries"
description: "Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX."
section: "Core"
---

# Layouts and Route Boundaries

Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX.

## Root layout

**src/app/layout.tsx**

```tsx
import type { LayoutProps } from "@farmjs/core";
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
import type { LayoutProps } from "@farmjs/core";

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

- loading.tsx provides pending UI for a route segment.
- error.tsx catches render failures in that segment.
- not-found.tsx renders when the route intentionally returns a 404.
