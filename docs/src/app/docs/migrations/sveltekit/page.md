---
title: "Migrate from SvelteKit"
description: "Move a SvelteKit application to Farm by mapping routes, layouts, load functions, endpoints, hooks, environment variables, and adapters."
section: "Migrations"
---

# Migrate from SvelteKit

SvelteKit and Farm both use filesystem routes, nested layouts, server rendering, Vite, and
standards-based server APIs. Their component runtimes differ: SvelteKit renders Svelte components,
while Farm renders React components. Preserve the route tree and request contracts while rewriting
the UI layer.

> **Manual migration**
>
> `farm migrate` does not detect or rewrite SvelteKit projects yet. This guide is the migration
> checklist for SvelteKit applications.

## Create the Farm shell

Add Farm and React without removing SvelteKit first:

```bash
pnpm add @farm.js/core react react-dom
pnpm add -D @farm.js/cli
```

Create the smallest Farm config:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

Point the application scripts at Farm when the first route is ready:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .output/server/index.mjs"
  }
}
```

## Map the route tree

SvelteKit and Farm both use bracketed dynamic segments. The main change is replacing SvelteKit's
`+file` convention with Farm's page and route modules.

| SvelteKit source                         | Farm output                       |
| ---------------------------------------- | --------------------------------- |
| `src/routes/+page.svelte`                | `src/app/page.tsx`                |
| `src/routes/about/+page.svelte`          | `src/app/about/page.tsx`          |
| `src/routes/posts/[id]/+page.svelte`     | `src/app/posts/[id]/page.tsx`     |
| `src/routes/docs/[...slug]/+page.svelte` | `src/app/docs/[...slug]/page.tsx` |
| `src/routes/+layout.svelte`              | `src/app/layout.tsx`              |
| nested `+layout.svelte`                  | nested `src/app/**/layout.tsx`    |
| `+error.svelte`                          | the nearest `error.tsx`           |

SvelteKit route groups such as `(app)` do not add a URL segment. Recreate their layout intent with
Farm route groups or the appropriate nested layout structure, and review advanced layout resets
manually.

Create a root layout before moving pages:

```tsx
import type { LayoutProps } from "@farm.js/core";

export default function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}
```

Rewrite Svelte markup, runes, stores, actions, transitions, and scoped styles as React components,
hooks, state, effects, and CSS. Do not rename `.svelte` files to `.tsx` without converting them.

## Move load functions

SvelteKit's sibling `+page.ts`, `+page.server.ts`, `+layout.ts`, and `+layout.server.ts` modules feed
data into pages and layouts. Move each load function according to its responsibility:

| SvelteKit behavior        | Farm destination                                     |
| ------------------------- | ---------------------------------------------------- |
| server-only page load     | async page component or `createServerQuery`          |
| universal load            | server query plus a client consumer when needed      |
| reusable cached read      | `createServerQuery` with an explicit structured key  |
| layout load               | async layout or shared server query                  |
| redirect or 404 from load | `redirect()` or `notFound()`                         |
| dependency invalidation   | Farm cache, route, API, or server-query invalidation |

Keep private environment variables, database calls, and privileged SDKs on the server.

## Convert endpoints and form actions

| SvelteKit source                   | Farm output                                      |
| ---------------------------------- | ------------------------------------------------ |
| `src/routes/api/hello/+server.ts`  | `src/app/api/hello/route.ts`                     |
| exported `GET`, `POST`, or `PATCH` | matching HTTP method exports                     |
| actions in `+page.server.ts`       | server functions or validated API route handlers |

Both frameworks use Web `Request` and `Response` concepts for endpoints, but review cookies,
locals, params, and platform access:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ received: body });
}
```

Prefer `createEndpoint` when input needs schema validation and typed client generation. Preserve
progressive enhancement intentionally when replacing SvelteKit form actions.

## Replace navigation and app state

| SvelteKit API                 | Farm equivalent                                       |
| ----------------------------- | ----------------------------------------------------- |
| ordinary internal `<a>` links | `Link` from `@farm.js/core/client`                    |
| `goto()`                      | `navigateTo()` from `@farm.js/core/client`            |
| `redirect()`                  | `redirect()` from `@farm.js/core/navigation`          |
| `error(404)`                  | `notFound()`                                          |
| page params                   | page `params` or `useRouter()`                        |
| URL search values             | page `searchParams` or `useSearchParams()`            |
| `$app/state` or `$app/stores` | page props, React state, Farm stores, or router hooks |

Choose the smallest state owner. Do not move server-derived user or tenant data into a global
browser store unless it is safe to expose.

## Move hooks and locals

Review `src/hooks.server.ts`, `src/hooks.client.ts`, and `event.locals` by lifecycle:

- move request authentication and request-scoped values into Farm middleware
- move route-specific guards into nested `src/app/**/middleware.ts`
- move global server lifecycle behavior into Farm plugins
- move browser lifecycle behavior into client components or Farm client plugin hooks
- pass safe request data through middleware data and keep secrets in server-only context

Repeat sensitive authorization inside API routes and server functions.

## Move environment and deployment config

Replace SvelteKit environment modules and adapters explicitly:

| SvelteKit source           | Farm destination                                 |
| -------------------------- | ------------------------------------------------ |
| `$env/static/private`      | typed server environment variables               |
| `$env/dynamic/private`     | server environment access                        |
| `$env/static/public`       | typed public environment variables               |
| `svelte.config.js` adapter | Farm `deploy.target` or a supported Nitro preset |
| `vite.config.ts`           | Farm's `vite` field when customization is needed |
| `static`                   | Farm's public asset directory                    |

Never move a private value into public environment configuration just because a client component
needs related data. Return a safe derived value from the server instead.

## Verify and remove SvelteKit

Run both applications during the transition and compare:

- static, dynamic, optional, rest, and grouped routes
- nested layouts, layout resets, errors, and redirects
- server and universal load behavior
- form actions and progressive enhancement
- endpoint status codes, headers, cookies, and response bodies
- hook order, locals, authentication, and authorization
- SSR, hydration, and client navigation
- adapter behavior on the target deployment platform

After the Farm application passes those checks, remove SvelteKit, Svelte, its adapter, `.svelte-kit`,
and framework-specific configuration.

For source behavior, refer to SvelteKit's official [routing](https://svelte.dev/docs/kit/routing),
[loading data](https://svelte.dev/docs/kit/load), [advanced routing](https://svelte.dev/docs/kit/advanced-routing),
and [hooks](https://svelte.dev/docs/kit/hooks) documentation while auditing the original app.
