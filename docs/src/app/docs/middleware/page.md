---
title: "Middleware"
description: "Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses."
section: "Core"
---

# Middleware

Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.

## Runtime behavior

Farm runs middleware in development and production builds. For every request, Farm finds matching `farm.config.ts` middleware entries first, then matching `src/app/**/middleware.ts` files from the root segment down to the route segment.

Files in `public/` are served as static assets before any middleware or plugin runtime hook runs, so a guard never sees them. Serve a file that needs protection from an API route or page instead. A `GET` or `HEAD` for a public directory gets its `index.html` (`public/guide/index.html` answers `/guide` and `/guide/`); other methods reach middleware and routing like any path.

Apps on the RSC pipeline (`experimental.serverComponents: { mode: "rsc" }`) run both middleware forms through the same request
pipeline. Farm extracts an explicit `middleware` property, from `farm.config.ts` or from
`defineConfig` from `@farm.js/plugin/rsc` in `vite.config.ts`, and the imports and local bindings it
references into a server-only RSC module. This preserves handler closures, regular-expression
matchers, and function matchers without shipping unrelated build plugins or integrations. Config
middleware still runs before matching `src/app/**/middleware.ts` files. RSC pages answer below a
`basePath` or locale prefix at their route path, as in other Farm apps, and pages nested in
`src/app/<basePath>/` or `src/app/[lang]/` keep answering at the path as received
([precedence](/docs/server-rendering#react-server-components)); middleware matching either path
runs for them. Farm reports an error for a dynamic config shape or a
spread that makes the middleware value ambiguous; declare the property directly or move that
middleware to `src/app/**/middleware.ts`.

In development, a middleware edit is activated only after the complete middleware tree loads
successfully. A syntax or import error is reported through Vite while the last valid tree remains
active, so a broken hot update cannot silently remove authentication or other request guards.

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

Cookies set by multiple matching middleware handlers are accumulated into separate `Set-Cookie`
headers. They are also preserved when the short-circuiting `Response` supplies its own cookies, so
a returned response does not replace cookies already written through `ctx.cookies`.

A middleware handler that throws (other than `redirect()` or `notFound()`) fails the request. In a
production build outside the RSC pipeline, a request under the API base path, or
any request in a `renderer: false` app, gets the JSON `500` a throwing API route gets. A page request gets the root `error.*` boundary
inside the root layouts, or Farm's default error page, as a page that throws does, and a request
for Markdown gets that document as Markdown. These responses are `private, no-store`, carry your
`headers()` config but not headers the failed middleware run set, and Farm adds no error message
or stack to them. As for a throwing API route, the error reaches the `middleware.error` event,
plugin `runtime.error` hooks, and `onError` hooks with `phase: "runtime"`, and every
`runtime.after` hook then sees the `500`. Development answers the same `private, no-store` JSON
`500` under the API base path, and shows the error overlay for a page instead, also a
`private, no-store` HTML `500`. Neither keeps a header or cookie the failed run set, and the hooks
run the same way for both.

## Route middleware

Middleware can live near the routes it protects. Use it for auth, request metadata, A/B flags, rate limit checks, or headers that belong to an area of the app.
Route-group directories such as `(marketing)` organize middleware without adding a URL segment.
Middleware in sibling groups and in the folder above them all run, the shallower folder first:
`src/app/middleware.ts`, then `src/app/(app)/middleware.ts`, then `src/app/(site)/middleware.ts`.
Parallel route slots work the same way: `src/app/dashboard/@team/middleware.ts` runs for
`/dashboard` and the URLs below it, because that is where the slot renders. It guards the whole
request, not only the slot.

An intercepting folder guards the URL it intercepts: `src/app/feed/@modal/(.)photo/middleware.ts`
runs for `/feed/photo` and below, the same URLs as `src/app/feed/photo/middleware.ts`. A
`src/app/_private/page.tsx` is routed at `/_private`, so `src/app/_private/middleware.ts` guards it.
Middleware in a dot-prefixed folder never runs.

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

`redirect()`, `permanentRedirect()`, and `notFound()` from `@farm.js/core/navigation` also work in
middleware: Farm answers with the redirect, or with a `404` and the app's `not-found.tsx` (Farm's
built-in page when there is none), without running the page. The redirect target is sent as
written, like `ctx.redirect()`.

Use either a default Farm handler or a named `middleware` export in one file, not both. The exported `config.matcher` uses the same matcher syntax as config middleware.
The request uses the standard Web body APIs in both development and production, so named
middleware can call `request.json()`, `request.text()`, or `request.formData()` when the request
method permits a body.

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

`ctx.rewrite(url)` does not skip the target's guards. After the middleware matching the requested
path has run, the config and file middleware matching the rewritten path runs too, as it would for a
direct request. Integration guards, such as an auth integration's `protectedRoutes`, run for the
rewritten path too. Each middleware runs at most once per request, so repeated rewrites cannot loop.

A configured [`rewrites()`](/docs/configuration#route-rules) entry is applied before middleware, so
only the middleware matching its destination runs, in development and production. Configured
`redirects()` answer before middleware runs.

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
| `/team/:id?`           | `/team` and `/team/42`, but not `/team/42/edit`                  |
| `/docs/[...slug]`      | `/docs`, `/docs/getting-started`, nested docs paths              |
| `/docs/[[...slug]]`    | `/docs`, `/docs/getting-started`, nested docs paths              |
| `/api/**`              | Every nested path below `/api`                                   |
| `/api/*`               | One segment below `/api`                                         |
| `/admin*`              | `/admin`, `/admin-panel`, but not `/admin/users`                 |
| `/auth(.*)`            | `/auth` and nested auth paths                                    |

String matchers are not regular expressions. A string that uses other
regular-expression syntax, such as the Next.js-style
`/((?!api|_next/static|_next/image|favicon.ico).*)` or `/(api|trpc)(.*)`, a
`.*` such as `/admin/.*`, or a param after literal text such as `/user-:id`, fails
when Farm loads the middleware (`farm dev`, `farm build`, and server startup)
instead of silently matching nothing. Pass a `RegExp` for those cases:

```ts
export const config = {
  matcher: [/^\/(?!api|_next\/static|_next\/image|favicon\.ico).*/, "/api/:path*"],
};
```

Matchers are compared against the same pathname the router resolves the request
to: each segment is decoded once, so `/%64ashboard` meets a `/dashboard` matcher
exactly like `/dashboard` does. This is what makes a matcher safe to gate access
with. An encoded slash stays inside its own segment, so `%2F` never splits one
segment into two and reaches `ctx.params` still encoded.

A trailing slash is equivalent too: the router serves `/api/admin/users/` from the
same handler as `/api/admin/users`, so a `/api/admin/users` matcher runs for both.
`exclude` patterns stay exact, so a trailing slash can add a guard but never skip one.

A static page prerenders unless some middleware may run for it. For a middleware file that is a
folder above the page whose `config` has no literal `matcher` (or `exclude`) leaving the page out:
`export const config = { matcher: "/api/:path*" }` in `src/app/middleware.ts` keeps `/about`
prerendered. A matcher Farm cannot read at build time (a function, or a value built at runtime)
counts as matching every path.

That pathname is relative to the app's `basePath`. With `basePath: "/console"`, a request for
`/console/dashboard` meets a `/dashboard` matcher and runs `src/app/dashboard/middleware.ts`;
leave the base path out of matchers.

`ctx.routePathname` is that pathname: decoded once, without the base path or locale prefix, and
updated by `ctx.rewrite()`. `ctx.pathname` stays the request path as it arrived, still encoded and
still carrying both. Compare `ctx.routePathname` in function matchers and `.when()` conditions:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  middleware: [
    {
      matcher: (ctx) => ctx.routePathname.startsWith("/api/admin"),
      handler(ctx) {
        ctx.json({ error: "Unauthorized" }, 401);
      },
    },
  ],
});
```

A function matcher or `.when()` condition that reads `ctx.pathname` is also checked against the
route pathname, and the middleware runs when either check passes, so `/%61pi/admin` and
`/console/api/admin` cannot skip a guard written for `/api/admin`. Keep these predicates free of side
effects; Farm may call them more than once per request.

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

## Edge middleware on Vercel

A static page that middleware guards renders on request, because a platform serves static files
before any middleware runs. On Vercel, a middleware file can run in front of the static files
instead: set `runtime: "edge"` in its `config`.

**src/app/docs/middleware.ts**

```ts
export const config = { runtime: "edge" };

export function middleware(request: Request) {
  if (!request.headers.get("cookie")?.includes("session=")) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}
```

With `deploy.target: "vercel"`, `farm build` then:

- prerenders each static page, and each [`docs.prerender`](/docs/docs-engine#prerender-docs-pages)
  page, that only `runtime: "edge"` middleware guards, without running that middleware for the
  build's own request;
- bundles the middleware that guards those pages into an Edge function, and adds a route that runs
  it before Vercel serves each page's file (`/docs/guide`, `/docs/guide/`, `/docs/guide/index.html`,
  and the same paths under a `basePath`);
- sends those pages with `Cache-Control: private, no-store`.

The middleware decides each request as it does in the server: a returned `Response`, `redirect()`,
or `ctx.headers` work the same way, `ctx.rewrite()` routes to the new path, and `notFound()` answers
with the app's not-found page. A middleware that throws answers `500` instead of the page. Dynamic
routes, API routes, and pages any other middleware guards keep running the same middleware in the
server function.

Each guarded page view still runs the middleware, which Vercel bills as compute, but the page is
served from the CDN instead of rendered by the server function.

The literal value counts, as for `matcher`: `runtime: "edge"` must be written in the `config`
object itself. Config middleware in `farm.config.ts` and integration guards such as
`protectedRoutes` stay in the server, and pages they guard render on request. Other targets ignore
`runtime: "edge"`: the middleware runs in the server and its pages render on request.

Vercel's Edge runtime provides web APIs and only the `async_hooks`, `events`, `buffer`, `assert`, and
`util` Node modules. The build stops and names the import when edge middleware, or code it imports,
uses another Node module, so check a session with a cookie, a signed token, or `fetch` rather than a
database driver. The gzipped function must fit Vercel's Edge size limit (1 MB on Hobby); the build
warns when it does not.

## Caching

A CDN serves its copy of a page without running middleware, so Farm treats every middleware that
matched a request as a possible guard: in production its response is sent with
`Cache-Control: private, no-store` instead of the page's shared policy (`s-maxage`, a CDN
directive, or a Nitro `swr` rule's header). This applies to config middleware, middleware files
(including a root `src/app/middleware.ts`), and integration guards such as `protectedRoutes`. An
`@farm.js/plugin/rsc` app applies the same rule to its config and file middleware. Responses the
middleware returns itself keep their own headers.

Set `cache: "public"` on middleware that never decides who may read a response, such as logging or
headers, to keep the route's shared caching:

```ts
// farm.config.ts
middleware: [
  {
    matcher: "/:path*",
    cache: "public",
    handler(ctx) {
      ctx.headers.set("x-request-id", crypto.randomUUID());
    },
  },
];
```

```ts
// src/app/middleware.ts
export const config = { cache: "public" };
```

A response is shareable again only when every middleware that matched it declares
`cache: "public"`. A shared cache answers later visitors without running it, so never set it on
an IP allowlist, API key check, or other guard. See [Responses behind middleware](/docs/cache-ppr#responses-behind-middleware).

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
- A response any middleware let through is sent with `Cache-Control: private, no-store`, so a CDN never serves a guarded page to another visitor. Middleware that decides nothing about access can declare `cache: "public"` to keep shared caching; see [Caching](#caching).
- Keep secrets server-only inside middleware.
- Put secrets and non-serializable dependencies in server context; expose only safe page data through `ctx.data` or `context.data`.
- Middleware is useful for early redirects, but API handlers and server functions must still enforce their own authorization.
- Prefer integration middleware when a provider owns the behavior, such as auth or API key checks.
- Keep middleware fast because it runs before the route can render.
