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

## Config middleware

Use farm.config.ts when middleware behavior should be described globally. This is useful for cross-cutting behavior that should be visible from the project control plane, while route middleware files can stay close to the pages or API routes they protect.

Config middleware supports two shapes:

| Shape                                | Behavior                                                               |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `middleware: { matcher }`            | Acts as a global gate for discovered `src/app/**/middleware.ts` files. |
| `middleware: [{ matcher, handler }]` | Runs config-defined handlers when the matcher meets the request path.  |

Config-defined handlers run before discovered route middleware. Data placed in `ctx.data` is passed to later middleware files and then to page rendering.

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

## Matcher syntax

Matchers can be strings, regular expressions, or functions. String matchers support the common route patterns used by Farm:

| Pattern                | Matches                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `/dashboard/:path*`    | `/dashboard`, `/dashboard/settings`, `/dashboard/reports/weekly` |
| `/dashboard/[section]` | `/dashboard/settings` with `ctx.params.section === "settings"`   |
| `/docs/[...slug]`      | `/docs`, `/docs/getting-started`, nested docs paths              |
| `/api/**`              | Every nested path below `/api`                                   |
| `/api/*`               | One segment below `/api`                                         |
| `/auth(.*)`            | `/auth` and nested auth paths                                    |

When a matcher has params, the handler can read them from `ctx.params`.

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  middleware: [
    {
      matcher: "/dashboard/:path*",
      async handler(ctx, next) {
        ctx.data.set("dashboard.path", ctx.params.path ?? "");
        await next();
      },
    },
  ],
});
```

## Matcher-only gates

Use a matcher-only config when you want every discovered middleware file to run only inside a route area.

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  middleware: {
    matcher: "/dashboard/:path*",
  },
});
```

With that config, `src/app/middleware.ts` and nested middleware files are skipped for `/marketing`, but can run for `/dashboard` and `/dashboard/settings`.

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

The same protection can live in config when the rule should be managed globally.

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  middleware: [
    {
      matcher: "/dashboard/:path*",
      async handler(ctx, next) {
        const session = await readSession(ctx.request);

        if (!session) {
          ctx.redirect("/sign-in");
          return;
        }

        ctx.data.set("user.id", session.user.id);
        await next();
      },
    },
  ],
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
