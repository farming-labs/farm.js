---
title: "Migrate from TanStack Start"
description: "Move a TanStack Start app to Farm: file routes, the root route, loaders, server functions, and server routes."
section: "Migrations"
---

# Migrate from TanStack Start

Farm and TanStack Start both build on Vite and file-based routing. The migration moves file routes
into Farm's `src/app` tree, turns the root route into a root layout, and replaces router loaders and
server functions with Farm data loading and API routes. Components and styles carry over.

> **Using a coding agent?**
>
> Point it at [`/docs/migrations/tanstack.md`](/docs/migrations/tanstack.md). That version maps
> every TanStack Start feature to its Farm equivalent, with before and after code, failure
> symptoms, and a verification checklist.

## Set up Farm

Work on a branch and keep the TanStack app runnable until the Farm build matches it. React is
Farm's default renderer, so no renderer package is needed:

```bash
pnpm add @farm.js/core
pnpm add -D @farm.js/cli
```

Pin exact versions in `package.json`. Package managers with a minimum release age, such as pnpm 11
and later, can resolve `latest` to an older Farm release for a day after a publish.

Create `farm.config.ts` and point the scripts at Farm. TanStack starters have no `start` script, so
add one:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

## Remove the TanStack Vite config

Farm loads a root `vite.config.*` alongside its own Vite setup. The TanStack config adds
`tanstackStart()`, `@vitejs/plugin-react`, and devtools plugins, which break hydration on every
route with `@vitejs/plugin-react can't detect preamble`. Delete `vite.config.ts`, or move it out of
the project root while you still need the old app.

Farm enables Tailwind CSS v4 on its own, so `tailwindcss()` does not need to be re-added to a Vite
config. Keep `tailwindcss` and `@tailwindcss/vite` installed: Farm loads the plugin from the app. The
starter's `#/*` alias is a `package.json` `imports` entry and keeps working, and Farm also resolves
`@/` to `src`.

## Turn the root route into a layout

Farm does not read `__root.tsx`. Recreate it as `src/app/layout.tsx`, which can return the whole
`<html>` document:

```tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import Footer from "../components/Footer";
import Header from "../components/Header";
import "../styles.css";

export const metadata: Metadata = {
  title: "TanStack Start Starter",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
```

Import stylesheets directly instead of through `?url` and a `links` entry, move `head()` titles and
descriptions into `metadata`, and remove `<HeadContent />`, `<Scripts />`, and the devtools
components. Farm injects its own head tags, assets, and client runtime.

## Map file routes

| TanStack file in `src/routes`                      | Farm file in `src/app`                            |
| -------------------------------------------------- | ------------------------------------------------- |
| `index.tsx`                                        | `page.tsx`                                        |
| `about.tsx`                                        | `about/page.tsx`                                  |
| `posts.$postId.tsx` or `posts/$postId.tsx`         | `posts/[postId]/page.tsx`                         |
| `docs.$.tsx`                                       | `docs/[...splat]/page.tsx`                        |
| `posts.tsx` or `posts/route.tsx` with `<Outlet />` | `posts/layout.tsx` rendering `{children}`         |
| `_app.tsx` with `_app/settings.tsx`                | `(app)/layout.tsx` with `(app)/settings/page.tsx` |
| `-components/` and other ignored files             | any name; only reserved file names are routes     |

Farm renders a page module's default export. Add `export default ComponentName` to each page and
remove `export const Route = createFileRoute(...)` once its options are ported. Splat params arrive
as `params.splat`, a single string joined with `/`.

Interactive components keep working: Farm detects hooks and `"use client"` and hydrates them.

## Replace loaders and router hooks

A route that still calls `Route.useLoaderData()` renders a 500 under Farm. Move simple loaders into
an async page:

```tsx
import type { PageProps } from "@farm.js/core";

export default async function PostPage({ params }: PageProps<"/posts/[postId]">) {
  const post = await getPost(params.postId);
  return <h1>{post.title}</h1>;
}
```

Use a programmatic `createRoute` from `@farm.js/core/routes` when a route also needs search-param
validation, guards, caching, or pending and error components. See [Routing](/docs/routing).

| TanStack                             | Farm                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `Link` from `@tanstack/react-router` | `Link` from `@farm.js/core/client`                     |
| `useNavigate()`                      | `useRouter().push()` from `@farm.js/core/navigation`   |
| `Route.useParams()`                  | the page's `params` prop                               |
| `Route.useSearch()`                  | the page's `searchParams` prop, or `useSearchParams()` |
| `redirect()`, `notFound()`           | the same names from `@farm.js/core/navigation`         |
| `router.invalidate()`                | `useRouter().refresh()`                                |

## Server functions

Farm supports two ways to move `createServerFn` calls.

| Approach              | Status       | Use it when                                                                  |
| --------------------- | ------------ | ---------------------------------------------------------------------------- |
| API routes            | Stable       | Most apps. Each server function becomes a typed endpoint.                    |
| Farm server functions | Experimental | You want the closest shape to `createServerFn` and accept the RSC toolchain. |

With API routes, keep the handler logic in a server module, call it directly from async pages, and
mount it as an endpoint for the browser:

```ts
// src/app/api/todos/route.ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const POST = createEndpoint(
  { body: z.object({ title: z.string().min(1) }) },
  async ({ body }) => db.todo.create({ data: body }),
);
```

Client components call it through the generated client, `apiClient.todos.post({ body })`. See
[API Routes](/docs/api-routes) and [API Client](/docs/api-client).

Farm's own `createServerFn` from `@farm.js/core/server-fn` takes an `input` schema in place of
`.inputValidator()`. Calling it from client components requires the experimental
`@farm.js/plugin/rsc` setup with `experimental.serverActions: true`. See
[Route actions](/docs/routing#route-actions).

## Server routes and middleware

Move `server.handlers` from file routes into `src/app/api/**/route.ts`, exporting one function per
HTTP method that takes a `Request` and returns a `Response`. A server route and a page cannot share
one path, so keep APIs under `/api`. Move `createMiddleware` request middleware into
`src/app/middleware.ts`. See [Middleware](/docs/middleware).

## Finish the migration

```bash
pnpm dev
pnpm build
pnpm start
pnpm exec tsc --noEmit
```

Check every route in development and production, confirm client components hydrate and keep state
across client navigation, and exercise each mutation. Remove `@tanstack/react-start`, the router
packages and devtools, `src/router.tsx`, `src/routeTree.gen.ts`, and `src/routes` only after the
Farm build behaves the same in production.
