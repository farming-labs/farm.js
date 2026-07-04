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
