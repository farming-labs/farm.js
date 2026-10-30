# Migrate from Next.js to Farm

This document is the complete contract for a coding agent migrating a Next.js App Router project to Farm by hand. Do not run `farm migrate`; follow the procedure below and use the parity reference to rewrite each Next.js feature. Every Farm import path, file convention, and config key here exists in Farm 0.1.14. Status values: `same` (works as-is), `rename` (same concept, change the import or name), `different` (rewrite needed, the row says how), `none` (no Farm equivalent, the row gives the workaround). Pages Router code (`pages/`, `getServerSideProps`, `getStaticProps`, `next/router`, `next/head`) is out of scope: port it to App Router conventions first, then apply this document.

## Ground rules

- Farm's app directory is `src/app`. `@/` resolves to `src/`. `public/` stays at the project root.
- React is built into `@farm.js/core`. A React app installs `@farm.js/core`, `react`, `react-dom`, and `@farm.js/cli` as a devDependency. Do not install a renderer package.
- Farm renders with SSR plus hydration by default. It is not the React Server Components wire format; see [Server and client components](#server-and-client-components).
- Rewrite every `next/*` import in every file of the project (not only `app/`) before the first `pnpm dev`. A single leftover import of `next/link` or `next/navigation` anywhere throws `invariant expected app router to be mounted`.
- Keep `next`, `next.config.*`, and the old files until `pnpm dev`, `pnpm build`, and `pnpm start` all pass.
- Canonical docs: [Routing](/docs/routing), [Layouts](/docs/layouts), [API Routes](/docs/api-routes), [API Client](/docs/api-client), [Rendering](/docs/server-rendering), [Cache and PPR](/docs/cache-ppr), [Middleware](/docs/middleware), [Configuration](/docs/configuration), [Deployment](/docs/deployment), [CLI](/docs/cli).

## Migration procedure

### Prerequisites

- Node.js 22.13 or newer.
- A clean git working tree, so every phase can be diffed and reverted.
- The installed Farm version. Pin one exact version for every `@farm.js/*` package: the current release from `npm view @farm.js/core version`. Under pnpm 11+, `minimumReleaseAge` (24 hours by default) can resolve `latest` to an older Farm right after a release. Pin exact versions and add the exclusion the Farm templates use to `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - "@farm.js/*"
```

### Phase 1: inventory

Run these and keep the output as the checklist for later phases:

```bash
rg -l "from ['\"]next(/[a-z/-]+)?['\"]" --glob '!node_modules' --glob '!.next'
rg -l "['\"]use server['\"]" --glob '!node_modules'
rg -n "export const (runtime|dynamic|revalidate|dynamicParams|fetchCache|preferredRegion|maxDuration|experimental_ppr)" app src
find app src/app -name 'route.*' 2>/dev/null
ls middleware.* proxy.* src/middleware.* src/proxy.* next.config.* postcss.config.* 2>/dev/null
```

Classify each hit with the parity tables. Flag every `route.ts` outside `app/api/` and every `next.config` key. Count the `"use server"` modules, inline server actions, and `<form action={serverAction}>` / `useActionState` call sites, then choose Option A or Option B from the [server actions decision table](#server-actions) now: Option B changes the packages, config file, and scripts used in Phase 2.

### Phase 2: dependencies and config

1. Install Farm: `pnpm add @farm.js/core@<version>` and `pnpm add -D @farm.js/cli@<version>`. Add `zod` if you will use `createEndpoint` schemas or typed env. If you chose server actions Option B, follow its install, `vite.config.ts`, and script steps instead of steps 2 and 3.
2. Replace the scripts (`node .farm/.output/server/index.mjs` matches every Farm template; `farm start` is a local convenience only, because `@farm.js/cli` is a devDependency and hosts that prune devDependencies cannot run it):

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs",
    "type-check": "tsc --noEmit"
  }
}
```

3. Create `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

4. Update `tsconfig.json`: set `"paths": { "@/*": ["./src/*"] }`, remove the `{ "name": "next" }` plugin, set `"jsx": "react-jsx"`, and set `"include": ["src", "farm.config.ts"]` (drop `next-env.d.ts` and `.next/types/**/*.ts`).
5. Add `.farm/` and `.output/` to `.gitignore`.
6. Tailwind v4: Farm enables `@tailwindcss/vite` automatically; install it with `pnpm add -D @tailwindcss/vite`, keep `tailwindcss` installed, and keep `@import "tailwindcss";` in the global CSS. Delete `postcss.config.*` when it only loads `@tailwindcss/postcss`, and remove `@tailwindcss/postcss`. Reason: development always adds Farm's Tailwind plugin, while a production build that finds a project PostCSS config uses it and skips the built-in plugin, so keeping the file makes dev and prod diverge. Remove any Tailwind or Turbopack loader configured in `next.config` (for example `@tailwindcss/turbopack`); `next.config` is not read by Farm.

Verify: `pnpm install` succeeds and `pnpm ls @farm.js/core` prints the pinned version.

### Phase 3: move files

1. If the project uses root `app/`, move it to `src/app/`. Move every other source directory referenced through `@/` (`components/`, `lib/`, `hooks/`, `utils/`, `styles/`, `types/`, ...) under `src/`. When the project already uses `src/app`, nothing moves.
2. Farm writes `src/lib/api.generated.ts` when API routes exist. Merge an existing `lib/` into `src/lib/`; never nest it as `src/lib/lib`.
3. Move `app/favicon.ico`, `app/icon.*`, `app/apple-icon.*`, `app/manifest.json`, and any static `app/sitemap.xml` or `app/robots.txt` into `public/` and declare icons in metadata (see [Metadata](#metadata)).
4. Move `middleware.ts` or `proxy.ts` to `src/app/middleware.ts` (rewritten in Phase 5).
5. Move each `route.ts` outside `app/api/` (for example `app/feed.xml/route.ts`, `app/auth/callback/route.ts`) out of `src/app` and register it with `defineRoutes` (see [Route handlers](#route-handlers)). Farm only discovers `route.ts` under `src/app/api/`.

Verify: `rg -n "from ['\"]@/" src | head` paths resolve to files under `src/`.

### Phase 4: remove dev blockers, then first run

Apply these rewrites to every file before starting the dev server. Each one is a hard failure:

| Leftover                                      | Symptom                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `next/font/google` in a layout                | Every page returns 500 in dev: `Named export ... not found ... CommonJS module`.            |
| `import Image from "next/image"`              | Render error: `Element type is invalid ... got: object`.                                    |
| `next/link` or `next/navigation` in any file  | `invariant expected app router to be mounted`.                                              |
| `next/server` in a route handler              | Dev works, but the production server crashes at startup with `ERR_AMBIGUOUS_MODULE_SYNTAX`. |
| Global `PageProps<"/x">` / `LayoutProps<"/">` | Type errors: Next's generated globals do not exist. Import them from `@farm.js/core`.       |
| `export const runtime = "nodejs"`             | Accepted as an alias for `"node"`.                                                          |

Then run `pnpm dev` (port 3000 by default). Verify every route: request each URL from the route inventory and check the status code (200 for pages, 404 for unknown paths, the expected status for API routes and redirects). In a browser, check that client components hydrate, respond to events, and keep their state across client-side navigation between pages that share a layout.

### Phase 5: port behavior

Work through the parity sections: server actions, route handlers, middleware, metadata, caching and rendering exports, env vars, `next.config`. Run `pnpm exec farm generate` after adding or moving routes so `src/farm.d.ts` and `src/lib/api.generated.ts` are current. Use `pnpm exec farm explain /some/path` to see which files and rendering mode serve a URL, and `pnpm exec farm doctor --offline` for project checks.

Verify after each feature: the affected routes in `pnpm dev`, then `pnpm exec tsc --noEmit`.

### Phase 6: production

```bash
pnpm build
pnpm start
pnpm exec tsc --noEmit
```

Build output is `.farm/.output` for the default Node target. Repeat the route checks against `pnpm start`. A start script of `node .output/server/index.mjs` is wrong for the default target.

### Phase 7: remove Next.js

Only after Phases 4 to 6 pass: remove `next`, `eslint-config-next` (and `eslint.config.*` if it only extends it), `@tailwindcss/postcss`, `next.config.*`, `next-env.d.ts`, `.next/`, and any `@next/*` packages. Run `rg -n "from ['\"]next" src` (must be empty), then Phase 6 again.

### Failure symptoms and recovery

| Symptom                                                                                    | Cause                                                                                        | Recovery                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@/...` import cannot be resolved                                                          | Directory not moved under `src/` or old tsconfig paths                                       | Move it under `src/`; set `"@/*": ["./src/*"]`.                                                                                                                  |
| `createServerFn handlers run only on the server, but ... is being bundled into the client` | A client component imports a module that defines a server function                           | Option A: expose it through an API route and call `apiClient`. Option B: add the `@farm.js/plugin/rsc` setup; never set `experimental.serverActions` without it. |
| `Dynamic SSG route "..." requires getStaticPaths export`                                   | A dynamic route opted into static rendering without a param list                             | Export `generateStaticParams` or `getStaticPaths`, or make the route dynamic.                                                                                    |
| 404 for a URL served by a `route.ts`                                                       | Handler lives outside `src/app/api/`                                                         | Register it with `defineRoutes` in `src/routes.ts`.                                                                                                              |
| Catch-all page throws `slug.map is not a function`                                         | Page catch-all params are one `/`-joined string in Farm                                      | `params.slug.split("/")`.                                                                                                                                        |
| `use()` throws on `params` in a client component                                           | Farm passes `params` as a plain object                                                       | Read `params` directly.                                                                                                                                          |
| `process is not defined` or `undefined` public env in the browser                          | `process.env.NEXT_PUBLIC_*` in client code                                                   | Use typed public env (see [Environment variables](#environment-variables)).                                                                                      |
| Client component not interactive and a server log warning names it                         | Async page or layout passes JSX children to it, or it comes from a package                   | Make the parent synchronous, or pass serializable props instead of JSX children.                                                                                 |
| Server-only module (db, fs) pulled into the client build                                   | Synchronous page or layout that imports a `"use client"` component hydrates as a whole route | Make that page `async`, or move the server work into an async component.                                                                                         |
| `farm start` fails on the host                                                             | devDependencies pruned                                                                       | Use `node .farm/.output/server/index.mjs`.                                                                                                                       |
| pnpm installs an older Farm than requested                                                 | `minimumReleaseAge`                                                                          | Pin exact versions and add `minimumReleaseAgeExclude`.                                                                                                           |

## Parity reference

### Routing files

Docs: [/docs/routing](/docs/routing), [/docs/layouts](/docs/layouts).

| Next.js                            | Farm                                                   | Status      | Notes                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                     | `src/app/page.tsx`                                     | `same`      | Also `page.md` and `page.mdx`.                                                                                                                                                                 |
| `app/layout.tsx` (root)            | `src/app/layout.tsx`                                   | `same`      | A full `<html><body>` layout works, as in the Farm templates; Farm adds the charset and viewport `<meta>` tags unless the layout writes them. Or return a fragment and let Farm own the shell. |
| Nested `layout.tsx`                | Same file                                              | `same`      | Props: `children`, `params`. Use `LayoutProps` from `@farm.js/core`.                                                                                                                           |
| `loading.tsx`                      | Same file                                              | `same`      | Suspense fallback. Props type `LoadingProps`.                                                                                                                                                  |
| `error.tsx`                        | Same file, keep `"use client"`                         | `same`      | Props `error` (typed `unknown`), `reset`. Type `ErrorProps`.                                                                                                                                   |
| Root `not-found.tsx`               | `src/app/not-found.tsx`                                | `same`      | Or `notFound: { component: "./src/ui/not-found.tsx" }` in config.                                                                                                                              |
| Nested `not-found.tsx`             | Root `not-found` only                                  | `different` | Farm resolves only `src/app/not-found.*`. Move segment-specific UI into the page (render it when data is missing).                                                                             |
| `global-error.tsx`                 | None                                                   | `none`      | Use a root `src/app/error.tsx`; failures before page selection use the root boundary.                                                                                                          |
| `template.tsx`                     | None                                                   | `none`      | In a `"use client"` wrapper in the layout, render `<div key={usePathname()}>{children}</div>` to remount per navigation.                                                                       |
| `default.tsx`                      | Same file in an `@slot`                                | `same`      | Rendered when no slot page matches.                                                                                                                                                            |
| `(group)` folders                  | Same                                                   | `same`      | Not supported under `src/app/api/`; flatten API route groups. Keep one root `src/app/layout.tsx`.                                                                                              |
| `_private` folders                 | Same                                                   | `same`      | Only `page.*` creates a route, so component folders never become URLs.                                                                                                                         |
| `[id]`                             | Same                                                   | `same`      | `params.id` is a string.                                                                                                                                                                       |
| `[...slug]` page                   | Same folder                                            | `different` | `params.slug` is a single `/`-joined string, not `string[]`. Use `params.slug.split("/")`. API route catch-alls stay arrays.                                                                   |
| `[[...slug]]` page                 | Same folder                                            | `different` | Same string shape; the empty capture is `""`.                                                                                                                                                  |
| `@slot` parallel routes            | Same                                                   | `same`      | The layout receives the slot as a prop named after it.                                                                                                                                         |
| `(.)`, `(..)`, `(..)(..)`, `(...)` | Same markers inside a slot                             | `same`      | Hard navigation renders the canonical page.                                                                                                                                                    |
| `route.ts` under `app/api/`        | `src/app/api/**/route.ts`                              | `same`      | See [Route handlers](#route-handlers).                                                                                                                                                         |
| `route.ts` anywhere else           | `defineRoutes` in `src/routes.ts`                      | `different` | `api("/feed.xml", { GET })`; paths may carry file extensions.                                                                                                                                  |
| `instrumentation.ts`               | `src/instrumentation.ts` exporting `register(context)` | `same`      | `@vercel/otel` becomes `@farm.js/otel`. See [/docs/observability](/docs/observability).                                                                                                        |

Typed props: import `PageProps`, `LayoutProps`, `LoadingProps`, `ErrorProps`, `MetadataProps`, `GenerateStaticParams` from `@farm.js/core`; each takes an optional route literal such as `PageProps<"/users/[id]">`.

| Prop                       | Farm runtime value          | Type in Farm                                               | What to change                                                                                                             |
| -------------------------- | --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `params` (page, layout)    | Plain object                | `{ id: string }` (not a Promise)                           | `await params` keeps working at runtime. Remove `Promise<...>` annotations and `use(params)`; prefer `params.id` directly. |
| `searchParams` (page)      | `Promise` of a plain object | `Promise<Record<string, string \| string[] \| undefined>>` | `same`: keep `await searchParams`. A synchronous copy is also passed as `search`.                                          |
| Route handler `ctx.params` | `Promise` of params         | (untyped second argument)                                  | `same`: keep `const { id } = await ctx.params`.                                                                            |

```tsx
// Before (Next.js 16)
export default async function Page({ params }: PageProps<"/blog/[...slug]">) {
  const { slug } = await params;
  return <h1>{slug.join(" / ")}</h1>;
}

// After (Farm)
import type { PageProps } from "@farm.js/core";

export default function Page({ params }: PageProps<"/blog/[...slug]">) {
  return <h1>{params.slug.split("/").join(" / ")}</h1>;
}
```

### Route handlers

Docs: [/docs/api-routes](/docs/api-routes).

| Next.js                                    | Farm                                               | Status                                                                                                         |
| ------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `export async function GET(request, ctx)`  | Same signature in `src/app/api/**/route.ts`        | `same`                                                                                                         |
| `NextRequest`                              | Standard `Request`                                 | `different`                                                                                                    |
| `request.nextUrl`                          | `new URL(request.url)`                             | `different`                                                                                                    |
| `request.cookies.get(name)`                | `cookies().get(name)` from `@farm.js/core/headers` | `rename`                                                                                                       |
| `NextResponse.json(data, init)`            | `Response.json(data, init)`                        | `different`                                                                                                    |
| `NextResponse.redirect(url)`               | `Response.redirect(url, 307)`                      | `different`                                                                                                    |
| `response.cookies.set(...)`                | `Set-Cookie` header on the returned `Response`     | `different`                                                                                                    |
| `request.ip`, `request.geo`, `userAgent()` | None                                               | `none`: read the platform headers (`x-forwarded-for`) and set `server.trustProxy` only behind a trusted proxy. |
| Validated input                            | `createEndpoint` from `@farm.js/core/api`          | Farm addition                                                                                                  |
| `HEAD`, `OPTIONS`, `QUERY` exports         | Same                                               | `same`                                                                                                         |

Do not leave any `next/server` import in a route handler: development still works, but the production server crashes at startup.

```ts
// Before: app/api/hello/route.ts
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") ?? "world";
  return NextResponse.json({ message: `Hello ${name}` });
}

// After: src/app/api/hello/route.ts
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "world";
  return Response.json({ message: `Hello ${name}` });
}
```

A handler outside `/api` (feeds, OAuth callbacks) moves to `src/routes.ts`:

```ts
import { defineRoutes } from "@farm.js/core";
import { renderFeed } from "./lib/feed";

export default defineRoutes(({ api }) => [
  api("/feed.xml", {
    GET: async () =>
      new Response(await renderFeed(), { headers: { "content-type": "application/rss+xml" } }),
  }),
]);
```

### Server actions

Docs: [/docs/api-routes](/docs/api-routes), [/docs/api-client](/docs/api-client), [/docs/routing#route-actions](/docs/routing#route-actions), [/docs/configuration#server-action-security](/docs/configuration#server-action-security), [/docs/stability](/docs/stability).

Farm supports two ways to port Next.js server actions. Pick one per app before Phase 2, because Option B changes the app's build pipeline.

| Option                         | How actions work                                                                                                                      | Stability                                                                                                    | Pick it when                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A: API routes as actions       | Each action becomes a `createEndpoint` route under `src/app/api/`; client code calls it through the typed `apiClient`.                | Stable default. No extra packages; runs on `farm dev` / `farm build`.                                        | Most apps: a handful of actions, forms that can call a client function, or any app that should stay on Farm's stable path.                                                                             |
| B: server functions as actions | `createServerFn` exports (or plain `"use server"` module exports) become React server references called through Farm's RSC transport. | Experimental: "React Server Components" and "Server Actions under RSC" are outside Farm's stability promise. | The app relies heavily on `"use server"` actions, `<form action={serverAction}>`, `useActionState` with server actions, or RSC-only patterns, and you accept running on the experimental RSC pipeline. |

#### Option A: API routes as actions

| Next.js                                          | Farm (Option A)                                                                                                                           | Status        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `"use server"` module of actions                 | `createEndpoint` handlers in `src/app/api/**/route.ts`; optional `createServerFn` from `@farm.js/core/server-fn` for shared server logic  | `different`   |
| Inline `"use server"` function in a component    | Same endpoint approach                                                                                                                    | `different`   |
| Calling an action from a client component        | `apiClient.<path>.<method>(...)` from `src/lib/api.ts`                                                                                    | `different`   |
| Calling an action from a server component        | `api.<path>.<method>(...)` (local dispatch) or call the `createServerFn` directly                                                         | `different`   |
| `<form action={serverAction}>`                   | `<form action={clientFn}>` where `clientFn` calls `apiClient`, or `useFetcher(...).Form`                                                  | `different`   |
| `useActionState`                                 | Same React hook from `react`, given a client function                                                                                     | `same`        |
| `useFormStatus`, `useOptimistic`                 | Same React hooks                                                                                                                          | `same`        |
| Pending/optimistic state without React 19 hooks  | `useMutation` or `useFetcher` from `@farm.js/core/client`                                                                                 | Farm addition |
| Progressive enhancement (works without JS)       | `useFetcher(apiClient.x.post).Form`: before hydration the form posts natively to the endpoint URL and the browser shows that response     | `different`   |
| `redirect()` inside an action                    | Client: `router.push()` after success. Native form post: return `Response.redirect(new URL("/x", request.url), 303)` from a plain handler | `different`   |
| `cookies().set()` / `.delete()` inside an action | `Set-Cookie` header on the endpoint `Response`                                                                                            | `different`   |
| `revalidatePath`, `revalidateTag`, `updateTag`   | Same names from `@farm.js/core/cache`; or declare `invalidates` on the endpoint                                                           | `rename`      |
| Automatic page refresh after an action           | Call `router.refresh()` (from `@farm.js/core/navigation`) after success                                                                   | `different`   |

Before (Next.js):

```ts
// app/actions.ts
"use server";
import { revalidatePath } from "next/cache";

export async function createTodo(_prev: { error?: string }, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Title is required" };
  await db.todo.create({ data: { title } });
  revalidatePath("/todos");
  return {};
}
```

After (Option A), the endpoint:

```ts
// src/app/api/todos/route.ts
import { createEndpoint } from "@farm.js/core/api";
import { revalidatePath } from "@farm.js/core/cache";
import { z } from "zod";

export const POST = createEndpoint(
  { body: z.object({ title: z.string().trim().min(1, "Title is required") }) },
  async ({ body }) => {
    const todo = await db.todo.create({ data: { title: body.title } });
    await revalidatePath("/todos");
    return todo;
  },
);
```

The shared callers (create once; `api.generated.ts` appears after `farm dev` or `farm generate`):

```ts
// src/lib/api.ts
import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
```

The client component keeps `useActionState`, with a client function as the action:

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

Dynamic API segments bind through `params`: `src/app/api/todos/[id]/route.ts` exporting `PATCH` is called as `apiClient.todos.patch({ params: { id }, body })`. Authorize the user inside every endpoint; endpoint `middleware` arrays run for both `api` and `apiClient` calls.

#### Option B: server functions as actions

The only supported way to make server functions callable from the browser is Farm's React Server Components pipeline. Turn it on in `farm.config.ts` with `experimental.serverComponents: true`: `farm dev`, `farm build`, and `farm start` then run it on the official `@vitejs/plugin-rsc`, and pages and layouts are server components, as in Next.js. `experimental.serverActions: true` without `serverComponents` does not load that pipeline and turns off the build check that stops a client component from bundling a `createServerFn` module, so server code and its imports reach the browser. Never set it alone.

Install (the RSC pipeline refuses to start unless these exact versions resolve; pin React to them even if the Next.js app used another 19.x release):

```bash
pnpm add @farm.js/core@<version> react@19.2.8 react-dom@19.2.8 react-server-dom-webpack@19.2.8 zod
pnpm add -D @farm.js/plugin@<version> @vitejs/plugin-rsc@0.5.32 @vitejs/plugin-react vite
```

Enable it in `farm.config.ts` (routes stay in `src/app`):

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
    serverActions: true,
  },
  serverActions: {
    allowedOrigins: [],
    bodySizeLimit: "1mb",
  },
});
```

Keep the Phase 2 scripts. Vite plugins and options stay under `vite`, and Tailwind is enabled as in other Farm apps. `@vitejs/plugin-react` is optional and adds Fast Refresh. The pipeline does not run `auth`, `integrations`, Farm `plugins`, `storage`, `schema`, `cron`, `workflows`, `docs`, `theme`, `routeRules`, `context`, `redirects`, `rewrites`, `headers`, or `observability` yet; `farm dev` and `farm build` warn about any the app sets.

| Next.js                                           | Farm (Option B)                                                                                                                                                       | Status                                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `"use server"` module exporting async functions   | Same module; change `next/*` imports to their Farm entries. Exported plain async functions in a server module are callable from client components                     | `rename`                                                                                                                         |
| Typed, validated actions                          | `export const x = createServerFn({ input, handler })` from `@farm.js/core/server-fn`. Farm adds the `"use server"` directive to modules with such exports             | Farm addition                                                                                                                    |
| Inline `"use server"` function inside a component | Move it to a server module                                                                                                                                            | `different`                                                                                                                      |
| Calling from a client component                   | Import the server function and call it, or wrap it: `useAction(fn)` from `@farm.js/core/client` (`pending`, `status`, `data`, `error`, `formAction`, `Form`, `reset`) | `same`                                                                                                                           |
| `<form action={serverAction}>`                    | `<form action={createTodo}>` with the imported server function, or `<form action={action.formAction}>` / `<action.Form>` from `useAction(fn)` for tracked state       | `same`                                                                                                                           |
| `useActionState(serverAction, initial)`           | `useActionState` with a plain `async (prevState, formData)` export from a server module; a `createServerFn` takes one argument, so wrap it                            | `different`                                                                                                                      |
| `useFormStatus`, `useOptimistic`                  | Same React hooks; `useAction(fn, { optimistic })` also exists                                                                                                         | `same`                                                                                                                           |
| Progressive enhancement                           | Pass the server function itself as the form `action`; the RSC entry decodes native form posts (`decodeAction`) and runs the action before hydration                   | `same`                                                                                                                           |
| `redirect()` inside an action                     | `redirect()` from `@farm.js/core/navigation`; JS calls navigate on the client, native form posts get an HTTP redirect                                                 | `rename`                                                                                                                         |
| Reading cookies or headers inside an action       | The handler's `request` argument (`request.headers.get("cookie")`)                                                                                                    | `different`                                                                                                                      |
| `cookies().set()` / `.delete()` inside an action  | None                                                                                                                                                                  | `none`: set cookies in middleware (`context.cookies.set`) or move that action to an Option A endpoint that returns `Set-Cookie`. |
| `revalidatePath`, `revalidateTag`, `updateTag`    | Same names from `@farm.js/core/cache`, or declare `invalidates: ({ input, result }) => [{ path }, { tag }, { key }]` (applied after success)                          | `rename`                                                                                                                         |
| Route-scoped actions                              | `createRoute(path, { actions: { update }, defaultAction: "update" })` from `@farm.js/core/routes`, then `useAction(Route)`                                            | Farm addition                                                                                                                    |
| `serverActions.allowedOrigins`, `bodySizeLimit`   | Same keys in `farm.config.ts`; cross-origin requests are rejected (403), bodies over 1 MB return 413                                                                  | `rename`                                                                                                                         |

Rules for server modules: export each server function inline (`export const x = createServerFn(...)`; re-exporting one is a build error), never define them in a `"use client"` file, and authorize the user inside every handler because each action is a public endpoint.

Before (Next.js):

```ts
// app/todos/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createTodo(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required");
  await db.todo.create({ data: { title } });
  revalidatePath("/todos");
  redirect("/todos");
}
```

After (Option B):

```ts
// src/features/todos/actions.ts (no directive needed)
import { revalidatePath } from "@farm.js/core/cache";
import { redirect } from "@farm.js/core/navigation";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

export const createTodo = createServerFn({
  input: z.object({ title: z.string().trim().min(1, "Title is required") }),
  async handler({ input }) {
    await db.todo.create({ data: { title: input.title } });
    await revalidatePath("/todos");
    redirect("/todos");
  },
});
```

```tsx
"use client";
import { useAction } from "@farm.js/core/client";
import { createTodo } from "@/features/todos/actions";

export function TodoForm() {
  const create = useAction(createTodo);
  return (
    <create.Form>
      <input name="title" />
      <button disabled={create.pending}>Add</button>
      {create.error ? <p role="alert">{create.error.message}</p> : null}
    </create.Form>
  );
}
```

Form fields are converted to an object and validated by `input` before the handler runs. Server code calls the same function directly: `await createTodo({ title })`.

### Data fetching and caching

Docs: [/docs/cache-ppr](/docs/cache-ppr), [/docs/server-queries](/docs/server-queries).

| Next.js                                                   | Farm                                                                         | Status      | Notes                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `async` page/layout fetching data                         | Same                                                                         | `same`      | An async page stays server-only; its client components hydrate as islands.                              |
| `fetch(url, { next: { revalidate, tags } })`              | `unstable_cache` or `getFarmDataCache().getOrSet` from `@farm.js/core/cache` | `none`      | Farm does not patch `fetch`; the `next` option is ignored. `cache: "no-store"` is already the behavior. |
| `unstable_cache(fn, keyParts, { tags, revalidate })`      | Same name from `@farm.js/core/cache`                                         | `rename`    | List every captured variable that is not an argument in `keyParts`.                                     |
| `"use cache"`, `cacheLife`, `cacheTag`, `cacheComponents` | `unstable_cache` with `tags` and `revalidate`                                | `none`      | Remove the directives.                                                                                  |
| `cache()` from `react`                                    | `createServerQuery` from `@farm.js/core/server-query`, or `unstable_cache`   | `different` | `cache` is a React Server Components API; do not rely on it to deduplicate on Farm's default SSR path.  |
| `revalidatePath`, `revalidateTag`, `updateTag`            | Same names from `@farm.js/core/cache`                                        | `rename`    | `invalidate(key)` also exists for structured keys.                                                      |
| `unstable_noStore()`, `connection()`                      | `export const dynamic = "force-dynamic"`                                     | `none`      | Pages are dynamic by default.                                                                           |
| `import "server-only"`                                    | Remove; use `createServerOnlyFn` from `@farm.js/core/environment`            | `different` | Farm's default SSR does not resolve the `react-server` condition the package relies on.                 |

```ts
// Before
const res = await fetch("https://api.example.com/products", {
  next: { revalidate: 300, tags: ["products"] },
});

// After
import { unstable_cache } from "@farm.js/core/cache";

const getProducts = unstable_cache(
  async () => (await fetch("https://api.example.com/products")).json(),
  ["products"],
  { tags: ["products"], revalidate: 300 },
);
```

### Rendering exports

Docs: [/docs/server-rendering](/docs/server-rendering), [/docs/route-runtime](/docs/route-runtime).

| Next.js                                                                         | Farm                                                                                                  | Status      | Notes                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic static rendering                                                      | Dynamic by default; `farm build` reports static candidates                                            | `different` | Add `export const dynamic = "force-static"` to pages that were static in Next.                                                                             |
| `export const dynamic = "force-static" \| "force-dynamic" \| "error" \| "auto"` | Same                                                                                                  | `same`      | A static route that reads request APIs stays dynamic with a warning.                                                                                       |
| `export const revalidate = N`                                                   | Same (ISR)                                                                                            | `same`      | A positive value also opts the route into static generation.                                                                                               |
| `generateStaticParams`                                                          | Same export (deprecated alias of `getStaticPaths`)                                                    | `different` | Only used when the route is static (`dynamic = "force-static"`, `revalidate > 0`, or `ssg = true`). Catch-all params may be arrays.                        |
| `dynamicParams = false`                                                         | None                                                                                                  | `none`      | Call `notFound()` for unknown params.                                                                                                                      |
| `fetchCache`                                                                    | None                                                                                                  | `none`      | Delete it.                                                                                                                                                 |
| `runtime = "nodejs"`                                                            | `runtime = "node"`                                                                                    | `rename`    | `"nodejs"` is accepted as an alias.                                                                                                                        |
| `runtime = "edge"`                                                              | Same value                                                                                            | `different` | Only valid on edge presets (`cloudflare-module`, `netlify-edge`). The `vercel` target emits Node functions and the build fails. Use `"auto"` or delete it. |
| `preferredRegion`                                                               | `regions`                                                                                             | `rename`    | Provider-specific identifiers.                                                                                                                             |
| `maxDuration`                                                                   | Same                                                                                                  | `same`      | Seconds.                                                                                                                                                   |
| PPR (`experimental_ppr`, `cacheComponents`)                                     | `experimental: { ppr: true }` in config plus `export const experimental_ppr = true` (or `ppr = true`) | `different` | Route opt-ins are inert without the config flag.                                                                                                           |
| Streaming with `<Suspense>`                                                     | Same                                                                                                  | `same`      |                                                                                                                                                            |

### Server and client components

Docs: [/docs/server-rendering](/docs/server-rendering), [/docs/configuration#isolated-client-hydration](/docs/configuration#isolated-client-hydration).

| Next.js                                                        | Farm                                                          | Status      | Notes                                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server components by default (RSC)                             | SSR with automatic hydration detection                        | `different` | A route ships page JavaScript only when its page or layout is `"use client"`, imports a `"use client"` module, or exports `hydrate = true`. Pages with no client boundary ship no route JavaScript. |
| `"use client"`                                                 | Same directive                                                | `same`      | Required on components that use hooks or browser APIs.                                                                                                                                              |
| Sync server page importing a client component                  | Hydrates as a whole route                                     | `different` | The page module runs in the browser too. Keep data access in `async` pages or components, or opt into `experimental.isolatedClientHydration: "enabled"`.                                            |
| Async page rendering client components                         | Server-only page, each client component hydrates as an island | `same`      | Props must be serializable. JSX passed as `children` or props does not cross the boundary, and package client components (for example icon libraries) render as static HTML.                        |
| Async root layout wrapping `<Providers>{children}</Providers>` | Not interactive                                               | `different` | Make the layout synchronous; load request data in middleware (`context.set`) and read it with `getMiddlewareContext()` from `@farm.js/core/middleware`.                                             |
| RSC wire format                                                | `@farm.js/plugin/rsc` `defineConfig` in `vite.config.ts`      | `different` | Experimental; adopt it only through server actions Option B.                                                                                                                                        |
| `useServerInsertedHTML` (CSS-in-JS registries)                 | None                                                          | `none`      | Remove the registry; prefer CSS, CSS modules, or Tailwind.                                                                                                                                          |

### Metadata

Docs: [/docs/routing#metadata-and-og-images](/docs/routing#metadata-and-og-images).

| Next.js                                                   | Farm                                     | Status      | Notes                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import type { Metadata, MetadataRoute } from "next"`     | `from "@farm.js/core"`                   | `rename`    |                                                                                                                                                                  |
| `export const metadata`, `generateMetadata`               | Same exports                             | `same`      | `title.default`/`template`, `metadataBase`, `openGraph`, `twitter`, `robots`, `alternates`, `icons`, `manifest`, `verification`, `other`, `keywords`, `authors`. |
| `title.absolute`                                          | `title.absolute`                         | `keep`      | Names the page as written, past any parent template.                                                                                                             |
| `viewport`, `generateViewport`, `themeColor`              | `viewport`, `generateViewport`           | `same`      | Merged from root layout to page over the default `width=device-width, initial-scale=1`, with `themeColor` and `colorScheme`, as in Next.                         |
| `app/favicon.ico`, `icon.*`, `apple-icon.*`               | Files in `public/` plus `metadata.icons` | `different` | `icons: { icon: "/favicon.ico", apple: "/apple-icon.png" }` in the root layout.                                                                                  |
| `opengraph-image.png`, `twitter-image.png` (+ `.alt.txt`) | Same files                               | `same`      |                                                                                                                                                                  |
| `opengraph-image.tsx`, `twitter-image.tsx`                | Same files                               | `rename`    | Return plain JSX (preferred) or keep `new ImageResponse(...)` imported from `@farm.js/core/og`. `params` is a plain object.                                      |
| `sitemap.ts`, `robots.ts`, `manifest.ts`                  | Same files                               | `same`      | Static `manifest.json`, `sitemap.xml`, `robots.txt` move to `public/`.                                                                                           |
| `generateSitemaps`                                        | None                                     | `none`      | Nested `sitemap.ts` files per segment, or one sitemap.                                                                                                           |

### Navigation APIs

Docs: [/docs/routing#typed-navigation](/docs/routing#typed-navigation).

| Next.js                                   | Farm                                                                        | Status      | Notes                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import Link from "next/link"`            | `import { Link } from "@farm.js/core/client"`                               | `rename`    | Named export. `prefetch`, `replace`, `scroll` work. `href` must be a string; an object `href` becomes `href` plus the `query` prop. `as`, `legacyBehavior`, `passHref` do not exist. Hrefs are type-checked; set `suppressLintOnLink: true` only as a temporary escape. |
| `useRouter` from `next/navigation`        | `useRouter` from `@farm.js/core/navigation`                                 | `rename`    | `push(href)`, `replace(href)`, `back()`, `forward()`, `refresh()`, `prefetch(href)`. For `{ scroll: false }` use `navigateTo(href, { scroll: false })` from `@farm.js/core/client`.                                                                                     |
| `usePathname`, `useSearchParams`          | Same names from `@farm.js/core/navigation`                                  | `rename`    | No Suspense wrapper needed for `useSearchParams`.                                                                                                                                                                                                                       |
| `useParams`                               | `useRouter({ routes: ["/users/[id]"] }).params` from `@farm.js/core/client` | `different` | Or pass `params` from the page as props.                                                                                                                                                                                                                                |
| `useSelectedLayoutSegment(s)`             | None                                                                        | `none`      | Derive from `usePathname().split("/")`.                                                                                                                                                                                                                                 |
| `redirect(url)`, `permanentRedirect(url)` | Same names from `@farm.js/core/navigation`                                  | `rename`    | Second argument is an HTTP status (default 307), not `RedirectType`; remove `RedirectType`.                                                                                                                                                                             |
| `notFound()`                              | Same name from `@farm.js/core/navigation`                                   | `rename`    |                                                                                                                                                                                                                                                                         |
| `forbidden()`, `unauthorized()`           | None                                                                        | `none`      | In pages, `redirect("/sign-in")` or `notFound()`; in API routes and middleware return a 401 or 403 `Response`.                                                                                                                                                          |
| `next/form` `<Form>`                      | `<form>` or `useFetcher(...).Form`                                          | `none`      |                                                                                                                                                                                                                                                                         |

### Request APIs

| Next.js                                   | Farm                                                                     | Status      | Notes                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------- |
| `cookies()` read (`get`, `getAll`, `has`) | `cookies()` from `@farm.js/core/headers`                                 | `rename`    | Synchronous; `await cookies()` still works. Use in pages, layouts, and API routes.                |
| `cookies().set()`, `.delete()`            | Middleware `context.cookies.set/delete`, or `Set-Cookie` on a `Response` | `different` | Not available while rendering a page.                                                             |
| `headers()`                               | `headers()` from `@farm.js/core/headers`                                 | `rename`    | Read-only, synchronous.                                                                           |
| `draftMode()`                             | None                                                                     | `none`      | Use a cookie checked in middleware and `export const dynamic = "force-dynamic"` on preview pages. |
| `after()` from `next/server`              | `after()` from `@farm.js/core/after`                                     | `rename`    | Docs: [/docs/after](/docs/after).                                                                 |

### Middleware and proxy

Docs: [/docs/middleware](/docs/middleware).

| Next.js                                                       | Farm                                                                                       | Status        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| `middleware.ts` (Next 15) or `proxy.ts` (Next 16) at the root | `src/app/middleware.ts` exporting `middleware(request, context)`                           | `different`   |
| `export const config = { matcher }`                           | Same export; strings like `/dashboard/:path*`, `RegExp`, or functions                      | `different`   |
| Regex string matchers like `/((?!api\|_next).*)`              | A `RegExp` matcher such as `/^\/(?!api\/).*/`; Farm rejects the string at startup          | `different`   |
| `NextResponse.next()`                                         | Return nothing                                                                             | `different`   |
| `NextResponse.redirect(url)`                                  | `return Response.redirect(new URL("/login", request.url), 307)` or `context.redirect(url)` | `different`   |
| `NextResponse.rewrite(url)`                                   | `context.rewrite("/path")`                                                                 | `different`   |
| Response cookies / headers                                    | `context.cookies.set(name, value, options)`, `context.headers.set(name, value)`            | `different`   |
| Request data for pages                                        | `context.set(key, value)` (server-only) or `context.data.set` (serializable)               | Farm addition |
| Per-folder middleware                                         | `src/app/<segment>/middleware.ts`                                                          | Farm addition |

```ts
// Before: proxy.ts (Next 16)
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.get("session")) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}
export const config = { matcher: ["/dashboard/:path*"] };

// After: src/app/middleware.ts
import type { RequestMiddlewareContext } from "@farm.js/core/middleware";

export const config = { matcher: ["/dashboard/:path*"] };

export async function middleware(request: Request, context: RequestMiddlewareContext) {
  if (!context.cookies.get("session")) {
    return Response.redirect(new URL("/login", request.url), 307);
  }
}
```

### Built-in components and modules

| Next.js                          | Farm                                                                                                                | Status      | Docs                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `next/image`                     | `import Image from "@farm.js/core/image"`                                                                           | `rename`    | [/docs/images](/docs/images)                              |
| `next/font/local`                | `localFont` from `@farm.js/core/font`                                                                               | `rename`    | [/docs/fonts](/docs/fonts)                                |
| `next/font/google`               | `localFont` with a font package, `remoteFont` with a direct font-file URL, or `@fontsource*` CSS imports            | `different` | [/docs/fonts](/docs/fonts)                                |
| `next/script`                    | `defineScript` from `@farm.js/scripts/client` plus the `scripts()` plugin, or a plain `<script>` in the root layout | `different` | [/docs/plugins/scripts](/docs/plugins/scripts)            |
| `next/dynamic`                   | `React.lazy` plus `<Suspense>`                                                                                      | `different` |                                                           |
| `next/og` `ImageResponse`        | `ImageResponse` from `@farm.js/core/og`; install `@vercel/og`                                                       | `rename`    | Node presets only; not edge or Cloudflare Worker presets. |
| `next/headers`                   | `@farm.js/core/headers`                                                                                             | `rename`    |                                                           |
| `next/cache`                     | `@farm.js/core/cache`                                                                                               | `rename`    |                                                           |
| `next/config`, `next/web-vitals` | None                                                                                                                | `none`      | Use typed env; use the `web-vitals` package directly.     |

`next/image`: props `src`, `alt`, `width`, `height`, `fill`, `sizes`, `quality`, `placeholder="blur"`, `blurDataURL`, `unoptimized`, `loader` carry over. Rename `priority` to `preload`. Static imports carry dimensions and blur data. SVG sources skip optimization. Remote hosts need `images.remotePatterns` in `farm.config.ts`.

`next/font`, before and after for the default `create-next-app` layout (`pnpm add geist`):

```tsx
// Before
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "Create Next App" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
```

```tsx
// After: src/app/layout.tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import { localFont } from "@farm.js/core/font";
import "./globals.css";

const geistSans = localFont({
  src: "geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  family: "Geist Sans",
  weight: "100 900",
  variable: "--font-geist-sans",
  fallback: ["system-ui", "sans-serif"],
});
const geistMono = localFont({
  src: "geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  family: "Geist Mono",
  weight: "100 900",
  variable: "--font-geist-mono",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = { title: "Create Next App", icons: "/favicon.ico" };

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
```

Farm adds the charset and viewport tags to a root layout's own `<html>` document, as Next does, unless the layout writes them; the `viewport` export sets the viewport tag. `localFont` options must be static and assigned at module scope; `family` is required.

`next/dynamic` with `ssr: false`:

```tsx
"use client";
import { lazy, Suspense, useEffect, useState } from "react";

const Chart = lazy(() => import("./chart"));

export function ClientChart() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? (
    <Suspense fallback={<p>Loading chart</p>}>
      <Chart />
    </Suspense>
  ) : null;
}
```

`next/script` strategies map to `load` values: `beforeInteractive` to `"immediate"`, `afterInteractive` to `"after-hydration"` (default), `lazyOnload` to `"idle"`. `@farm.js/scripts` is versioned independently of core (0.1.0-beta.15 at the time of writing).

### Environment variables

Docs: [/docs/environment-functions](/docs/environment-functions), [/docs/deployment#environment-variables](/docs/deployment#environment-variables).

| Next.js                                    | Farm                                                                                                | Status      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------- |
| `.env`, `.env.local`, `.env.[mode]`        | Same files, loaded into `process.env` for `farm dev` and `farm build`                               | `same`      |
| `process.env.SECRET` in server code        | Same                                                                                                | `same`      |
| `process.env.NEXT_PUBLIC_*` in client code | `env.public` schema in `farm.config.ts` plus `getPublicEnv` or `publicEnv` from `@farm.js/core/env` | `different` |
| `next.config` `env`                        | `env.server` / `env.public`                                                                         | `different` |

Farm does not inline `process.env.*` into browser bundles. Declare public values once; the key name may stay `NEXT_PUBLIC_*`:

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { z } from "zod";

export default defineConfig({
  env: {
    server: { DATABASE_URL: z.string() },
    public: { NEXT_PUBLIC_API_URL: z.string().url() },
  },
});
```

```tsx
"use client";
import { getPublicEnv } from "@farm.js/core/env";

const apiUrl = getPublicEnv("NEXT_PUBLIC_API_URL");
```

Server code can use `getEnv("DATABASE_URL")` from the same entry. Production servers read the host's environment at runtime; do not rely on `.env` files there.

### next.config

Docs: [/docs/configuration](/docs/configuration).

| `next.config` key                                                                                              | Farm `farm.config.ts`                          | Status      | Notes                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redirects()`                                                                                                  | `redirects()`                                  | `same`      | `source`, `destination`, `permanent`, `statusCode`. `has`, `missing`, `basePath: false`, `locale: false` are `none`.                                   |
| `rewrites()`                                                                                                   | `rewrites()`                                   | `different` | Array form only, with after-files semantics. `beforeFiles`/`fallback` groups are `none`. For an external proxy, write an API route that calls `fetch`. |
| `headers()`                                                                                                    | `headers()`                                    | `same`      | `has`/`missing` are `none`.                                                                                                                            |
| `basePath`, `trailingSlash`                                                                                    | Same keys                                      | `same`      |                                                                                                                                                        |
| `images.remotePatterns`, `domains`, `formats`, `deviceSizes`, `imageSizes`, `qualities`, `dangerouslyAllowSVG` | `images.*` with the same names                 | `same`      |                                                                                                                                                        |
| `i18n`                                                                                                         | `i18n` (`locales`, `defaultLocale`, `routing`) | `different` | [/docs/internationalization](/docs/internationalization).                                                                                              |
| `output: "standalone"`                                                                                         | Default Node target (`deploy.target: "node"`)  | `different` | Output is self-contained in `.farm/.output`.                                                                                                           |
| `output: "export"`                                                                                             | None                                           | `none`      | Mark pages static and deploy to a server or platform target; Nitro static presets are untested by Farm.                                                |
| `env`                                                                                                          | `env`                                          | `different` | See above.                                                                                                                                             |
| `experimental.typedRoutes`                                                                                     | Built in (`src/farm.d.ts`)                     | `same`      |                                                                                                                                                        |
| `experimental.ppr`, `cacheComponents`                                                                          | `experimental.ppr`                             | `different` | See rendering exports.                                                                                                                                 |
| `serverActions`                                                                                                | `serverActions`                                | `rename`    | Option B only: set it in the `@farm.js/plugin/rsc` `defineConfig`.                                                                                     |
| `webpack`, `turbopack`, `transpilePackages`, `serverExternalPackages`                                          | `vite` (raw Vite config)                       | `different` | Usually delete; Vite handles TypeScript packages.                                                                                                      |
| `reactCompiler`, `assetPrefix`, `poweredByHeader`, `reactStrictMode`, `eslint`, `typescript`                   | None                                           | `none`      | Delete.                                                                                                                                                |

### Internationalization

Docs: [/docs/internationalization](/docs/internationalization). An App Router `[locale]` segment with your own middleware keeps working as a normal dynamic segment (`same`). To adopt Farm's built-in i18n (`different`): configure `i18n: { locales, defaultLocale, routing: "prefix-except-default" }`, remove the `[locale]` folder level, put catalogs in `src/messages/<locale>.json`, and use `getLocale`/`t` from `@farm.js/core/i18n/server` and `useLocale`/`useTranslations` from `@farm.js/core/i18n/client`. `next-intl` middleware and its `next/*` imports must be removed in that case.

### Authentication

Docs: [/docs/integrations/auth](/docs/integrations/auth), [/docs/auth](/docs/auth).

| Next.js library          | Farm                                                                                                    | Status        | Notes                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth.js / NextAuth v5    | `authjs({ instance })` from `@farm.js/authjs`; Farm mounts `/api/auth/[...nextauth]`                    | `different`   | Delete `app/api/auth/[...nextauth]/route.ts`. `next-auth` itself imports `next/*` modules; calling `auth()` without a request has not been verified on Farm.                   |
| Clerk (`@clerk/nextjs`)  | `clerk({ protectedRoutes, signInUrl })` from `@farm.js/clerk`, with `@clerk/react` and `@clerk/backend` | `different`   | `clerkMiddleware` becomes `protectedRoutes`; components import from `@clerk/react`. Farm registers `ClerkProvider`.                                                            |
| Better Auth              | `betterAuth({ instance })` from `@farm.js/better-auth`; Farm mounts `/api/auth/[...auth]`               | `different`   | Delete the `toNextJsHandler` route and the `nextCookies()` plugin. Server sessions: `auth.api.getSession({ headers: headers() })` with `headers` from `@farm.js/core/headers`. |
| Plain email and password | `auth: true` with `@farm.js/auth`                                                                       | Farm addition | Never combine top-level `auth` with `integrations.auth`.                                                                                                                       |

Register integrations in a server-only `src/lib/integrations.ts` and pass the object to `integrations` in `farm.config.ts`. `farm add integration <name>` writes this wiring.

### Styling

| Next.js                                | Farm                                                                 | Status      |
| -------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Global CSS imported in the root layout | Same                                                                 | `same`      |
| CSS modules (`*.module.css`)           | Same (Vite)                                                          | `same`      |
| Tailwind v4 via `@tailwindcss/postcss` | Built-in `@tailwindcss/vite` (install it); delete `postcss.config.*` | `different` |
| Tailwind loader in `next.config`       | Delete                                                               | `different` |
| Sass                                   | Install `sass`; Vite compiles `.scss`                                | `same`      |

### Deployment

Docs: [/docs/deployment](/docs/deployment).

| Next.js               | Farm                                                                                    | Status      |
| --------------------- | --------------------------------------------------------------------------------------- | ----------- |
| `next start` (Node)   | `farm build` then `node .farm/.output/server/index.mjs` (`HOST`, `PORT` env vars)       | `different` |
| Vercel                | `deploy: { target: "vercel" }` (auto-detected when `VERCEL=1`), output `.vercel/output` | `different` |
| Cloudflare (OpenNext) | `deploy: { target: "cloudflare" }` (Pages) or `deploy: { preset: "cloudflare-module" }` | `different` |
| Netlify               | `deploy: { target: "netlify" }`                                                         | `different` |
| Docker                | Build with devDependencies installed; the runtime image needs only `.farm/.output`      | `different` |

`farm deploy --plan` prints the resolved target, preset, and output without building.

### Testing

Docs: [/docs/testing](/docs/testing).

| Next.js                         | Farm                                                                                                | Status      |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| `next/jest`                     | Vitest (Vite-native)                                                                                | `different` |
| Route handler unit tests        | `createFarmTestHarness` from `@farm.js/core/testing`, or call the exported handler with a `Request` | `different` |
| Playwright against `next start` | Same tests against `pnpm build && pnpm start`                                                       | `same`      |

## Final verification checklist

- `rg -n "from ['\"]next" src` returns nothing; `next` is not in `package.json`.
- `pnpm dev`: every inventoried route returns its expected status; client components hydrate and keep state across client navigation.
- `pnpm build` succeeds; `pnpm start` serves the same statuses; API routes return the same bodies.
- `pnpm exec tsc --noEmit` passes with `src/farm.d.ts` regenerated (`pnpm exec farm generate`).
- Every former server action has an authorized endpoint and a client caller.
