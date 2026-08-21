---
title: "Migrate from SvelteKit"
description: "Move a SvelteKit application to Farm by mapping routes, layouts, load functions, endpoints, hooks, environment variables, and adapters."
section: "Migrations"
---

# Migrate from SvelteKit

SvelteKit and Farm both use filesystem routes, nested layouts, server rendering, Vite, and
standards-based server APIs. The `@farm.js/svelte` renderer lets route UI remain in Svelte 5
components. Preserve the route tree and component markup while replacing SvelteKit-specific data,
navigation, hooks, environment, and deployment APIs.

> **Manual migration**
>
> `farm migrate` does not detect or rewrite SvelteKit projects yet. This guide is the migration
> checklist for SvelteKit applications.

## Create the Farm shell

Add FARMJS and its Svelte renderer without removing SvelteKit first:

```bash
pnpm add @farm.js/core @farm.js/svelte svelte
pnpm add -D @farm.js/cli
```

Create the smallest Farm config:

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
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

| SvelteKit source                         | FARMJS output                        |
| ---------------------------------------- | ------------------------------------ |
| `src/routes/+page.svelte`                | `src/app/page.svelte`                |
| `src/routes/about/+page.svelte`          | `src/app/about/page.svelte`          |
| `src/routes/posts/[id]/+page.svelte`     | `src/app/posts/[id]/page.svelte`     |
| `src/routes/docs/[...slug]/+page.svelte` | `src/app/docs/[...slug]/page.svelte` |
| `src/routes/+layout.svelte`              | `src/app/layout.svelte`              |
| nested `+layout.svelte`                  | nested `src/app/**/layout.svelte`    |
| `+error.svelte`                          | the nearest `error.svelte`           |

SvelteKit route groups such as `(app)` do not add a URL segment. Recreate their layout intent with
Farm route groups or the appropriate nested layout structure, and review advanced layout resets
manually.

Create a root layout before moving pages:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
```

Keep ordinary Svelte markup, runes, stores, actions, transitions, and scoped styles. Replace
SvelteKit imports and conventions inside each component, and move FARMJS route exports such as
`metadata` and `hydrate` into `<script module lang="ts">`. See
[Svelte Renderer](/docs/renderers/svelte) for the complete component conventions.

## Move load functions

SvelteKit's sibling `+page.ts`, `+page.server.ts`, `+layout.ts`, and `+layout.server.ts` modules feed
data into pages and layouts. Move each load function according to its responsibility:

| SvelteKit behavior        | Farm destination                                     |
| ------------------------- | ---------------------------------------------------- |
| server-only page load     | `createServerQuery`, server function, or API route   |
| universal load            | typed API/server query plus a Svelte client consumer |
| reusable cached read      | `createServerQuery` with an explicit structured key  |
| layout load               | shared server query or typed API route               |
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

| SvelteKit API                 | FARMJS Svelte equivalent                                   |
| ----------------------------- | ---------------------------------------------------------- |
| ordinary internal `<a>` links | ordinary Svelte `<a>` elements                             |
| `goto()`                      | `navigateTo()` from `@farm.js/core/client`                 |
| `redirect()`                  | `redirect()` from `@farm.js/core/navigation`               |
| `error(404)`                  | `notFound()`                                               |
| page params                   | `params` from `$props()`                                   |
| URL search values             | `searchParams` from `$props()` or browser URL state        |
| `$app/state` or `$app/stores` | route props, Svelte runes/stores, or renderer-neutral APIs |

Choose the smallest state owner. Do not move server-derived user or tenant data into a global
browser store unless it is safe to expose.

## Move hooks and locals

Review `src/hooks.server.ts`, `src/hooks.client.ts`, and `event.locals` by lifecycle:

- move request authentication and request-scoped values into Farm middleware
- move route-specific guards into nested `src/app/**/middleware.ts`
- move global server lifecycle behavior into Farm plugins
- move browser lifecycle behavior into hydrated Svelte components or FARMJS client plugin hooks
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

After the FARMJS application passes those checks, remove `@sveltejs/kit`, the SvelteKit adapter,
`.svelte-kit`, and framework-specific configuration. Keep `svelte` and `@farm.js/svelte` as
application dependencies.

For source behavior, refer to SvelteKit's official [routing](https://svelte.dev/docs/kit/routing),
[loading data](https://svelte.dev/docs/kit/load), [advanced routing](https://svelte.dev/docs/kit/advanced-routing),
and [hooks](https://svelte.dev/docs/kit/hooks) documentation while auditing the original app.
