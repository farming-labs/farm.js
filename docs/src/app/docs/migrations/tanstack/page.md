---
title: "Migrate from TanStack Start"
description: "Compare Farm.js with TanStack Start on measured performance, typed APIs, developer tools, agents, and integrations, then migrate routes and server behavior."
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

## Why move from TanStack Start

**Keep React and a Vite development workflow, and put more of the application behind one typed
framework contract.** [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/overview)
already provides typed routing, server functions, and SSR. Farm's case is the combination of those
application concerns with integrations, generated API callers, operational tools, and agent access.

- **One place for product services.** Auth, billing, email, jobs, storage, and agent runtimes fit
  into Farm's integration and configuration model. An integration can own its routes, callers,
  middleware, and lifecycle rather than requiring each application to assemble that wiring.
- **Endpoint types beyond one router.** Define validation at the API boundary and consume the
  generated client in the browser. Route handlers remain ordinary Web `Request`/`Response`
  endpoints for other clients too.
- **A measurable development baseline.** The published fixture reaches its first usable dev
  response sooner on Farm. The build difference is smaller; the numbers below show both.
- **Inspection before guesswork.** The same app exposes route explanations, diagnostics,
  generated-type checks, and a browser DevTools view.
- **Agent native at the core.** Markdown, page discovery, capability manifests, and read-only
  MCP are built into `@farm.js/core`. Explicit tools and optional durable agent execution extend
  the same application's routes and authorization boundaries.

### Performance evidence

The [published November 3, 2026 snapshot](https://github.com/farming-labs/farm.js/blob/5ff3c9fb20319c9344c1cc1fe918b7eab71b3877/benchmarks/frameworks/results/latest.md)
compares Farm.js 0.1.51-beta.2 with TanStack Start 1.168.32. Both use React 19.2.4; the Farm stack
uses Vite 8.3.4/Rolldown and the TanStack stack uses Vite 8.1.5. Lower durations are better.

| Measure                                   | TanStack Start | Farm.js        |
| ----------------------------------------- | -------------- | -------------- |
| Process launch to first dev page, median  | 815.62 ms      | 271.78 ms      |
| Warm dev response, median                 | 4.59 ms        | 2.08 ms        |
| Clean fixture build, median               | 690.24 ms      | 589.12 ms      |
| Production boot to first response, median | 83.21 ms       | 77.69 ms       |
| Production response, median / p95         | 0.99 / 1.74 ms | 0.74 / 1.64 ms |

In this fixture, Farm reaches the first dev page in about one-third of the time and builds in
about 15% less time. The small production-boot and p95 differences are not a capacity forecast.
This benchmark does not measure HMR, browser navigation, database work, or a production traffic mix.

The workload is one fresh SSR page with 120 list items and shared CSS. The run used an Apple M1,
16 GB RAM, macOS 26.2, Node 24.21.0, one discarded burn-in, and seven position-balanced measured
rounds. Each server received 30 warmup and 30 measured requests per round over local HTTP/1.1,
requesting identity encoding. Generated framework caches were removed for dev and build; OS and
product-enabled Node compile caches stayed warm. Farm package preparation and dependency installs
are outside the build timer. See the
[method and raw samples](https://github.com/farming-labs/farm.js/tree/5ff3c9fb20319c9344c1cc1fe918b7eab71b3877/benchmarks/frameworks).
Rerun your routes before treating these historical results as a migration estimate.

### Developer experience after the move

Farm's [API client](/docs/api-client) connects validated endpoints to inferred browser calls.
Use [typed URL state](/docs/query) where appropriate, and
[layers](/docs/layers) to share app foundations. [Internationalization](/docs/internationalization),
[themes](/docs/themes), [storage](/docs/storage), and [cron](/docs/cron) have documented framework
contracts rather than being migration-specific glue.

Use `farm explain /products/42` to inspect the page, layouts, middleware, and runtime that apply
to a URL. `farm doctor --json` gives an agent or CI structured diagnostics;
`farm generate --check` catches stale declarations. [DevTools](/docs/plugins/devtools),
[Hints](/docs/plugins/hints), and [Analyzer](/docs/plugins/analyzer) cover runtime inspection,
live-page issues, and build-size investigation.

You can keep TanStack Query where it already owns application data. Decide which cache owns each
read before adding Farm caching; moving the framework does not require replacing every TanStack
library. Loader context, search validation, invalidation, and navigation behavior still need the
explicit mappings in this guide.

### Agent experience after the move

**The core makes the app readable and discoverable by default.** You do not need an agent
integration or a separate MCP server for its public-page reading surface. On Farm's normal
page-serving pipeline,
[Markdown mirrors](/docs/markdown), [discovery metadata](/docs/configuration#agent-readiness),
and a [read-only MCP catalog](/docs/configuration#default-mcp-server) let agents read eligible
public pages. The [app manifest](/docs/configuration#app-manifest) describes installed capabilities.
These are useful for product documentation and support agents, not only for the agent doing the
migration.

Core also publishes an [AI catalog](/docs/configuration#ai-catalog) for MCP servers the app already
serves. See [core defaults and limits](/docs/migrations#agent-native-at-the-core), including the
docs engine's ownership of its indexes and the experimental RSC pipeline's default-MCP limitation.

For actions, expose selected endpoints through [API MCP](/docs/plugins/mcp), retaining validation
and authorization. [WebMCP](/docs/plugins/webmcp) registers explicit actions in an open, supporting
browser and remains experimental. For long-running work, the
[agent integration](/docs/integrations/agent) adds durable steps, pauses, and event waits. Use
`farm agent check` to inspect the running surface; none of these discovery features grants access
to a private endpoint.

### Integrations and plugins worth carrying into the plan

- Use [integrations](/docs/integrations) for services such as Better Auth, Stripe, Resend, and
  Jobs. Keep provider SDKs on the server and reuse an owned client where supported.
- Add [Prefetch](/docs/plugins/prefetch), [Progress](/docs/plugins/progress), and
  [Scroll restoration](/docs/plugins/scroll-restoration) after checking the migrated navigation.
- Use [MSW](/docs/plugins/msw) for request fixtures and [Health](/docs/plugins/health) or
  [Sentry](/docs/plugins/sentry) for operating the deployed app.
- Evaluate [PWA](/docs/plugins/pwa) for offline navigation, [Sync](/docs/plugins/sync) for
  row-level data, and [Content](/docs/plugins/content) plus [Search](/docs/plugins/search) for
  content-heavy applications. The [full catalog](/docs/migrations#integrations-for-the-product-plugins-for-the-framework)
  also covers scripts, workers, styling, and custom lifecycle hooks.

### Decide the data and rendering contract first

`createFileRoute`, router context, loaders, and TanStack server functions do not run unchanged
under Farm. Keep the existing app runnable while you migrate them. API endpoints provide a
straightforward browser/server boundary; React server components and their action transport have
[experimental modes](/docs/server-rendering#react-server-components) with their own requirements.
The RSC pipeline does not yet run every Farm integration or plugin. Check its feature limits, and
do not enable an experimental renderer merely to preserve a function's name.

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

Farm does not read `__root.tsx`. Recreate it as `src/app/layout.tsx`. Farm owns the HTML document
shell, so the layout returns application UI:

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
    <>
      <Header />
      {children}
      <Footer />
    </>
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

| Approach              | Status       | Use it when                                                                          |
| --------------------- | ------------ | ------------------------------------------------------------------------------------ |
| API routes            | Stable       | Most apps. Each server function becomes a typed endpoint.                            |
| Farm server functions | Experimental | You want typed browser-callable functions and accept an experimental rendering mode. |

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
`.inputValidator()`. Calling it from client components requires Farm's server-function transform.
Follow the current [server-component setup](/docs/server-rendering#react-server-components) for
the islands or RSC mode you choose, then see [Route actions](/docs/routing#route-actions).

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
