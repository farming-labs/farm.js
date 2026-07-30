---
title: "Migrate from Nuxt"
description: "Move a Nuxt application to Farm by mapping Vue pages, layouts, server routes, middleware, data, and runtime configuration."
section: "Migrations"
---

# Migrate from Nuxt

Nuxt and Farm share file-based routing, server rendering, API routes, Vite, and Nitro deployment
output, but they use different UI runtimes. Nuxt pages are Vue single-file components; Farm pages
are React modules. Preserve route URLs and server contracts while rewriting the component layer.

> **Manual migration**
>
> `farm migrate` does not detect or rewrite Nuxt projects yet. This guide is the migration
> checklist for Nuxt applications.

## Create the Farm shell

Add Farm and React without removing Nuxt first:

```bash
pnpm add @farm.js/core react react-dom
pnpm add -D @farm.js/cli
```

Create the smallest Farm config:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

Point the application scripts at Farm when the first route is ready to run:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .output/server/index.mjs"
  }
}
```

## Map pages and layouts

Nuxt 4 normally keeps pages under `app/pages`; projects using the earlier layout may use `pages` at
the root. Both map into Farm's `src/app`.

| Nuxt source                                        | Farm output                                 |
| -------------------------------------------------- | ------------------------------------------- |
| `app/pages/index.vue` or `pages/index.vue`         | `src/app/page.tsx`                          |
| `app/pages/about.vue` or `pages/about.vue`         | `src/app/about/page.tsx`                    |
| `app/pages/posts/[id].vue`                         | `src/app/posts/[id]/page.tsx`               |
| `app/pages/docs/[...slug].vue`                     | `src/app/docs/[...slug]/page.tsx`           |
| `app/layouts/default.vue` or `layouts/default.vue` | `src/app/layout.tsx`                        |
| nested Nuxt layouts                                | nested `src/app/**/layout.tsx` files        |
| `error.vue`                                        | the nearest `error.tsx` and `not-found.tsx` |

Create a root layout before moving pages:

```tsx
import type { LayoutProps } from "@farm.js/core";

export default function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}
```

Rewrite each Vue template, `<script setup>`, composable, and scoped style as React TSX, hooks, and
CSS. Do not copy a `.vue` file into `src/app` unchanged.

## Replace Nuxt navigation

| Nuxt API                 | Farm equivalent                                    |
| ------------------------ | -------------------------------------------------- |
| `<NuxtLink to="/about">` | `<Link href="/about">` from `@farm.js/core/client` |
| `navigateTo("/sign-in")` | `redirect("/sign-in")` on the server               |
| client `navigateTo()`    | `navigateTo()` from `@farm.js/core/client`         |
| `useRoute().params`      | page `params` or `useRouter()`                     |
| `useRoute().query`       | page `searchParams` or `useSearchParams()`         |
| `definePageMeta()`       | page metadata exports and route configuration      |

Keep dynamic segment names stable so existing links and external URLs continue to work.

## Move data fetching

Classify every `useFetch`, `useAsyncData`, and `$fetch` call by where it should run:

| Nuxt behavior                        | Farm destination                                    |
| ------------------------------------ | --------------------------------------------------- |
| server-rendered page data            | async page component or `createServerQuery`         |
| cached reusable read                 | `createServerQuery` with an explicit structured key |
| browser request to an app endpoint   | generated API client or `fetch`                     |
| mutation or privileged server action | server function or validated API route              |
| route guard data                     | route middleware or page guard                      |

Keep database clients, secrets, and privileged provider SDKs in server-only modules. Validate
untrusted params, query values, form data, and API bodies before using them.

## Convert server routes

Move Nitro server handlers into Farm API route modules:

| Nuxt source                      | Farm output                                    |
| -------------------------------- | ---------------------------------------------- |
| `server/api/hello.get.ts`        | `src/app/api/hello/route.ts` with `GET`        |
| `server/api/users/[id].patch.ts` | `src/app/api/users/[id]/route.ts` with `PATCH` |
| `server/routes/health.ts`        | an API route or programmatic Farm route        |
| `server/middleware/*.ts`         | Farm middleware or a server plugin             |

Farm handlers use Web `Request` and `Response` objects:

```ts
export async function GET() {
  return Response.json({ ok: true });
}
```

Use `createEndpoint` when the endpoint needs schema validation and a typed generated client.

## Move middleware and plugins

Nuxt route middleware and server middleware do not share one lifecycle, so migrate them by
responsibility:

- move authentication redirects and route gates into `src/app/**/middleware.ts`
- move global request behavior into `farm.config.ts` middleware
- move reusable server lifecycle behavior into a Farm plugin
- move provider setup into a Farm integration when it owns routes, middleware, or client context
- replace Nuxt client plugins with client components or Farm client plugin hooks

Repeat sensitive authorization in API routes and server functions. A page redirect is not an
authorization boundary.

## Move runtime configuration

Review `nuxt.config.ts`, `app.config.ts`, modules, auto-imports, aliases, and `runtimeConfig`
explicitly:

| Nuxt configuration       | Farm destination                                       |
| ------------------------ | ------------------------------------------------------ |
| private `runtimeConfig`  | typed server environment variables                     |
| `runtimeConfig.public`   | typed public environment variables                     |
| app metadata             | page or layout metadata exports                        |
| Vite plugins and aliases | the `vite` field in `farm.config.ts` when still needed |
| Nuxt modules             | Farm integrations, plugins, or ordinary packages       |
| auto-imported components | explicit React imports                                 |

Do not expose a private Nuxt runtime value through Farm's public environment configuration.

## Verify and remove Nuxt

Run both applications during the transition and compare:

- static, dynamic, optional, and catch-all routes
- layouts, metadata, error states, and redirects
- server-rendered data and client navigation
- API status codes, headers, cookies, and response bodies
- middleware order and authorization
- image and public asset URLs
- production output on the target deployment platform

After the Farm application passes those checks, remove Nuxt, Vue, Nuxt modules, `.nuxt`, and
framework-specific deployment configuration.

For source behavior, refer to Nuxt's official [pages](https://nuxt.com/docs/4.x/directory-structure/app/pages),
[data fetching](https://nuxt.com/docs/4.x/getting-started/data-fetching), and
[directory structure](https://nuxt.com/docs/4.x/directory-structure) documentation while auditing
the original app.
