---
title: "Migrate from Next.js"
description: "Why move from Next.js to Farm.js: measured build costs and performance, typed APIs, developer tools, agent capabilities, and an App Router migration guide."
section: "Migrations"
---

# Migrate from Next.js

Farm uses the same App Router file shape for pages, layouts, loading states, errors, not-found
pages, and route handlers, so most of the route tree moves without redesign. The work is in the
pieces around it: Next.js modules, server actions, middleware, and `next.config`.

> **Using a coding agent?**
>
> Point it at [`/docs/migrations/nextjs.md`](/docs/migrations/nextjs.md). That version maps every
> App Router feature to its Farm equivalent, with before and after code, failure symptoms, and a
> verification checklist.

## Why move from Next.js

**Keep React and the App Router-shaped route tree, then connect the rest of your product through
Farm's typed APIs, integrations, and agent tools.** The strongest reasons to migrate are concrete:
less time waiting for builds, smaller output to deploy, and less repeated wiring around
authentication, billing, data, and agent access.

- **Keep familiar page conventions.** Pages, nested layouts, loading states, and error boundaries
  have recognizable destinations. Ordinary React components and styles can carry over while you
  replace Next-specific modules.
- **Reduce build and delivery work.** The docs-site measurements below show a 2.3× faster cold
  build and 3.2× smaller output. A separate Vercel sample shows about 16% lower mean build
  charges. The four-page fixture has different results; choose the workload closest to your app.
- **Give APIs one typed contract.** Endpoint validation and generated callers connect server and
  browser code. Integrations extend that contract to services instead of leaving every feature
  with its own route wrapper and request helper.
- **Make the application readable and callable by agents.** Markdown, discovery, read-only MCP,
  explicit API tools, and browser tools have framework-level homes.
- **Keep a deployment choice.** Farm supports Node, Vercel, Cloudflare, and Netlify targets through
  its [deployment configuration](/docs/deployment). Test your SDKs and middleware on the chosen
  target; changing the framework does not make every dependency portable.

### Performance and build cost

November 2026 measurements cover a real documentation site, Vercel build charges, and a separate
four-page application. Farm reduced cold-build time, output size, and JavaScript transfer in both
applications. Results apply to the versions and workloads below; each comparison measures a
different part of building and running an app.

#### Real documentation site

This comparison uses the last Next.js version of the docs site (`c8035ceb`, Next.js 16.4.2,
`@farming-labs/next` 0.2.136) and its Farm port (`7ec9e97c`, Farm.js 0.1.74,
`@farming-labs/farmjs` 0.2.146). Timings are medians; parentheses give the observed range.

| Measure                            | Next.js             | Farm.js                 |
| ---------------------------------- | ------------------- | ----------------------- |
| Cold build                         | 19.0 s (16.7–27.7)  | 8.3 s (6.9–15.1)        |
| Warm build                         | 6.4 s (5.2–11.2)    | 7.0 s (6.5–16.3)        |
| Build output                       | 317 MB              | 99 MB; 60 MB deployable |
| JavaScript per page, gzip          | 309–364 KB          | 256–257 KB              |
| CSS per page, gzip                 | 61–63 KB            | 113 KB                  |
| HTML + JavaScript + CSS per page   | 391–444 KB          | 381–386 KB              |
| Dev launch to first page           | 3.98 s (3.88–4.36)  | 2.50 s (2.47–2.53)      |
| Dev request for the next page      | 0.38 s              | 0.034 s                 |
| First browser load, once listening | 3.7 s               | 1.9 s                   |
| Self-hosted static requests/s      | 985 (890–990)       | 7,648 (7,593–8,126)     |
| Self-hosted Markdown requests/s    | 1,168 (1,138–1,188) | 2,159 (2,157–2,177)     |
| First request after server start   | 376 ms              | 5 ms                    |
| Server memory, idle / under load   | 94 / 550 MB         | 130 / 413 MB            |

For this site, that is a **2.3× faster cold build, 3.2× smaller build output, and 7.8× higher
self-hosted static throughput**. The CSS increase means the total page-weight improvement is much
smaller than the JavaScript improvement alone. Warm-build ranges overlap, and Farm uses more idle
memory in this sample.

The build work is not identical: Next prerendered 145 pages, including gated docs; Farm prerendered
79 and rendered gated docs on request. Static throughput measures Node servers. On Vercel, static
pages use the CDN, so that row does not predict a 7.8× improvement for visitors on Vercel.

#### Observed Vercel build charges

The deployment sample covers ready deployments from November 3–16, 2026: 209 Next.js deploys and
275 Farm.js 0.1.69 deploys. Charges use the November 16 Standard build-machine price of $0.014 per
minute, rounded up to whole minutes. Your plan and deployment workload can produce different costs.

| Per deploy                    | Next.js            | Farm.js 0.1.69       |
| ----------------------------- | ------------------ | -------------------- |
| Mean build charge             | 2.76¢              | 2.31¢                |
| Deploys billed for one minute | 9 / 209 (about 4%) | 97 / 275 (about 35%) |
| Median build step             | 39 s               | 34 s                 |
| Median post-build step        | 33 s               | 27 s                 |
| Median uploaded build cache   | 509 MiB            | 200 MiB              |

The observed mean charge fell **about 16% per deploy**, and the uploaded cache was about 2.5×
smaller. Finishing inside a billing-minute boundary explains why a modest time reduction can
change the charge. This is build cost, not total hosting cost. At the site's roughly 1,100 daily
requests, runtime cost was negligible on either stack.

The latest production deploy in that sample ran `next build` in 11.0 s
with its restored cache and `farm build` in 13.7 s from scratch. Cache upload size, local cold-build
speed, and cache reuse are different measurements.

#### The same four-page application

The separate fixture contains a static 200-item page, a static page with a client counter, a fresh
200-row SSR page, and a JSON API. It compares Next.js 16.4.6 with Farm commit `6cee6f6f`
(tagged 0.1.76 and installed from packed source at measurement time), with React 19.3.1 on both.
Next uses standalone output; build-time type checking is disabled so both timed builds only bundle.

| Measure                                                | Next.js            | Farm.js               |
| ------------------------------------------------------ | ------------------ | --------------------- |
| Framework install, excluding shared React/type tooling | 320 MB             | 116 MB                |
| Installed package count                                | 19                 | 249                   |
| Cold build                                             | 3.06 s (2.76–3.41) | 0.84 s (0.80–1.20)    |
| Cold-build CPU time                                    | 11.9 s (11.7–12.6) | 1.38 s (1.31–1.47)    |
| Peak cold-build memory                                 | 761 MB             | 466 MB                |
| Deployable server                                      | 38.5 MB            | 1.1 MB                |
| JavaScript per page, gzip                              | 131.5–131.7 KB     | 83.9–84.3 KB          |
| First dev page request                                 | 1.11 s (1.07–1.22) | 0.050 s (0.047–0.052) |
| First browser load                                     | 1.39 s (1.06–1.57) | 0.24 s (0.21–0.30)    |
| Static requests/s                                      | 3,524              | 8,788                 |
| SSR requests/s                                         | 722                | 3,550                 |
| API requests/s                                         | 4,205              | 7,873                 |

Here Farm has a **3.6× faster cold build, 35× smaller deployable server, and about 36% less
JavaScript**. The first-page request excludes starting the dev server; do not compare its 22×
ratio with the docs site's launch-to-page measurement. Farm installs more, smaller packages;
package count and installed bytes describe different costs.

Both stacks preserved counter state during client edits. Server-page edits took similar time,
but Next refreshed in place while the measured Farm version reloaded the page. The A/A
control (two copies of Farm 0.1.75) found enough noise to treat client-edit time, server-edit time,
and SSR p95 latency as ties. Recheck HMR behavior on the version you migrate to.

#### Method and cost limits

Measurements used an Apple M1 with 16 GB RAM, Node 24.21.0, and headless Chrome 157. Build
measurements used seven interleaved rounds; dev measurements used five after a warmup. The
four-page production test used four rounds, 200 sequential requests, then 32 concurrent connections
for five seconds. Other processes were active, the docs test had no A/A control, and a fifth
four-page production round stopped when the disk filled. Read small differences by their ranges.

A cost model projects a **64% lower Lambda bill for the SSR fixture**, using a 1 GB function,
millisecond-rounded median latency, and uncompressed transfer. Its price assumptions are
$0.0000166667 per GB-second, $0.09 per GB transferred, and $0.20 per million requests.
This is an estimate, not a measured AWS bill. Compression changes it; API cost tied in the same model.
Database time, cold starts, regions, provisioned capacity, and real traffic can change the result.
Likewise, dividing peak traffic by one process's throughput is a capacity estimate, not proof that
a fleet scales linearly.

### Developer experience after the move

Use [typed endpoints](/docs/api-routes) and the [paired API clients](/docs/api-client) to carry
validation and types from the server to browser callers. Add [integrations](/docs/integrations)
for auth, payments, email, jobs, or an agent runtime, and share repeated application setup through
[layers](/docs/layers). Typed [i18n](/docs/internationalization), [themes](/docs/themes),
[storage](/docs/storage), and [cron](/docs/cron) live alongside the routing configuration.

When a migrated URL behaves differently, run `farm explain /that/path`. Use `farm doctor --json`
for machine-readable diagnostics and `farm generate --check` in CI. Add
[DevTools](/docs/plugins/devtools) to inspect source and served modules,
[Hints](/docs/plugins/hints) to inspect the live page, and [Analyzer](/docs/plugins/analyzer)
to find which routes and imports contribute to build size.

### Agent experience after the move

Farm serves [Markdown mirrors](/docs/markdown) and generates
[discovery metadata](/docs/configuration#agent-readiness). The default
[read-only MCP server](/docs/configuration#default-mcp-server) lists, searches, and reads eligible
public static pages. A shared docs configuration provides `llms.txt`, Markdown routes, and MCP
across multiple documentation sets.

For actions, choose explicit [API MCP tools](/docs/plugins/mcp) that reuse endpoint validation and
authorization, or [WebMCP](/docs/plugins/webmcp) for named actions in a supporting browser.
WebMCP is experimental; discovery never grants permission to mutate data. For your own agents,
the [agent integration](/docs/integrations/agent) adds durable execution beside the app, while
`farm agent check` helps inspect what the running application exposes.

### Plugins to add as you migrate

- Replace third-party script loading with [Scripts](/docs/plugins/scripts); use
  [Partytown](/docs/plugins/partytown) only for SDKs you have verified in a worker.
- Add [Content](/docs/plugins/content) and [Search](/docs/plugins/search) for typed content
  collections and search over emitted static pages.
- Add [Prefetch](/docs/plugins/prefetch), [Progress](/docs/plugins/progress), and
  [Scroll restoration](/docs/plugins/scroll-restoration) where they match your navigation needs.
- Use [Health](/docs/plugins/health), [Sentry](/docs/plugins/sentry), and
  [MSW](/docs/plugins/msw) for operations and request-level testing.
- Evaluate [PWA](/docs/plugins/pwa), [Sync](/docs/plugins/sync), or the
  [rest of the catalog](/docs/migrations#integrations-for-the-product-plugins-for-the-framework)
  when the product needs them. These are opt-in capabilities, not part of the benchmark fixture.

### Decide the rendering contract first

Next's [App Router](https://nextjs.org/docs/app) uses React Server Components. Farm's default SSR
and hydration path is a different contract. Its experimental server-component modes include
Farm's islands engine and React's RSC engine; use the current
[rendering guide](/docs/server-rendering#react-server-components) to choose deliberately.
The results above do not establish performance parity across those modes.
The RSC pipeline does not yet run every Farm integration or plugin; check its documented feature
limits before choosing it for an application that depends on those capabilities.

Audit server actions, caching, middleware, and Next-dependent libraries before moving them.
Farm owns the HTML document shell, so root layouts return application UI; move document metadata
into Farm's metadata APIs. Pages Router applications need a separate routing conversion before
following this App Router guide. The phased steps below are the compatibility work that turns the
advantages into a working migration.

## Set up Farm

Work on a branch and keep the Next.js app runnable until the Farm build matches it. React is Farm's
default renderer, so no renderer package is needed:

```bash
pnpm add @farm.js/core
pnpm add -D @farm.js/cli
```

Pin exact versions in `package.json`. Package managers with a minimum release age, such as pnpm 11
and later, can resolve `latest` to an older Farm release for a day after a publish.

Create `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

Point the scripts at Farm:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

## Move files

Farm's app directory is `src/app`, and the `@/` alias resolves to `src`.

| Next.js                                 | Farm                                        |
| --------------------------------------- | ------------------------------------------- |
| `app/**`                                | `src/app/**`                                |
| `components/`, `lib/`, `hooks/` at root | `src/components/`, `src/lib/`, `src/hooks/` |
| `app/api/**/route.ts`                   | `src/app/api/**/route.ts`                   |
| `route.ts` outside `app/api`            | `defineRoutes` in `src/routes.ts`           |
| `middleware.ts` or `proxy.ts` (Next 16) | `src/app/middleware.ts`                     |
| `public/`                               | `public/`                                   |
| tsconfig `"@/*": ["./*"]`               | `"@/*": ["./src/*"]`                        |

Farm writes `src/lib/api.generated.ts` once the app has API routes, so merge an existing `lib/`
folder into `src/lib` rather than nesting it.

## Replace Next.js modules

Rewrite these imports in every file, not only in `app/`. A shared component that still imports
`next/link` or `next/navigation` throws `invariant expected app router to be mounted`.

| Next.js            | Farm                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `next/link`        | `import { Link } from "@farm.js/core/client"`                           |
| `next/navigation`  | `@farm.js/core/navigation`                                              |
| `next/headers`     | `@farm.js/core/headers`                                                 |
| `next/cache`       | `@farm.js/core/cache`                                                   |
| `next/image`       | `import Image from "@farm.js/core/image"`                               |
| `next/font/local`  | `localFont` from `@farm.js/core/font`                                   |
| `next/font/google` | a font package with `localFont`, or `@fontsource*` CSS imports          |
| `next/script`      | the [scripts plugin](/docs/plugins/scripts) or a `<script>` in a layout |
| `next/dynamic`     | `React.lazy` with `<Suspense>`                                          |
| `next/og`          | `ImageResponse` from `@farm.js/core/og` (install `@vercel/og`)          |
| `next/server`      | standard `Request` and `Response`                                       |

Replace `next/font`, `next/image`, and `next/server` before the first run. `next/font/google` makes
every page fail in development, and a route handler that still imports `next/server` works in
development but crashes the production server at startup.

```tsx
import { Link } from "@farm.js/core/client";
import { cookies } from "@farm.js/core/headers";
import { redirect } from "@farm.js/core/navigation";

export default async function Page() {
  if (!(await cookies()).has("session")) redirect("/sign-in");
  return <Link href="/docs">Docs</Link>;
}
```

## Server actions

Farm supports two ways to run a mutation on the server.

| Approach              | Status       | Use it when                                                                                |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| API routes as actions | Stable       | Most apps. Each action becomes a typed endpoint.                                           |
| Server functions      | Experimental | The app needs browser-callable server functions and an experimental server-component mode. |

### API routes as actions

Move each action into a typed endpoint and call it through the generated client. React's form
hooks keep working with a client function as the action.

```ts
// src/app/api/todos/route.ts
import { createEndpoint } from "@farm.js/core/api";
import { revalidatePath } from "@farm.js/core/cache";
import { z } from "zod";

export const POST = createEndpoint(
  { body: z.object({ title: z.string().trim().min(1) }) },
  async ({ body }) => {
    const todo = await db.todo.create({ data: { title: body.title } });
    await revalidatePath("/todos");
    return todo;
  },
);
```

```tsx
"use client";
import { useActionState } from "react";
import { useRouter } from "@farm.js/core/navigation";
import { apiClient } from "@/lib/api";

export function TodoForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => {
      const { error } = await apiClient.todos.post({
        body: { title: String(formData.get("title") ?? "") },
      });
      if (error) return { error: error.message };
      router.refresh();
      return {};
    },
    {},
  );

  return (
    <form action={formAction}>
      <input name="title" />
      <button disabled={pending}>Add</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
```

See [API Routes](/docs/api-routes) and [API Client](/docs/api-client) for validation, middleware,
and `src/lib/api.ts`.

### Server functions

Server functions are the closest match to Next.js server actions. A `"use server"` module ports
with only import changes, and `createServerFn` from `@farm.js/core/server-fn` adds input
validation, typed errors, and cache invalidation:

```ts
// src/actions/todos.ts
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

export const createTodo = createServerFn({
  input: z.object({ title: z.string().trim().min(1) }),
  async handler({ input }) {
    return db.todo.create({ data: { title: input.title } });
  },
});
```

Client components call it directly or through `useAction` from `@farm.js/core/client`, which also
works as a form action. This path needs Farm's server-function transform and an experimental
server-component mode. Follow the current
[server-component setup](/docs/server-rendering#react-server-components) for islands or React's
RSC engine, then see
[Route actions](/docs/routing#route-actions) and
[Server action security](/docs/configuration#server-action-security).

Setting `experimental.serverActions` without `experimental.serverComponents` does not enable server
functions in the browser.

## Route handlers and middleware

Route handlers under `src/app/api` keep their exported HTTP methods. Replace `NextRequest` with
`Request` and `NextResponse.json()` with `Response.json()`.

Middleware moves to `src/app/middleware.ts`:

```ts
export function middleware(request: Request) {
  if (!request.headers.get("cookie")?.includes("session=")) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}
```

Returning nothing continues the request, like `NextResponse.next()`. See
[Middleware](/docs/middleware) for matchers, rewrites, and request data.

## Behavior to review

- Pages are rendered on each request by default. Mark routes static explicitly where Next.js
  rendered them statically. See [Cache and PPR](/docs/cache-ppr).
- `params` is a plain object. `await params` keeps working, but `use(params)` does not.
- Page catch-all params such as `[...slug]` arrive as a single string joined with `/`.
- Public environment values are declared under `env` in `farm.config.ts` instead of relying on
  the `NEXT_PUBLIC_` prefix. See [Configuration](/docs/configuration).
- Tailwind CSS v4: run `pnpm add -D @tailwindcss/vite`, keep `tailwindcss` and
  `@import "tailwindcss";`, then delete `postcss.config.*`, `@tailwindcss/postcss`, and any Tailwind
  loader in `next.config`. Farm loads `@tailwindcss/vite` from the app; without it the build still
  succeeds but styles are not processed by Tailwind.
- Move `redirects`, `rewrites`, and `headers` from `next.config` into `farm.config.ts`. See
  [Configuration](/docs/configuration).
- Next's `LayoutProps` and `PageProps` globals do not exist in Farm. Import `LayoutProps` and
  `PageProps` from `@farm.js/core`; they take the same route literal, such as `PageProps<"/blog/[slug]">`.

## Finish the migration

```bash
pnpm dev
pnpm build
pnpm start
pnpm exec tsc --noEmit
```

Check every route in development and production, confirm client components hydrate and keep state
across client navigation, and exercise each action and API route. Remove `next`,
`eslint-config-next`, `next.config.*`, `next-env.d.ts`, and `.next/` only after the Farm build
behaves the same in production.
