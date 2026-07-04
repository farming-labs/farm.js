---
title: "Rendering Model"
description: "Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config."
section: "Core"
---

# Rendering Model

Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.

## Rendering options

| Mode | How to opt in | Best for |
| --- | --- | --- |
| Dynamic | Default for request-bound pages | Dashboards and personalized UI. |
| Static | dynamic = force-static or use static directive | Marketing pages and stable docs. |
| ISR | revalidate = seconds | Content that can refresh on a schedule. |
| PPR | experimental_ppr = true | Static shells with dynamic holes. |

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
"use ppr: 60";

export default function BlogPage() {
  return <main>Blog</main>;
}
```
