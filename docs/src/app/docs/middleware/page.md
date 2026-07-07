---
title: "Middleware"
description: "Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses."
section: "Core"
---

# Middleware

Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.

## Route middleware

Middleware can live near the routes it protects. Use it for auth, request metadata, A/B flags, rate limit checks, or headers that belong to an area of the app.

**src/app/dashboard/middleware.ts**

```ts
import { middleware } from "@farmjs/core/middleware";

export default middleware().use(async (ctx, next) => {
  ctx.data.set("request.startedAt", Date.now());
  await next();
});
```

## Config matchers

Use farm.config.ts when middleware behavior should be described globally. A matcher-only object gates discovered middleware files; a list of entries can pair matchers with handlers.

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  middleware: [
    {
      matcher: ["/dashboard/:path*"],
      async handler(ctx, next) {
        ctx.data.set("area", "dashboard");
        await next();
      },
    },
  ],
});
```

## Protect a route area

Middleware can short-circuit with a redirect or response before the page/API handler runs.

**src/app/dashboard/middleware.ts**

```ts
import { middleware } from "@farmjs/core/middleware";

export default middleware().use(async (ctx, next) => {
  const session = await readSession(ctx.request);

  if (!session) {
    ctx.redirect("/sign-in");
    return;
  }

  ctx.data.set("user.id", session.user.id);

  await next();
});
```

**src/app/dashboard/page.tsx**

```tsx
import type { PageProps } from "@farmjs/core";

export default function DashboardPage(props: PageProps) {
  const userId = props.middleware?.data.get("user.id");
  return <main>User {userId}</main>;
}
```

## Common uses

| Use case        | Pattern                                                        |
| --------------- | -------------------------------------------------------------- |
| Auth            | Redirect signed-out users or return `401` for private APIs.    |
| Request context | Attach request IDs, user IDs, tenant IDs, and feature flags.   |
| Security        | Add headers, block invalid origins, or rate-limit an API area. |
| Localization    | Rewrite to a locale route or expose locale data to pages.      |

## Production notes

- Keep secrets server-only inside middleware.
- Expose only the page data the route actually needs.
- Prefer integration middleware when a provider owns the behavior, such as auth or API key checks.
- Keep middleware fast because it runs before the route can render.
