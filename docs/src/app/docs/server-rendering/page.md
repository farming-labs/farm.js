---
title: "Rendering Model"
description: "Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config."
section: "Core"
---

# Rendering Model

Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.

Rendering controls decide when HTML is produced. [Route Runtime](/docs/route-runtime) separately decides where a dynamic page or API handler executes and how deployment limits are applied.

## Rendering options

| Mode    | How to opt in                                  | Best for                                |
| ------- | ---------------------------------------------- | --------------------------------------- |
| Dynamic | Default for request-bound pages                | Dashboards and personalized UI.         |
| Static  | dynamic = force-static or use static directive | Marketing pages and stable docs.        |
| ISR     | revalidate = seconds                           | Content that can refresh on a schedule. |
| PPR     | experimental_ppr = true                        | Static shells with dynamic holes.       |

## Route-level config

**src/app/pricing/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 300;

export default async function PricingPage() {
  return <main>Pricing</main>;
}
```

## Use directives when compactness wins

Farm also recognizes compact rendering directives at the top of route modules. This keeps small examples readable while preserving explicit exports for Next-style compatibility.

**src/app/blog/page.tsx**

```tsx
"use ssg; 60";

export default function BlogPage() {
  return <main>Blog</main>;
}
```

`use ssg; 60` statically generates the route and revalidates it every 60 seconds. Farm also accepts
`use ssg`, `use dynamic`, and `use ppr; 60` when those rendering modes fit the route.

## Dynamic rendering

Use dynamic rendering for request-specific pages such as dashboards, account settings, and pages that depend on cookies, headers, or per-user data.

**src/app/dashboard/page.tsx**

```tsx
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <main>Dashboard</main>;
}
```

## Static rendering

Use static rendering for pages that can be built once and served quickly.

**src/app/about/page.tsx**

```tsx
export const dynamic = "force-static";

export default function AboutPage() {
  return <main>About Farm</main>;
}
```

## ISR-style revalidation

`revalidate` caches a static response and refreshes it after the configured number of seconds.

**src/app/pricing/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 300;

export default async function PricingPage() {
  const plans = await loadPlans();
  return <PricingTable plans={plans} />;
}
```

## PPR with Suspense

PPR is for pages with a stable shell and dynamic sections. Put dynamic work behind Suspense boundaries so the shell can be cached while the slower section resolves independently.

**src/app/dashboard/page.tsx**

```tsx
import { Suspense } from "react";

export const experimental_ppr = true;
export const revalidate = 60;

export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<RevenueSkeleton />}>
        <RevenuePanel />
      </Suspense>
    </main>
  );
}
```

## Automatic optimized boundaries

Farm can experimentally render large, non-interactive Server Component regions through the native
Strata renderer. Enable the flag once in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
    optimizedBoundary: true,
  },
});
```

Application components remain ordinary JSX:

```tsx
export default function ArticlePage() {
  return (
    <article className="prose">
      <h1>Representation-aware rendering</h1>
      <p>Farm selects this host-only region automatically.</p>
    </article>
  );
}
```

Farm evaluates eligible host-element trees on the server and uses Strata only when the region is
large enough to benefit. Trees containing Client Components, event handlers, refs, unsupported
elements or attributes, unsafe URLs, or other uncertain values retain normal React rendering. The
flag does not require an application boundary component or a direct Strata dependency.

The current Strata runtime uses a native Node binding. Keep this experiment on Node deployments until
a Wasm or JavaScript fallback is available for edge and Cloudflare worker targets.

## Choosing a mode

| Need                                   | Use                                     |
| -------------------------------------- | --------------------------------------- |
| User-specific data on every request    | `dynamic = "force-dynamic"`             |
| Stable docs, marketing, or policy page | `dynamic = "force-static"`              |
| Stable page with scheduled refresh     | `revalidate = 60`                       |
| Static shell plus dynamic holes        | `experimental_ppr = true` with Suspense |
