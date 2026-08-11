---
title: "Rendering Model"
description: "Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config."
section: "Core"
---

# Rendering Model

Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.

Rendering controls decide when HTML is produced. [Route Runtime](/docs/route-runtime) separately decides where a dynamic page or API handler executes and how deployment limits are applied.

Dynamic rendering, static rendering, and revalidation apply to every renderer. The component
examples below use React; see [Renderers](/docs/renderers) for Solid and Vue conventions and the
features that remain React-specific.

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

During a production build, Farm also scans routes that use the default dynamic mode. If a
non-parameterized route does not read cookies, headers, authentication, search parameters, or
middleware request data, Farm reports it as a static-rendering candidate. The build keeps the route
dynamic until you opt in, because request-bound work may be hidden in an imported component or data
loader.

Review each suggestion, including its imported code, then add the static export when it is safe. This
keeps personalized pages dynamic while making stable pages easy to move onto the fastest rendering
and caching path.

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

## Deferred route islands

The route-level hydration strategy is shared by renderer adapters. The current nested Client
Component analysis described below is React-specific; Solid and Vue currently hydrate at the route
boundary selected by their adapter.

Client routes and server routes that import a client boundary can defer their JavaScript while Farm
keeps the server-rendered HTML visible. Add an optional static `island` export to the client module:

```tsx
"use client";

export const island = "interaction";

export function CopyButton({ value }: { value: string }) {
  return <button onClick={() => navigator.clipboard.writeText(value)}>Copy</button>;
}
```

Farm propagates the strategy to the route hydration boundary, emits it in the route manifest, and
splits production route modules behind dynamic imports. Deferred routes therefore avoid evaluating
their route chunk until its trigger while preserving the initial SSR output.

These strategies control hydration of the initial server-rendered document. During client-side
navigation, the navigation itself signals user intent, so Farm loads and renders the destination
route immediately instead of leaving the previous route visible while waiting for another trigger.

| Strategy      | Hydration trigger                                                     |
| ------------- | --------------------------------------------------------------------- |
| `load`        | Immediately. This is the default and compatibility-first behavior.    |
| `interaction` | The first button-like click; Farm replays that click after hydration. |
| `visible`     | When the route boundary approaches the viewport.                      |
| `idle`        | During browser idle time, with a timeout fallback.                    |

The export must be one of these static string literals so Farm can analyze it without executing
application code. Without an explicit route-level `island` export, a route that imports client
boundaries with different strategies safely falls back to `load` because its current route-level
React root cannot schedule those children independently. Keep interactive leaves small today; a
future compiler boundary can reuse the same export for independently hydrated nested component
islands.

### Async pages stay server-only

React cannot hydrate an `async` component in the browser. When a page's default export is `async`
and it imports client components (or exports `hydrate = true`), Farm keeps the route
server-rendered instead of hydrating it: the SSR HTML stays visible, but the imported client
components are not interactive on that route. Farm logs a warning pointing at the module when this
happens. To make the interactivity work, fetch data in a synchronous page (for example through a
route loader) and render the `"use client"` component from there, or enable experimental server
components support.

## Automatic optimized boundaries

Automatic optimized boundaries are a React-only experiment and are not applied to Solid or Vue
routes.

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
