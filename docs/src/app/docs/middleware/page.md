---
title: "Middleware"
description: "Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses."
section: "Core"
---

# Middleware

Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.

## Runtime behavior

Farm runs middleware in development and production builds. For every request, Farm finds matching `farm.config.ts` middleware entries first, then matching `src/app/**/middleware.ts` files from the root segment down to the route segment.

The chain stops when a middleware handler returns a Web `Response` or uses a short-circuit helper such as `ctx.redirect()`. Default Farm handlers call `await next()` to continue. A named request-first handler continues automatically when it returns `undefined`.

Data and headers written during middleware are request-scoped:

| API                                                                  | Result                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ctx.data.set(key, value)` or `context.data.set(key, value)`         | Passes serializable, client-safe data to later middleware and page props.                     |
| `ctx.locals.set(key, value)` or `context.set(key, value)`            | Passes server-only context to later middleware, layouts, pages, and nested Server Components. |
| `ctx.headers.set(name, value)` or `context.headers.set(name, value)` | Adds headers to the final response.                                                           |
| `ctx.cookies.get(name)`                                              | Reads decoded request cookies, including valid empty values.                                  |
| `ctx.params` or `context.params`                                     | Contains params from the matched config matcher or route-scoped middleware path.              |
| `return new Response(...)`                                           | Stops the chain and sends that response immediately.                                          |

## Route middleware

Middleware can live near the routes it protects. Use it for auth, request metadata, A/B flags, rate limit checks, or headers that belong to an area of the app.
Route-group directories such as `(marketing)` organize middleware without adding a URL segment.

**src/app/dashboard/middleware.ts**

```ts
import { middleware } from "@farm.js/core/middleware";

export default middleware().use(async (ctx, next) => {
  ctx.data.set("request.startedAt", Date.now());
  await next();
});
```

### Request-first named export

Farm also supports the request-first named export style familiar from Next middleware. It receives a Web `Request` plus a Farm context, does not need a wrapper, and continues automatically unless it returns a `Response` or uses a response helper.

**src/app/dashboard/middleware.ts**

```ts
import type { RequestMiddlewareContext } from "@farm.js/core/middleware";
import { getSession } from "../../session";

export interface DashboardMiddlewareContext {
  session: Awaited<ReturnType<typeof getSession>>;
}

export const config = {
  matcher: "/dashboard/:path*",
};

export async function middleware(
  request: Request,
  context: RequestMiddlewareContext<DashboardMiddlewareContext>,
) {
  const session = await getSession(request);

  if (!session.user) {
    return Response.redirect(new URL("/sign-in", request.url));
  }

  context.set("session", session);
  context.headers.set("x-request-area", "dashboard");
}
```

Use either a default Farm handler or a named `middleware` export in one file, not both. The exported `config.matcher` uses the same matcher syntax as config middleware.

### Server Component context

Values written with `context.set()` are request-scoped and server-only. A sibling page, layout, loading state, error state, or nested Server Component can read them without prop drilling.

**src/app/dashboard/user-menu.tsx**

```tsx
import { getMiddlewareContext } from "@farm.js/core/middleware";
import type { DashboardMiddlewareContext } from "./middleware";

export function UserMenu() {
  const context = getMiddlewareContext<DashboardMiddlewareContext>();
  const session = context.get("session");

  return <span>{session?.user.name}</span>;
}
```

The legacy chain style can write to the same store with `ctx.locals.set("session", session)`. Nested middleware inherits the parent context, and concurrent requests receive isolated stores.

Keep the two data channels distinct:

| Channel                                 | Read in a Server Component                       | Browser visibility                | Good values                                          |
| --------------------------------------- | ------------------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| `context.set()` / `ctx.locals.set()`    | `getMiddlewareContext()`                         | Never added to hydration props    | Full sessions, service clients, authorization state  |
| `context.data.set()` / `ctx.data.set()` | `getMiddlewareData()` or `props.middleware.data` | Can be serialized with page props | Request IDs, safe user display fields, feature flags |

Dynamic route segments from the middleware file path are available on `ctx.params`.

**src/app/users/[id]/middleware.ts**

```ts
import { middleware } from "@farm.js/core/middleware";

export default middleware().use(async (ctx, next) => {
  ctx.data.set("user.id", ctx.params.id);
  await next();
});
```

## Config middleware

Use farm.config.ts when middleware behavior should be described globally. This is useful for cross-cutting behavior that should be visible from the project control plane, while route middleware files can stay close to the pages or API routes they protect.

Config middleware supports matcher-only gates and handler entries. A matcher can be a single matcher or a list of matchers. When a matcher meets the request path, Farm calls that entry's handler.

| Shape                                | Behavior                                                               |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `middleware: { matcher }`            | Acts as a global gate for discovered `src/app/**/middleware.ts` files. |
| `middleware: [{ matcher, handler }]` | Runs config-defined handlers when the matcher meets the request path.  |

Config-defined handlers run before discovered route middleware. Data placed in `ctx.data` is passed to later middleware files and then to page rendering.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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

Multiple config middleware entries can match the same request. They run in array order before file middleware.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  middleware: [
    {
      matcher: ["/dashboard/:path*", "/account/:path*"],
      async handler(ctx, next) {
        ctx.data.set("area", "private");
        await next();
      },
    },
    {
      matcher: "/dashboard/reports/:path*",
      async handler(ctx, next) {
        ctx.data.set("reports", true);
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
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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
import { middleware } from "@farm.js/core/middleware";

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
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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

Middleware handlers can also return a Web `Response`. Returned responses stop the middleware chain and are sent directly.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  middleware: [
    {
      matcher: "/dashboard/:path*",
      handler(ctx) {
        return Response.redirect(new URL("/sign-in", ctx.url));
      },
    },
  ],
});
```

This works from route-scoped middleware too.

**src/app/dashboard/middleware.ts**

```ts
export default async function dashboardMiddleware(ctx: any, next: () => Promise<void>) {
  const session = await readSession(ctx.request);

  if (!session) {
    return Response.redirect(new URL("/sign-in", ctx.url));
  }

  await next();
}
```

**src/app/dashboard/page.tsx**

```tsx
import type { PageProps } from "@farm.js/core";

export default function DashboardPage(props: PageProps) {
  const userId = props.middleware?.data.get("user.id");
  return <main>User {userId}</main>;
}
```

## Observability events

Middleware emits observability events in development and production. Subscribe with `observability.onEvent` in `farm.config.ts` or `onFarmEvent` from `@farm.js/core/observability`.

| Event                     | Emitted when                                                   | Useful fields                             |
| ------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `middleware.start`        | A matching middleware handler starts.                          | `route`, `pathname`, `name`               |
| `middleware.complete`     | A handler calls through and completes.                         | `route`, `pathname`, `name`, `durationMs` |
| `middleware.shortCircuit` | A handler returns or creates a response before the route runs. | `route`, `pathname`, `name`, `status`     |
| `middleware.error`        | A handler throws.                                              | `route`, `pathname`, `name`, `error`      |

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  observability: {
    onEvent(event) {
      if (event.type.startsWith("middleware.")) {
        console.log(event.type, event.pathname, event.name);
      }
    },
  },
});
```

See `/docs/observability` for the full event model.

## Test fixture pattern

The production middleware runtime is easiest to verify with a tiny app fixture that builds the app, imports the generated server entry, and sends real `Request` objects through it. A complete fixture should cover:

| Behavior          | What to assert                                                 |
| ----------------- | -------------------------------------------------------------- |
| Config middleware | A `farm.config.ts` matcher runs and writes `ctx.data`.         |
| File middleware   | A `src/app/**/middleware.ts` file runs for its route area.     |
| Short-circuiting  | A returned `Response` status, body, and headers are preserved. |
| Data passing      | Page props include values written to `ctx.data`.               |
| Route params      | Dynamic file middleware sees values such as `ctx.params.id`.   |
| Events            | The expected `middleware.*` events are emitted in order.       |

Farm's own test suite keeps this as a reusable helper at `packages/farm/src/__tests__/fixtures/middleware-production-fixture.ts`.

## Common uses

| Use case        | Pattern                                                        |
| --------------- | -------------------------------------------------------------- |
| Auth            | Redirect signed-out users or return `401` for private APIs.    |
| Request context | Attach request IDs, user IDs, tenant IDs, and feature flags.   |
| Security        | Add headers, block invalid origins, or rate-limit an API area. |
| Localization    | Rewrite to a locale route or expose locale data to pages.      |

## Production notes

- `farm.config.ts` middleware and `src/app/**/middleware.ts` files both run in production builds.
- Request-first named exports and default Farm handlers use the same matcher, cascading, response, and production runtime.
- Responses that depend on middleware data or server context are marked private and bypass PPR shell caching.
- Keep secrets server-only inside middleware.
- Put secrets and non-serializable dependencies in server context; expose only safe page data through `ctx.data` or `context.data`.
- Middleware is useful for early redirects, but API handlers and server functions must still enforce their own authorization.
- Prefer integration middleware when a provider owns the behavior, such as auth or API key checks.
- Keep middleware fast because it runs before the route can render.
