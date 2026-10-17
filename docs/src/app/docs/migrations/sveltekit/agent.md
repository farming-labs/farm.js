# Migrate from SvelteKit to Farm

This document is the complete instruction set for a coding agent that is asked to move a SvelteKit
app to Farm while keeping its Svelte 5 components. Farm renders `.svelte` routes through the
`@farm.js/svelte` renderer. The document gives a phased procedure with verification gates, then a
feature-parity reference that maps each SvelteKit feature to its Farm file convention, import path,
and status. Do the migration by hand from this document: do not run `farm migrate`. Facts were
checked against the Farm 0.1.14 source (`@farm.js/core` 0.1.14, `@farm.js/cli` 0.1.14,
`@farm.js/svelte` 0.1.0-beta.33, `svelte` 5.56.8).

## Task contract

- Keep the SvelteKit app runnable until Farm passes dev, build, start, and type-check. Work on a
  branch. Do not delete `src/routes`, `svelte.config.js`, or SvelteKit packages before the last phase.
- Convert feature by feature using the parity tables. Do not invent Farm options. When a row says
  `none`, use its workaround or report the gap to the user.
- Status values: `same` (works unchanged), `rename` (same behavior, new name or path), `different`
  (rewrite needed, as described), `none` (no Farm equivalent; use the workaround).
- Canonical Farm docs are relative URLs on `https://farmjs.dev`, for example `/docs/renderers/svelte`.

## Six facts that change how you migrate

1. **Farm owns the HTML document.** There is no `src/app.html`. The root `layout.svelte` renders
   only app UI. Head tags come from `metadata` exports or `<svelte:head>`.
2. **Routes do not hydrate by default.** SvelteKit hydrates every page (`csr = true`). In Farm a
   `.svelte` route is server-rendered HTML with no client JavaScript until its module script exports
   `hydrate = true`. A layout that exports it hydrates every route below it.
3. **Plain `<a>` links do a full document load.** Farm does not intercept anchors. For client-side
   navigation call `router.push()` from `createRouter()` in `@farm.js/svelte/bindings`.
4. **Svelte routes have no `load` function.** Pages receive `params`, `search`, `path`, and
   `middleware` props only. Server data reaches the first render through route middleware
   (`ctx.data.set`), and everything else is fetched from API routes with the typed API client.
5. **There are no form actions.** Forms post to API routes under `src/app/api/**/route.ts`.
6. **Keep Svelte code off React entries.** `@farm.js/core/client` imports React at module load and
   React is only an optional peer of `@farm.js/core`. In `.svelte` files and browser helpers use
   `@farm.js/svelte/bindings` and `@farm.js/core/api/client`. Modules that call `createServerFn` or
   `createServerQuery` must never be imported by browser code: without the React-only server-function
   transform (`experimental.serverActions`), the build fails with a boundary error.

## Migration procedure

### Phase 0: prerequisites

1. Node `>=22.13.0` (`engines` of `@farm.js/core` and `@farm.js/svelte`). Clean `git status`, new branch.
2. Record a baseline: every file under `src/routes`, `src/params`, `src/hooks*.ts`,
   `src/service-worker.*`, `svelte.config.js`, `vite.config.*`, `src/app.html`, `src/app.d.ts`, and
   every import of `$app/*`, `$env/*`, `@sveltejs/kit`. Run the SvelteKit app and note each route's
   status code and whether it is interactive.

### Phase 1: install Farm and create the config

Pin exact versions. pnpm 11+ applies `minimumReleaseAge`, so a bare `latest` can resolve to an
older Farm release right after a publish.

```bash
FARM_VERSION=$(npm view @farm.js/core version)
FARM_SVELTE_VERSION=$(npm view @farm.js/svelte version)
pnpm add @farm.js/core@$FARM_VERSION @farm.js/svelte@$FARM_SVELTE_VERSION svelte zod
pnpm add -D @farm.js/cli@$FARM_VERSION svelte-check
```

`zod` is for endpoint and env schemas. If pnpm rejects a fresh version under `minimumReleaseAge`,
add that exact version to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`; do not unpin.

Create `farm.config.ts` at the project root:

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
  deploy: { target: "node" }, // see the adapter table
});
```

Set the scripts. `start` must run the built server directly, because hosts that prune
devDependencies cannot run `@farm.js/cli`. `farm start` works locally as a convenience.

```json
{
  "type": "module",
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs",
    "type-check": "svelte-check --tsconfig ./tsconfig.json"
  }
}
```

Keep the SvelteKit scripts under other names (for example `"dev:kit": "vite dev --config vite.kit.config.ts"`) until Phase 9.

### Phase 2: project files

| SvelteKit file                      | Action                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.ts` with `sveltekit()` | Rename it to `vite.kit.config.ts` and run the old app with `vite dev --config vite.kit.config.ts`. Farm does not pass `configFile: false` to Vite in `farm dev` or in the default production build, so a root `vite.config.*` is loaded and `sveltekit()` runs next to Farm's Svelte plugin. Move other plugins into `farm.config.ts` `vite.plugins` and a Vitest `test` block into `vitest.config.ts`. |
| `svelte.config.js`                  | Remove the `kit` block and the adapter import. Keep `preprocess` and `compilerOptions` only if needed (see the config table), otherwise delete the file.                                                                                                                                                                                                                                                |
| `tsconfig.json`                     | Remove `"extends": "./.svelte-kit/tsconfig.json"`. Use the standalone config below.                                                                                                                                                                                                                                                                                                                     |
| `src/app.html`                      | Delete. Move `<head>` content into root `metadata` or `<svelte:head>`.                                                                                                                                                                                                                                                                                                                                  |
| `src/app.d.ts`                      | Delete `App.Locals`, `App.PageData`, `App.Error` declarations once their users are migrated.                                                                                                                                                                                                                                                                                                            |
| `static/`                           | Rename to `public/`, or set `publicDir: "static"` in `farm.config.ts`.                                                                                                                                                                                                                                                                                                                                  |
| `.svelte-kit/`                      | Delete and remove from `.gitignore`; add `.farm/`.                                                                                                                                                                                                                                                                                                                                                      |

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "farm.config.ts"]
}
```

Farm aliases `@/` to the source directory (`src`) in dev and production builds. Replace every
`$lib/` import with `@/lib/` (for example with a project-wide find and replace). A custom alias in
`farm.config.ts` `vite.resolve.alias` applies to `farm dev` and to the production client and SSR
builds.

Gate: `pnpm exec farm generate` succeeds and writes `src/farm.d.ts`.

### Phase 3: routes and layouts

Move `src/routes/**` to `src/app/**` with the route-file table. Start with the root layout:

```svelte
<!-- src/app/layout.svelte -->
<script module lang="ts">
  import type { Metadata } from "@farm.js/core";
  import "./globals.css"; // move global CSS from the old root layout

  export const hydrate = true; // SvelteKit parity: hydrate every route
  export const metadata: Metadata = { title: "Acme", description: "..." };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
```

Remove `hydrate` from the root layout later for routes that need no client JavaScript, and add it
to the pages and layouts that do. Every `export const` route option (`hydrate`, `metadata`,
`generateMetadata`, `dynamic`, `revalidate`, `generateStaticParams`, `runtime`) goes in
`<script module lang="ts">`. Component props go in the instance script.

Gate: `pnpm dev`, then request every baseline URL. Each returns its baseline status, interactive
routes respond to input, and the browser console shows no hydration errors.

### Phase 4: data and endpoints

Replace every `load` and `+server.ts` (load and endpoint tables). Create the shared caller once:

```ts
// src/lib/api.ts
import { createApiClients } from "@farm.js/core/api/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
```

`farm dev`, `farm build`, and `farm generate` write `src/lib/api.generated.ts` once a route exists
under `src/app/api`. Use `apiClient` in browser code and `api` in server code. Gate: every endpoint
returns its baseline status, headers, cookies, and body.

### Phases 5 to 7: forms, navigation, hooks, and env

- Phase 5: convert each `actions` export and `use:enhance` (forms section). Gate: each form works
  with JavaScript disabled and enabled, including validation errors.
- Phase 6: replace `$app/navigation`, `$app/state`, `$app/stores` (navigation tables). Gate: client
  navigation keeps layout state, and back/forward restores the previous page.
- Phase 7: move `hooks.server.ts`, `hooks.client.ts`, `hooks.ts`, and `$env/*` (hooks and env
  tables). Gate: auth redirects, locals-dependent pages, and env-dependent pages match the baseline.

### Phase 8: production

Pick the deploy target from the adapter table, then run:

```bash
pnpm build
pnpm start          # node .farm/.output/server/index.mjs, port 3000 by default
pnpm type-check
```

Never use `node .output/server/index.mjs`; Farm writes `.farm/.output`. Gate: every baseline URL
returns its status from the production server and hydrated routes are interactive.

### Phase 9: remove SvelteKit

After all gates pass, delete `src/routes`, `src/params`, `src/hooks*.ts`, `vite.kit.config.ts`, the old scripts, and
uninstall `@sveltejs/kit`, every `@sveltejs/adapter-*`, and `@sveltejs/vite-plugin-svelte` unless
`svelte.config.js` or `vitest.config.ts` still imports it. Keep `svelte` and `@farm.js/svelte`.
Rerun Phase 8.

## Failure symptoms and recovery

| Symptom                                                                                    | Cause and fix                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hydration errors, duplicate Svelte plugin, or `$app/*` import errors in `farm dev`         | A root `vite.config.*` with `sveltekit()` is still loaded. Delete it.                                                                                                                      |
| Buttons and `onclick` handlers do nothing                                                  | The route does not hydrate. Export `hydrate = true` from the page or a parent layout module script.                                                                                        |
| `createServerFn handlers run only on the server, but ... is being bundled into the client` | Browser code imports a server-function or server-query module. Expose it through an API route and call `apiClient`.                                                                        |
| `Failed to resolve import "react"` in the browser                                          | A Svelte component imports `@farm.js/core/client`. Use `@farm.js/svelte/bindings` or `@farm.js/core/api/client`.                                                                           |
| `middleware.data` is `undefined` after client navigation                                   | Farm before 0.1.17 skipped middleware for development page-data requests. Upgrade `@farm.js/core`; client navigation now runs the target route's middleware in development and production. |
| `searchParams.then` errors or mismatched query values                                      | `searchParams` is a Promise during SSR and a plain object after hydration. Read the `search` prop.                                                                                         |
| `pnpm start` cannot find the server                                                        | Start script points at `.output`. Use `node .farm/.output/server/index.mjs`.                                                                                                               |
| Static files 404                                                                           | `static/` was not renamed to `public/` and `publicDir` is unset.                                                                                                                           |

## Feature parity: project and configuration

| SvelteKit                                     | Farm equivalent                                                                                                                                                                                                    | Status                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `src/routes`                                  | `src/app`                                                                                                                                                                                                          | `rename`                          |
| `$lib` alias                                  | `@/` alias to `src` (`@/lib/...`)                                                                                                                                                                                  | `rename`                          |
| `kit.alias`                                   | `tsconfig.json` `paths` plus rewritten imports, or a Vite plugin in `vite.plugins`                                                                                                                                 | `different`                       |
| `static/`                                     | `public/` (or `publicDir` in `farm.config.ts`)                                                                                                                                                                     | `rename`                          |
| `svelte.config.js` `preprocess`               | Keep the file with only `preprocess`; `@sveltejs/vite-plugin-svelte` 7 reads it. Add `@sveltejs/vite-plugin-svelte@7.3.1` as a devDependency to import `vitePreprocess`. Farm forces `compilerOptions.dev: false`. | `same` (unverified in Farm tests) |
| `kit.paths.base`                              | `basePath` in `farm.config.ts`                                                                                                                                                                                     | `rename`                          |
| `kit.paths.assets`                            | none                                                                                                                                                                                                               | `none`                            |
| `kit.csp`                                     | `security.csp.directives` in `farm.config.ts` (`/docs/configuration`)                                                                                                                                              | `different`                       |
| `kit.csrf.checkOrigin`                        | No documented origin check for API routes. Compare the `Origin` header with the request origin in each form endpoint.                                                                                              | `none`                            |
| `kit.prerender`                               | `routeRules` `{ prerender: true }` or per-route `dynamic = "force-static"`                                                                                                                                         | `different`                       |
| `kit.env.publicPrefix` / `dir`                | `env.public` schema in `farm.config.ts`                                                                                                                                                                            | `different`                       |
| `kit.version` / `pollInterval`                | none; Farm reloads once on stale chunks after a deploy (`/docs/deployment`)                                                                                                                                        | `none`                            |
| `BODY_SIZE_LIMIT`                             | `server.bodySizeLimit`                                                                                                                                                                                             | `rename`                          |
| `ORIGIN`, `PROTOCOL_HEADER`, `ADDRESS_HEADER` | `server.trustProxy: true` behind a trusted proxy                                                                                                                                                                   | `different`                       |
| `src/app.html`, `%sveltekit.head%`            | Farm document shell plus `metadata` and `<svelte:head>`; `<html lang>` comes from the i18n locale (default `en`)                                                                                                   | `different`                       |
| `$types` (`PageData`, `PageServerLoad`)       | `PageProps<"/route">`, `LayoutProps`, `ErrorProps` from `@farm.js/core`, or local prop types                                                                                                                       | `different`                       |

## Feature parity: route files and segments

| SvelteKit                                        | Farm                                                                                                                                                                  | Status      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `+page.svelte`                                   | `page.svelte`                                                                                                                                                         | `rename`    |
| `+layout.svelte`                                 | `layout.svelte`, renders `{@render children?.()}`                                                                                                                     | `rename`    |
| `+error.svelte`                                  | `error.svelte` (nearest boundary; props `error`, `reset`, `params`, `path`, `search`)                                                                                 | `rename`    |
| root 404                                         | `src/app/not-found.svelte` or `notFound.component` in config                                                                                                          | `different` |
| `+page.ts`, `+page.server.ts` `load`             | middleware data or API route (load table)                                                                                                                             | `different` |
| `+layout.ts`, `+layout.server.ts`                | middleware data for pages below it; layouts receive only `children`, `params`, and named slots                                                                        | `different` |
| `+server.ts` under `/api`                        | `src/app/api/**/route.ts` exporting `GET`, `POST`, ...                                                                                                                | `rename`    |
| `+server.ts` outside `/api` (`/rss.xml`)         | `defineRoutes(({ api }) => [api("/rss.xml", { GET })])` in `src/routes.ts`, or `sitemap.ts`, `robots.ts`, `manifest.ts` in `src/app`                                  | `different` |
| `+server.ts` next to `+page.svelte` (same URL)   | none; one URL is either a page or an API route                                                                                                                        | `none`      |
| `[id]`                                           | `[id]`, value in `params.id`                                                                                                                                          | `same`      |
| `[...rest]`                                      | `[...rest]`, `params.rest` is the joined string `a/b/c`                                                                                                               | `same`      |
| `[[...rest]]`                                    | `[[...rest]]`, missing value is `""`                                                                                                                                  | `same`      |
| `[[lang]]` optional single segment               | Parsed but matched as required. Use `i18n.routing: "prefix-except-default"` for locales, or create both `page.svelte` and `[lang]/page.svelte` sharing one component. | `none`      |
| `[id=integer]` with `src/params`                 | `[id]` plus validation in route middleware that calls `notFound()`                                                                                                    | `none`      |
| `(group)`                                        | `(group)`, no URL segment                                                                                                                                             | `same`      |
| `+page@.svelte`, `+layout@(group).svelte` resets | Layouts always nest from the root. Keep the root layout minimal and give each shell its own `(group)/layout.svelte`.                                                  | `none`      |
| non-route files inside route folders             | allowed; only `page`, `layout`, `loading`, `error`, `not-found`, `default`, `route`, `middleware` and metadata names are special                                      | `same`      |

`@slot` folders, `(.)` interception, and `loading.svelte` also exist (`/docs/routing`), but Svelte
SSR is buffered, so `loading.svelte` never streams a fallback.

## Feature parity: page options

| SvelteKit option                    | Farm (in `<script module lang="ts">` unless noted)                                                           | Status      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- |
| `prerender = true`                  | `export const dynamic = "force-static"`; for a subtree use `routeRules: { "/blog/**": { prerender: true } }` | `different` |
| `prerender = "auto"`                | none                                                                                                         | `none`      |
| ISR via adapter config              | `export const revalidate = 300` (`/docs/server-rendering`)                                                   | `different` |
| `entries`                           | `export const generateStaticParams = async () => [{ id: "a" }]`                                              | `rename`    |
| `csr = true` (default)              | `export const hydrate = true` on the page or a parent layout                                                 | `different` |
| `csr = false`                       | omit `hydrate` (Farm default)                                                                                | `different` |
| `ssr = false`                       | none. Render browser-only UI after `onMount`, or guard with `typeof window`.                                 | `none`      |
| `trailingSlash`                     | app-wide `trailingSlash: true` in `farm.config.ts` (308 redirect); no per-route value                        | `different` |
| adapter `config` (runtime, regions) | `export const runtime`, `regions`, `maxDuration` (`/docs/route-runtime`)                                     | `different` |

## Feature parity: load functions

| SvelteKit                           | Farm                                                                                             | Status      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| server `load` (data in first HTML)  | route `middleware.ts` sets `ctx.data.set(key, value)`; page reads `middleware?.data.get(key)`    | `different` |
| universal `load`, client data       | API route plus `apiClient` in `onMount` or `$effect`                                             | `different` |
| `data` prop                         | `params`, `search`, `path`, `middleware` props                                                   | `different` |
| `parent()`                          | parent middleware runs first; read its value with `ctx.data.get(key)` in child middleware        | `different` |
| `params`, `url`, `route.id`         | `ctx.params`, `ctx.url`, `ctx.route` in middleware; `params`, `path`, `search` props in pages    | `rename`    |
| `fetch` in load                     | `api` (server, dispatches locally) or `apiClient` (browser)                                      | `different` |
| `setHeaders`                        | `ctx.headers.set(name, value)` in middleware, or `routeRules` headers                            | `different` |
| `cookies.get/set/delete`            | `ctx.cookies.get/set/delete` in middleware; `cookies()` from `@farm.js/core` is read-only        | `different` |
| `depends`, `invalidate(url)`        | none. Refetch client data, or `location.reload()` for middleware data                            | `none`      |
| `invalidateAll()`                   | `router.refresh()` reruns the route's middleware and page props                                  | `different` |
| streaming promises in returned data | none for Svelte (buffered SSR, no `defer()` on file routes). Fetch after mount with `{#await}`.  | `none`      |
| `error(404)` in load                | `notFound()` from `@farm.js/core/navigation` in middleware                                       | `different` |
| `redirect(303, "/x")` in load       | `redirect("/x", 303)` from `@farm.js/core/navigation` or `ctx.redirect("/x", 303)` in middleware | `different` |

Middleware data is serialized into the page, so store only client-safe values. Client navigation
runs the target route's middleware, so `middleware.data` is set after in-app navigation too.

A `+page.server.ts` `load` that reads a post, calls `error(404)` when it is missing, and returns
`{ post }` becomes route middleware plus page props:

```ts
// src/app/posts/[id]/middleware.ts
import { middleware } from "@farm.js/core/middleware";
import { notFound } from "@farm.js/core/navigation";
import { getPost } from "@/lib/server/posts";

export default middleware().use(async (ctx, next) => {
  const post = await getPost(ctx.params.id);
  if (!post) notFound();
  ctx.data.set("post", { id: post.id, title: post.title, body: post.body });
  await next();
});
```

```svelte
<!-- src/app/posts/[id]/page.svelte -->
<script lang="ts">
  type Post = { id: string; title: string; body: string };
  let { middleware }: { middleware?: { data: Map<string, unknown> } } = $props();
  const post = middleware?.data.get("post") as Post;
</script>

<h1>{post.title}</h1>
```

Client-fetched alternative for a hydrated page, which also survives SPA navigation:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { apiClient } from "@/lib/api";
  let { params }: { params: { id: string } } = $props();
  let post = $state<{ title: string } | null>(null);
  onMount(async () => {
    const result = await apiClient.posts.$params({ id: params.id }).get();
    if (result.data) post = result.data;
  });
</script>
```

## Feature parity: endpoints (`+server.ts`)

| SvelteKit                          | Farm                                                                                                          | Status      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| `export const GET: RequestHandler` | `export async function GET(request: Request)` (plain handler, no params)                                      | `different` |
| handler `{ params, request, url }` | `export const GET = createEndpoint(async ({ params, request, query, body }) => ...)` from `@farm.js/core/api` | `different` |
| `json(data)`                       | `Response.json(data)`                                                                                         | `rename`    |
| `error(400, msg)`                  | declared `errors` plus `error("code", data)` in `createEndpoint`, or `Response.json(..., { status })`         | `different` |
| `redirect(303, url)`               | `return Response.redirect(new URL(url, request.url), 303)`                                                    | `different` |
| `fallback` export                  | export each method; unsupported methods return 405 with `Allow`                                               | `none`      |
| `locals` in handler                | endpoint `middleware: [fn]` returning context objects (`/docs/api-routes`)                                    | `different` |
| `platform`                         | not verified for Farm targets                                                                                 | `none`      |
| `getClientAddress()`               | not exposed; enable `server.trustProxy` and read forwarding headers                                           | `none`      |

```ts
// src/app/api/posts/[id]/route.ts
import { createEndpoint } from "@farm.js/core/api";

export const GET = createEndpoint(async ({ params }) => {
  const post = await getPost(String(params.id));
  return post ? Response.json(post) : Response.json({ message: "Not found" }, { status: 404 });
});
```

## Feature parity: form actions and `$app/forms`

| SvelteKit                          | Farm                                                                                                           | Status      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| default action (`actions.default`) | `POST` in `src/app/api/<name>/route.ts`; `<form method="POST" action="/api/<name>">`                           | `different` |
| named actions (`?/create`)         | one API route per action, or one route that switches on a form field                                           | `different` |
| `fail(400, data)`                  | redirect back with a query value for no-JS, JSON `400` for enhanced requests                                   | `different` |
| `form` prop / `ActionData`         | read the `search` prop (no-JS) or local `$state` (enhanced)                                                    | `different` |
| `use:enhance`                      | `onsubmit` handler that `fetch`es the same endpoint; requires `hydrate = true`                                 | `different` |
| `applyAction`, `deserialize`       | none                                                                                                           | `none`      |
| progressive enhancement            | native form post plus `303` redirect works without JavaScript                                                  | `same`      |
| `createAction` (Svelte binding)    | requires a browser-callable server function, which needs the React-only `experimental.serverActions` transform | `none`      |

```ts
// src/app/api/todos/route.ts
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const title = String((await request.formData()).get("title") ?? "").trim();
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  const back = new URL("/todos", request.url);
  if (!title) {
    if (wantsJson) return Response.json({ error: "Title is required" }, { status: 400 });
    back.searchParams.set("error", "Title is required");
    return Response.redirect(back, 303);
  }
  await createTodo(title);
  return wantsJson ? Response.json({ ok: true }) : Response.redirect(back, 303);
}
```

Behind a proxy, `request.url` reflects the public origin only with `server.trustProxy: true`.

```svelte
<!-- src/app/todos/page.svelte (module script exports hydrate = true) -->
<script lang="ts">
  let { search }: { search: Record<string, string | string[] | undefined> } = $props();
  let error = $state(typeof search.error === "string" ? search.error : null);
  let pending = $state(false);

  async function enhance(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    pending = true;
    const headers = { accept: "application/json" };
    const response = await fetch(form.action, { method: "POST", body: new FormData(form), headers });
    pending = false;
    if (!response.ok) return void (error = (await response.json()).error);
    location.reload(); // or refetch client-side data
  }
</script>

<form method="POST" action="/api/todos" onsubmit={enhance}>
  <input name="title" />
  <button disabled={pending}>Add</button>
  {#if error}<p role="alert">{error}</p>{/if}
</form>
```

## Feature parity: remote functions (`$app/server`)

| SvelteKit (experimental) | Farm                                                                   | Status      |
| ------------------------ | ---------------------------------------------------------------------- | ----------- |
| `query()`                | `GET` API route with a `query` schema, called with `apiClient`         | `different` |
| `query.batch()`          | none; accept an array in one endpoint                                  | `none`      |
| `command()`              | `POST` API route with a `body` schema, called with `apiClient`         | `different` |
| `form()`                 | API route plus native form (forms section)                             | `different` |
| `prerender()`            | none; a `GET` route with `cache-control` headers or `routeRules` `swr` | `none`      |
| `getRequestEvent()`      | `getCurrentRequest()` from `@farm.js/core/request`                     | `different` |
| `read()`                 | none; read files with `node:fs` in server code                         | `none`      |

`createServerFn` and `createServerQuery` exist in Farm, but browser callers need the React server
components transform. In a Svelte app, call them from API routes or other server code only.

## Feature parity: `$app/navigation`

Create one router store per component: `const router = createRouter()` from
`@farm.js/svelte/bindings`. It only works in hydrated routes and resolves `basePath` for you.

| SvelteKit                                     | Farm                                                                                                                                                                                                                                             | Status      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `goto(url, opts)`                             | `router.push(url, { scroll, state, viewTransition })`; `router.replace(url)` for `replaceState: true`                                                                                                                                            | `rename`    |
| `invalidate`, `invalidateAll`                 | `router.refresh()` (see load table)                                                                                                                                                                                                              | `different` |
| `preloadData`, `preloadCode`                  | `router.prefetch(url)`                                                                                                                                                                                                                           | `rename`    |
| `beforeNavigate`                              | `getRouter().addBlocker(({ from, to, action }) => shouldBlock)` exists only in `@farm.js/core/client`, which imports React. Use it only if `react` is installed; otherwise guard your own `router.push` calls and use a `beforeunload` listener. | `none`      |
| `afterNavigate`                               | `$effect` on `$router.navigation.state === "idle"` or on `$router.pathname`                                                                                                                                                                      | `different` |
| `onNavigate` (view transitions)               | `router.push(url, { viewTransition: true })`                                                                                                                                                                                                     | `different` |
| `disableScrollHandling`                       | `router.push(url, { scroll: false })`                                                                                                                                                                                                            | `different` |
| `pushState`, `replaceState` (shallow routing) | `router.pushState(state, href?)`, `router.replaceState(state, href?)`; read `$router.pageState`. Argument order is state first.                                                                                                                  | `rename`    |
| `data-sveltekit-preload-data`                 | `onmouseenter={() => router.prefetch(href)}`                                                                                                                                                                                                     | `different` |
| `data-sveltekit-reload`                       | plain `<a>` (already a document load)                                                                                                                                                                                                            | `same`      |
| automatic link interception                   | none; use a link component                                                                                                                                                                                                                       | `none`      |

```svelte
<!-- src/lib/components/link.svelte -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { createRouter } from "@farm.js/svelte/bindings";

  let { href, children, ...rest }: HTMLAnchorAttributes & { href: string; children?: Snippet } =
    $props();
  const router = createRouter();

  function onclick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    if (event.shiftKey || event.altKey || rest.target || !href.startsWith("/")) return;
    event.preventDefault();
    void router.push(href);
  }
</script>

<a {href} {...rest} {onclick} onmouseenter={() => void router.prefetch(href)}>
  {@render children?.()}
</a>
```

With `basePath` set, the `href` attribute needs the prefix even though `router.push` adds it.

## Feature parity: `$app/state` and `$app/stores`

| SvelteKit                   | Farm                                                                    | Status      |
| --------------------------- | ----------------------------------------------------------------------- | ----------- |
| `page.params`               | `params` prop (pages, layouts, error)                                   | `different` |
| `page.url.pathname`         | `path` prop (SSR-safe); `$router.pathname` after hydration              | `different` |
| `page.url.searchParams`     | `search` prop (SSR-safe object); `$router.searchParams` after hydration | `different` |
| `page.data`                 | `middleware?.data` prop                                                 | `different` |
| `page.form`                 | none (forms section)                                                    | `none`      |
| `page.error`, `page.status` | `error` prop in `error.svelte`; no status value                         | `different` |
| `page.state`                | `$router.pageState`                                                     | `rename`    |
| `page.route.id`             | none                                                                    | `none`      |
| `navigating`                | `$router.navigation` (`state`, `pending`, `from`, `to`, `action`)       | `rename`    |
| `updated`                   | none                                                                    | `none`      |

`createRouter()` reports `pathname: "/"` and empty params on the server; never render them in SSR.

## Feature parity: environment, paths, and `$env`

| SvelteKit                        | Farm                                                                                                                                          | Status      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `browser` (`$app/environment`)   | `!import.meta.env.SSR` or `typeof window !== "undefined"`                                                                                     | `different` |
| `dev`                            | `import.meta.env.DEV`                                                                                                                         | `different` |
| `building`                       | none                                                                                                                                          | `none`      |
| `version`                        | none                                                                                                                                          | `none`      |
| `base` (`$app/paths`)            | export a constant used by both `farm.config.ts` `basePath` and components                                                                     | `none`      |
| `assets`, `resolve()`, `asset()` | none; reference `/file` from `public/`                                                                                                        | `none`      |
| `$env/static/private`            | `env.server` schema in `farm.config.ts`; `getEnv("NAME")` from `@farm.js/core/env` (throws in the browser)                                    | `rename`    |
| `$env/dynamic/private`           | `process.env.NAME` in server-only code (Node targets)                                                                                         | `different` |
| `$env/static/public`             | `env.public` schema; `getPublicEnv("NAME")` (inlined at build)                                                                                | `rename`    |
| `$env/dynamic/public`            | none; public values are build-time. Serve runtime config from an API route.                                                                   | `none`      |
| `$lib/server` boundary           | `createServerOnlyFn` from `@farm.js/core/environment` (`/docs/environment-functions`) and never importing server modules from `.svelte` files | `different` |

Declare schemas in `farm.config.ts`, for example `env: { server: { DATABASE_URL: z.string().url() },
public: { PUBLIC_SITE_NAME: z.string() } }`. Farm does not require a `PUBLIC_` prefix; the `public`
block decides what reaches the browser.

## Feature parity: hooks and locals

| SvelteKit                                | Farm                                                                                                                 | Status      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| `handle` (auth, headers)                 | `src/app/middleware.ts` or `middleware` array in `farm.config.ts` (`/docs/middleware`)                               | `different` |
| `sequence(a, b)`                         | several config middleware entries, then nested `middleware.ts` files, in that order                                  | `different` |
| `resolve(event, { transformPageChunk })` | none                                                                                                                 | `none`      |
| `event.locals` (server-only)             | `context.set()` / `ctx.locals.set()`; read with `getMiddlewareContext()` from `@farm.js/core/middleware`             | `rename`    |
| locals values the page renders           | `ctx.data.set()` (serialized into the page)                                                                          | `different` |
| `handleFetch`                            | none; `api` calls endpoints in process, `apiClient` has lifecycle hooks (`/docs/api-client`)                         | `none`      |
| `handleError` (server)                   | `observability.onEvent` for `request.error`, `render.error`, `api.error` (`/docs/observability`) plus `error.svelte` | `different` |
| `handleError` (client)                   | none; `window` `error` and `unhandledrejection` listeners in the root layout `onMount`                               | `none`      |
| `reroute`                                | `ctx.rewrite("/path")` in middleware                                                                                 | `different` |
| `init`                                   | `register()` in `src/instrumentation.ts`                                                                             | `different` |
| `transport`                              | none; props and middleware data must be JSON-serializable                                                            | `none`      |

A `handle` hook that loads `event.locals.user` and redirects anonymous `/admin` visitors becomes:

```ts
// src/app/admin/middleware.ts
import type { RequestMiddlewareContext } from "@farm.js/core/middleware";

export async function middleware(request: Request, context: RequestMiddlewareContext) {
  const user = await getUser(context.cookies.get("session"));
  if (!user) return Response.redirect(new URL("/login", request.url), 303);
  context.set("user", user); // server-only
  context.data.set("userName", user.name); // visible to the page
}
```

Repeat authorization inside every API route; middleware is not the only boundary.

## Feature parity: errors and redirects from `@sveltejs/kit`

| SvelteKit                   | Farm                                                                                                | Status      |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| `error(404)`                | `notFound()` from `@farm.js/core/navigation` in middleware (renders `not-found.svelte`, status 404) | `different` |
| `error(403, msg)` elsewhere | API: `Response.json({ message }, { status: 403 })`; middleware: return a `Response`                 | `different` |
| `redirect(status, url)`     | `redirect(url, status)` (301, 302, 303, 307, 308) in middleware; `Response.redirect` in API routes  | `different` |
| thrown errors in components | nearest `error.svelte`                                                                              | `same`      |
| `isRedirect`, `isHttpError` | `isFarmRedirectError`, `isFarmNotFoundError` from `@farm.js/core/navigation`                        | `rename`    |

Prefer calling `redirect()` and `notFound()` from middleware. Calls inside a Svelte component
script are not covered by Farm's Svelte renderer tests.

## Feature parity: adapters and deployment

| SvelteKit adapter              | Farm `deploy` in `farm.config.ts` (`/docs/deployment`)                                                                                       | Status      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `adapter-auto`                 | omit `deploy`; Farm detects `VERCEL`, `NETLIFY`, `CF_PAGES`                                                                                  | `same`      |
| `adapter-node`                 | `target: "node"`; run `node .farm/.output/server/index.mjs`                                                                                  | `rename`    |
| `adapter-vercel`               | `target: "vercel"`; output `.vercel/output`                                                                                                  | `rename`    |
| `adapter-netlify`              | `target: "netlify"`; output `dist` plus `.netlify/functions-internal`                                                                        | `rename`    |
| `adapter-cloudflare` (Pages)   | `target: "cloudflare"` (`cloudflare-pages` preset)                                                                                           | `rename`    |
| `adapter-cloudflare` (Workers) | `preset: "cloudflare-module"`                                                                                                                | `different` |
| `adapter-static`               | none as a full static export. Prerender routes and deploy a server target, or try a static Nitro preset such as `github-pages` (unverified). | `none`      |
| other community adapters       | `preset: "<nitro-preset>"`                                                                                                                   | `different` |

## Feature parity: head, styling, and other features

| SvelteKit                                     | Farm                                                                                                                                                             | Status      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `<svelte:head>`                               | `<svelte:head>`, carried through the Svelte server adapter                                                                                                       | `same`      |
| per-page `<title>` and meta                   | `export const metadata: Metadata` or `generateMetadata` in the module script                                                                                     | `same`      |
| scoped `<style>`                              | unchanged                                                                                                                                                        | `same`      |
| global CSS in `+layout.svelte`                | `import "./globals.css"` in the root layout module script                                                                                                        | `same`      |
| Tailwind via `vite.config`                    | Farm enables `@tailwindcss/vite` itself unless the project has a PostCSS config                                                                                  | `different` |
| runes, stores, actions, transitions, snippets | unchanged                                                                                                                                                        | `same`      |
| snapshots (`export const snapshot`)           | none; keep state in `router.replaceState(state)` or `sessionStorage`                                                                                             | `none`      |
| `src/service-worker.ts`, `$service-worker`    | `@farm.js/pwa` (`/docs/plugins/pwa`); a custom worker is copied unbundled, so ship JavaScript                                                                    | `different` |
| i18n (Paraglide, `[[lang]]`)                  | `i18n` config plus `createI18n()` from `@farm.js/svelte/bindings` (`/docs/internationalization`), or keep Paraglide's Vite plugin in `vite.plugins`              | `different` |
| unit tests (Vitest)                           | `vitest.config.ts` with `svelte()` from `@sveltejs/vite-plugin-svelte`; server logic with `createFarmTestHarness` from `@farm.js/core/testing` (`/docs/testing`) | `different` |
| Playwright e2e                                | `webServer.command: "pnpm build && pnpm start"`, port 3000                                                                                                       | `different` |

## Final verification checklist

1. `pnpm dev`: every baseline URL returns its baseline status; interactive routes hydrate without
   console errors; layout state survives client navigation through the link component.
2. Forms work with JavaScript disabled and enabled, including validation errors and redirects.
3. `pnpm build` succeeds and `pnpm start` serves the same statuses, headers, and cookies.
4. `pnpm type-check` (`svelte-check`) passes and `pnpm exec farm generate` leaves no diff.
5. No source file imports `@farm.js/core/client` (in Svelte code), `$app/*`, `$env/*`, or `@sveltejs/kit`.
6. No private env value appears anywhere under `.farm/.output/public`.

See [Svelte Renderer](/docs/renderers/svelte), [Routing](/docs/routing), [Middleware](/docs/middleware),
[API Routes](/docs/api-routes), and [Deployment](/docs/deployment) for the full Farm contracts.
