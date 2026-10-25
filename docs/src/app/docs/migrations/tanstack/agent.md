# Migrate from TanStack Start to Farm

This document is the complete instruction set for a coding agent that is asked to move a TanStack
Start (or TanStack Router file-route) React app to Farm. It contains a phased procedure with
verification gates, then a feature-parity reference that maps every TanStack Start and TanStack
Router feature to its Farm file convention, import path, and status. Do the migration by hand from
this document: do not run `farm migrate`. The procedure was verified by migrating the official
starter (`@tanstack/react-start` 1.169.2, created with `@tanstack/cli create`) to Farm 0.1.14.

## Task contract

- Keep the TanStack app runnable until Farm passes dev, build, start, and type-check. Work on a
  branch; never delete `src/routes`, `src/router.tsx`, or TanStack packages before the last phase.
- Convert feature by feature using the parity tables. Every Farm API named here exists in Farm
  0.1.14; do not invent options. When a row says `none`, use its workaround or report the gap.
- Status values: `same` (works unchanged), `rename` (same behavior, new name or path), `different`
  (rewrite needed, as described), `none` (no Farm equivalent; use the workaround).
- React is built into `@farm.js/core`. A React app installs no renderer package.
- Canonical Farm docs are linked as relative URLs on `https://farmjs.dev`, for example
  `/docs/routing`.

## Migration procedure

### Phase 0: prerequisites

1. Node `>=22.13.0` (the `engines` range of `@farm.js/core` 0.1.14).
2. `git status` is clean. Create a branch.
3. Record the baseline: list every route file in `src/routes`, every `createServerFn`, every
   `server: { handlers }` or `createServerFileRoute`/`createAPIFileRoute`, every `createMiddleware`,
   and the scripts in `package.json`. Run the TanStack app once and note each route's status code.

### Phase 1: add Farm next to TanStack

1. Add exact versions of the current release (`npm view @farm.js/core version`):
   `@farm.js/core@<version>` to `dependencies` and `@farm.js/cli@<version>` to `devDependencies`. Do not use `latest`: under pnpm 11+, `minimumReleaseAge` can resolve
   `latest` to an older Farm release for a day after a publish. If installs are blocked by the
   release age, add `'@farm.js/*'` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
2. Create `farm.config.ts` with `export default defineConfig({})`, importing `defineConfig` from
   `@farm.js/core`.
3. Replace scripts. TanStack has no `start` script by default; add one:

   ```json
   "scripts": {
     "dev": "farm dev",
     "build": "farm build",
     "start": "node .farm/.output/server/index.mjs",
     "type-check": "tsc --noEmit"
   }
   ```

   `farm start` also works locally, but `@farm.js/cli` is a devDependency, so hosts that prune
   devDependencies cannot run it. Keep the `node` command as the `start` script, the same as every
   `create @farm.js/app` template. Remove `generate-routes` (`tsr generate`) and `vite preview`.

4. Add `.farm` to `.gitignore`. Install.

### Phase 2: remove the TanStack Vite config

`farm dev` creates its Vite server without `configFile: false`, so Vite auto-loads a root
`vite.config.*` and merges its plugins with Farm's. Both production Vite passes in `farm build`
(client and server) do the same. The starter's config adds `tanstackStart()`, `viteReact()`, and
the TanStack devtools plugin. Farm's React renderer adds no `@vitejs/plugin-react`, so the leftover
plugin breaks hydration on every route with "@vitejs/plugin-react can't detect preamble".

1. Delete `vite.config.ts` (or move it out of the project root for reference).
2. Move only options you still need into `farm.config.ts` under `vite`. The `vite` object is
   merged in `farm dev` and in both `farm build` passes, except the build options Farm owns (see
   `/docs/configuration#vite-config`).
3. Never re-add `tanstackStart()`, `@vitejs/plugin-react`, the TanStack devtools Vite plugin,
   Nitro or hosting Vite plugins, or `tailwindcss()` from `@tailwindcss/vite` (Farm enables Tailwind
   itself; keep the `@tailwindcss/vite` package installed).
4. `resolve: { tsconfigPaths: true }` is not needed for the starter: Farm aliases `@/` to the
   source directory, and the starter's `#/*` alias is a package.json `"imports"` entry that Vite and
   Node resolve natively. Keep `"imports": { "#/*": "./src/*" }` and the matching tsconfig `paths`.

Gate: `pnpm dev` starts on port 3000 without Vite plugin errors.

### Phase 3: convert `__root.tsx` into `src/app/layout.tsx`

Farm does not read `__root.tsx`. Without this phase every route loses the global stylesheet, the
header and footer, and the document title. Farm supports a root layout that returns the full
`<html>` document. Before (starter):

```tsx
// src/routes/__root.tsx
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackDevtools } from "@tanstack/react-devtools"; // plus the router devtools panel
import Footer from "../components/Footer";
import Header from "../components/Header";
import appCss from "../styles.css?url";

const THEME_INIT_SCRIPT = `(function(){ /* reads localStorage, sets html class */ })();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TanStack Start Starter" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <Header />
        {children}
        <Footer />
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={
            [
              /* router panel */
            ]
          }
        />
        <Scripts />
      </body>
    </html>
  );
}
```

After:

```tsx
// src/app/layout.tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import Footer from "../components/Footer";
import Header from "../components/Header";
import "../styles.css";

const THEME_INIT_SCRIPT = `(function(){ /* unchanged */ })();`;

export const metadata: Metadata = {
  title: "TanStack Start Starter",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
```

Rules: import CSS directly (drop `?url` and the stylesheet `links` entry); delete `HeadContent`,
`Scripts`, and the TanStack devtools (Farm injects its head tags, assets, and client runtime before
`</head>` and `</body>`); move `meta` title and description into `metadata`. `Header` uses TanStack
`Link`, so convert it in Phase 5 before checking this phase in a browser.

Gate: `/` returns 200 with styles, header, footer, and the title.

### Phase 4: move routes into `src/app`

1. Map each file with the [route naming table](#file-route-naming). Verified mappings from the
   starter: `index.tsx` to `src/app/page.tsx`, `about.tsx` to `src/app/about/page.tsx`,
   `posts.$postId.tsx` to `src/app/posts/[postId]/page.tsx`, `docs.$.tsx` to
   `src/app/docs/[...splat]/page.tsx`, `_app/settings.tsx` to `src/app/settings/page.tsx`.
2. Farm renders the page module's default export. Add `export default ComponentName` (name inline
   arrow components first), then remove `export const Route = createFileRoute(...)`.
3. Convert every `loader` plus `Route.useLoaderData()` route. Until converted it renders 500 with
   "useRouter must be used inside a <RouterProvider>". Use an async page for simple loaders, or a
   programmatic `createRoute` when the route also uses `validateSearch`, `beforeLoad`, `staleTime`,
   or pending/error components (see [Route options](#route-options)).
4. Interactive components work without changes: Farm detects hooks or `"use client"` and hydrates
   them. Adding `"use client"` to components with state or effects is still recommended.

Gate: every recorded route returns its baseline status in `pnpm dev`.

### Phase 5: replace router APIs in components

Search: `grep -rn "@tanstack/react-router\|@tanstack/react-start" src --include=*.tsx --include=*.ts`.
Every hit outside `src/routes`, `src/router.tsx`, and `src/routeTree.gen.ts` must be converted
using the [navigation](#navigation) and [route hooks](#loader-data-route-hooks-search-params-and-router-context)
tables. The starter's `Header` uses `Link` with `activeProps`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Link } from "@farm.js/core/client";
import { usePathname } from "@farm.js/core/navigation";

function NavLink({ href, children }: { href: "/" | "/about"; children: ReactNode }) {
  const active = usePathname() === href;
  return (
    <Link href={href} className={active ? "nav-link is-active" : "nav-link"}>
      {children}
    </Link>
  );
}
```

`usePathname()` reads the request URL during SSR, so the active class does not cause a hydration
mismatch.

Gate: no TanStack imports remain outside the old router files; client navigation between all
routes works and component state survives where it should.

### Phase 6: server functions, server routes, middleware

Convert with the [server functions](#server-functions), [server routes](#server-routes-and-api-routes),
and [middleware](#middleware-and-request-utilities) tables. Gate: every former server route answers
with the same status and body, and every mutation works from the UI.

### Phase 7: full verification

1. `pnpm dev`: request every route (`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/<path>`),
   then open each in a browser: no console errors, interactive components respond, state behaves
   the same across client navigation.
2. `pnpm build`: output is written to `.farm/.output`.
3. `pnpm start`: the same route checks against the production server (`PORT` sets the port).
4. `pnpm exec tsc --noEmit`: Farm generates `src/farm.d.ts` (route, env, CSS and image types)
   during `farm dev`; run `pnpm exec farm generate` first when the dev server has not run.

### Phase 8: remove TanStack

Only after Phase 7 passes: delete `src/routes`, `src/router.tsx`, `src/routeTree.gen.ts`,
`tsr.config.json`, `.tanstack`, and remove `@tanstack/react-start`, `@tanstack/react-router`,
`@tanstack/react-router-devtools`, `@tanstack/react-devtools`, `@tanstack/devtools-vite`,
`@tanstack/router-cli`, `@tanstack/router-plugin`, and `@vitejs/plugin-react`. Keep
`@tailwindcss/vite` when the app uses Tailwind: Farm loads it from the app.
Keep `@tanstack/react-query` if the app uses it. If `tsconfig.json` lists `"vite/client"` in
`types`, either keep `vite` as a devDependency on the same major as Farm (8.x) or remove that entry.
Repeat Phase 7.

### Failure symptoms and recovery

| Symptom                                                        | Cause                                         | Recovery                                                      |
| -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| "@vitejs/plugin-react can't detect preamble", nothing hydrates | Root `vite.config.*` still loaded             | Delete it (Phase 2)                                           |
| 500 "useRouter must be used inside a <RouterProvider>"         | `Route.use*`, TanStack `Link`, or router hook | Convert the route or component (Phases 4 and 5)               |
| Unstyled pages, no header, default title                       | `__root.tsx` not converted                    | Create `src/app/layout.tsx` (Phase 3)                         |
| Route renders blank or 404                                     | No default export, or wrong folder name       | Add `export default`; check the naming table                  |
| "Duplicate page route"                                         | Same URL from a file page and `createRoute`   | Keep one of them                                              |
| Build error "createServerFn handlers run only on the server"   | Client component imports a server function    | Use path A from the server functions section                  |
| `pnpm start` fails with missing module                         | Build not run or wrong path                   | Run `pnpm build`; start `node .farm/.output/server/index.mjs` |

## Feature parity reference

### Project files and tooling

| TanStack                                  | Farm                                                       | Status      |
| ----------------------------------------- | ---------------------------------------------------------- | ----------- |
| `vite.config.ts` with `tanstackStart()`   | `farm.config.ts` (`defineConfig` from `@farm.js/core`)     | `different` |
| `src/router.tsx` (`createRouter`)         | Nothing; Farm owns the router                              | `different` |
| `src/routeTree.gen.ts`, `tsr.config.json` | `src/farm.d.ts`, generated by `farm dev` / `farm generate` | `different` |
| No start script                           | `node .farm/.output/server/index.mjs`                      | `different` |
| `#/*` package.json `imports`              | Unchanged                                                  | `same`      |
| `@/*` tsconfig path                       | Built-in `@/` alias to the source directory                | `same`      |
| `defaultPreload: 'intent'`                | `Link` prefetches on intent and viewport by default        | `different` |
| `scrollRestoration: true`                 | Automatic; `useScrollRestoration` for nested scrollers     | `same`      |

Do not create a file named `src/routes.ts(x)` or `src/farm.routes.ts(x)` by accident: Farm reads
those files as programmatic route definitions. The TanStack `src/routes/` directory is ignored.
Docs: `/docs/project-structure`, `/docs/configuration`.

### File route naming

| TanStack file (`src/routes/`)               | Farm file (`src/app/`)                                  | Status      |
| ------------------------------------------- | ------------------------------------------------------- | ----------- |
| `index.tsx`                                 | `page.tsx`                                              | `rename`    |
| `about.tsx`                                 | `about/page.tsx`                                        | `rename`    |
| `posts.$postId.tsx` or `posts/$postId.tsx`  | `posts/[postId]/page.tsx`                               | `rename`    |
| `posts.$postId.edit.tsx`                    | `posts/[postId]/edit/page.tsx`                          | `rename`    |
| `docs.$.tsx` (splat, `params._splat`)       | `docs/[...splat]/page.tsx` (`params.splat`, `/`-joined) | `rename`    |
| `$.tsx` at the root (catch-all)             | `[...splat]/page.tsx`, or `not-found.tsx` for 404 UI    | `rename`    |
| `posts.tsx` with `<Outlet />`               | `posts/layout.tsx` rendering `{children}`               | `rename`    |
| `posts/route.tsx`                           | `posts/layout.tsx`                                      | `rename`    |
| `posts/index.tsx` or `posts.index.tsx`      | `posts/page.tsx`                                        | `rename`    |
| `_app.tsx` + `_app/settings.tsx` (pathless) | `(app)/layout.tsx` + `(app)/settings/page.tsx`          | `rename`    |
| `_app/settings.tsx` with no layout needed   | `settings/page.tsx`                                     | `rename`    |
| `(group)/page.tsx` folders                  | `(group)/...`, not part of the URL                      | `same`      |
| `-components/` and `-file.tsx` (ignored)    | Any name: only reserved file names are routes           | `rename`    |
| `posts_.$postId.edit.tsx` (un-nested)       | Separate route groups with separate layouts             | `different` |
| `script[.]js.tsx` (escaped dot)             | `defineRoutes` `api("/script.js", { GET })`             | `different` |
| `{-$lang}` optional param                   | No optional single param                                | `none`      |
| `__root.tsx`                                | `layout.tsx` at `src/app`                               | `different` |

Reserved names in `src/app`: `page`, `layout`, `loading`, `error`, `not-found`, `route` (under
`api/`), `middleware`, `default` (slots), metadata files (`sitemap`, `robots`, `manifest`, `llms`,
`opengraph-image`). Every other file is ignored by routing, so colocated components need no prefix.
Un-nesting: Farm layouts always wrap descendants; place the bare page in a different route group,
for example `src/app/(main)/posts/layout.tsx` and `src/app/(bare)/posts/[postId]/edit/page.tsx`.
Optional params: create both `src/app/page.tsx` and `src/app/[lang]/page.tsx` sharing one
component, use an optional catch-all `[[...lang]]`, or use Farm `i18n` config for locale prefixes.
Docs: `/docs/routing`, `/docs/layouts`.

### Layout routes and `Outlet`

| TanStack                   | Farm                                                        | Status      |
| -------------------------- | ----------------------------------------------------------- | ----------- |
| `<Outlet />`               | `{children}` from `LayoutProps` (`@farm.js/core`)           | `rename`    |
| Layout route `component`   | `export default function Layout({ children }: LayoutProps)` | `rename`    |
| Layout with no index child | Add a `page.tsx` for the parent URL if it must resolve      | `different` |

Example: `src/app/posts/layout.tsx` exports
`default function PostsLayout({ children }: LayoutProps) { return <section>{children}</section>; }`.

### Route options

| `createFileRoute` option        | Farm equivalent                                                                    | Status      |
| ------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| `component`                     | `export default` of `page.tsx`                                                     | `rename`    |
| `loader`                        | Async page (`await` in the component) or `createRoute` `data.main`                 | `different` |
| `beforeLoad` (auth)             | `middleware.ts` in the segment, `createRoute` `guard`, or `redirect()` in page     | `different` |
| `beforeLoad` (context)          | `createRoute` `data.before`, result passed to `data.main` as `before`              | `different` |
| `validateSearch`                | `createRoute` `search.schema`, or parse `await searchParams` in the page           | `different` |
| `loaderDeps`                    | Not needed; key data on `search` with `data.key`                                   | `different` |
| `pendingComponent`              | `loading.tsx` in the segment, or `createRoute` `pending`                           | `rename`    |
| `errorComponent`                | `error.tsx` (`"use client"`, props `error`, `reset`), or `createRoute` `error`     | `rename`    |
| `notFoundComponent`             | `not-found.tsx`, or `createRoute` `notFound`                                       | `rename`    |
| `staleTime`                     | `createRoute` `data.staleTime` with `data.key` (`"30s"`, ms, or `false`)           | `different` |
| `gcTime`, `shouldReload`        | No equivalent; invalidate with `invalidate(key)` or `revalidatePath(path)`         | `none`      |
| `head`                          | `export const metadata` / `generateMetadata` (also `createRoute` options)          | `different` |
| `params.parse`                  | `createRoute` `params` schema, or `loadRouteParams` (`@farm.js/core/query/server`) | `different` |
| `search.middlewares`            | `createRoute` `search.preserve`, `search.stripDefaults`, `search.temporary`        | `different` |
| `ssr: false` / `'data-only'`    | No per-route SSR switch                                                            | `none`      |
| `headers`                       | `routeRules` `headers`, or `ctx.headers.set` in middleware                         | `different` |
| `onEnter`, `onLeave`, `onError` | No route lifecycle hooks; use effects in a client component                        | `none`      |

Simple loader, async page (verified with the starter's `posts.$postId.tsx`):

```tsx
// before: src/routes/posts.$postId.tsx
export const Route = createFileRoute("/posts/$postId")({
  loader: ({ params }) => ({ title: `Post ${params.postId}` }),
  component: PostPage,
});
function PostPage() {
  const { title } = Route.useLoaderData();
  return <h1>{title}</h1>;
}

// after: src/app/posts/[postId]/page.tsx
import type { PageProps } from "@farm.js/core";

export default async function PostPage({ params }: PageProps<"/posts/[postId]">) {
  const { title } = await loadPost(params.postId); // the former loader body
  return <h1>{title}</h1>;
}
```

An async page stays server-only. `"use client"` components it renders hydrate as separate islands
with serializable props; keep interactive parts in those components.

Full route options, programmatic route in `src/farm.routes.tsx` (`createRoute` from `@farm.js/core`):

```tsx
// before
export const Route = createFileRoute("/posts/$postId")({
  validateSearch: z.object({ tab: z.enum(["body", "comments"]).default("body") }),
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/login" });
  },
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ params, deps }) => fetchPost(params.postId, deps.tab),
  staleTime: 30_000,
  pendingComponent: PostSkeleton,
  errorComponent: PostError,
  notFoundComponent: PostMissing,
  component: PostPage,
});

// after: src/farm.routes.tsx (and delete src/app/posts/[postId]/page.tsx)
import { createRoute, notFound, redirect } from "@farm.js/core";
import { z } from "zod";
import { PostError, PostMissing, PostPage, PostSkeleton } from "./features/posts/post-page";

export const PostRoute = createRoute("/posts/[postId]", {
  search: { schema: z.object({ tab: z.enum(["body", "comments"]).default("body") }) },
  guard: async ({ context }) => {
    if (!context.user) redirect("/login");
  },
  data: {
    key: ({ params, search }) => ["post", params.postId, search.tab],
    staleTime: "30s",
    async main({ params, search }) {
      const post = await fetchPost(params.postId, search.tab);
      if (!post) notFound();
      return { post };
    },
  },
  pending: PostSkeleton,
  error: PostError,
  notFound: PostMissing,
  component: PostPage,
});
```

The component receives `data`, `params`, and `search` as props instead of `Route.useLoaderData()`
and `Route.useSearch()`. `context` comes from `context` in `farm.config.ts` (next section). A
programmatic file exports either named `createRoute` values or one default `defineRoutes(...)`;
when a default export exists Farm reads only it, so list `createRoute` values inside that array.
Include user, tenant, or locale in `data.key` when data depends on them. Docs: `/docs/routing`
(route data cache, typed search params, route guards, route UI states), `/docs/layouts`.

### Loader data, route hooks, search params, and router context

| TanStack                                                 | Farm                                                                                                 | Status      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| `Route.useLoaderData()`                                  | Awaited value in an async page, or `data` prop of a `createRoute` page                               | `different` |
| `Route.useParams()` in the page                          | `params` prop (`PageProps<"/posts/[postId]">`)                                                       | `different` |
| `useParams()` deep in a client component                 | Pass as props, or `useRouter({ routes: [...] }).params` (`@farm.js/core/client`)                     | `different` |
| `Route.useSearch()`                                      | `searchParams` prop (a Promise), `search` prop, or `useQueryState`                                   | `different` |
| `useLocation()`                                          | `usePathname()`, `useSearchParams()` (`@farm.js/core/navigation`)                                    | `rename`    |
| `useRouterState({ select: s => s.isLoading })`           | `useNavigation()` (`@farm.js/core/client`): `pending`, `state`, `to`                                 | `different` |
| `useMatch`, `useMatches`, `useChildMatches`              | No match tree API; use `usePathname()` or `createFarmRouter().match()`                               | `none`      |
| `Route.useRouteContext()`                                | Server only: `createRoute` `context`; or middleware data in `props.middleware`                       | `different` |
| `createRootRouteWithContext` + router `context`          | `context: async ({ request }) => ({ ... })` in `farm.config.ts`                                      | `different` |
| `Route.useLoaderDeps()`                                  | No equivalent; use the `search` prop                                                                 | `none`      |
| Search parsing in a file page                            | `loadSearchParams(searchParams, { q: asString.withDefault!("") })` from `@farm.js/core/query/server` | `different` |
| `navigate({ search: (prev) => ({ ...prev, page: 2 }) })` | `useQueryState` / `useQueryStates` from `@farm.js/core/query/client`                                 | `different` |
| Repeated keys                                            | `asArrayOf(parser)`                                                                                  | `different` |

Farm route context is server-only and never serialized to the browser. Type it with
`declare module "@farm.js/core" { interface FarmAppContext { ... } }`. For client-visible
request values, set them in middleware with `context.data.set(key, value)` and read
`props.middleware?.data.get(key)` in the page. Search params are user-editable; validate them on
the server. Docs: `/docs/routing#route-context`, `/docs/query`, `/docs/middleware`.

### Navigation

| TanStack (`@tanstack/react-router`)                   | Farm                                                                                  | Status      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| `<Link to="/about">`                                  | `<Link href="/about">` from `@farm.js/core/client`                                    | `rename`    |
| `<Link to="/posts/$postId" params={{ postId }}>`      | `<Link href="/posts/[postId]" params={{ postId }}>` or ``href={`/posts/${id}`}``      | `rename`    |
| `<Link search={{ q }} hash="top">`                    | `<Link query={{ q }} hash="top">`                                                     | `rename`    |
| `preload="intent" \| "viewport" \| "render" \| false` | `prefetch="intent" \| "viewport" \| "render" \| "none"`, `prefetchDelay`              | `rename`    |
| `activeProps`, `activeOptions`                        | Compare `usePathname()` yourself (Phase 5 example)                                    | `none`      |
| `useNavigate()({ to, replace })`                      | `useRouter().push(href)` / `.replace(href)`, or `navigateTo(href, { replace })`       | `different` |
| `throw redirect({ to })` in loaders                   | `redirect("/path")` / `permanentRedirect()` from `@farm.js/core` (call it; it throws) | `rename`    |
| `<Navigate to>` component                             | `redirect()` on the server, or `navigateTo` in an effect                              | `none`      |
| `throw notFound()`                                    | `notFound()` from `@farm.js/core`                                                     | `rename`    |
| `useRouter().invalidate()`                            | `useRouter().refresh()` from `@farm.js/core/navigation`                               | `rename`    |
| `router.preloadRoute({ to })`                         | `useRouter().prefetch(href)` (`@farm.js/core/navigation`) or `prefetch(href)`         | `rename`    |
| `useBlocker({ shouldBlockFn })`                       | `useBlocker({ when, message })` from `@farm.js/core/client`                           | `different` |
| Building hrefs                                        | `createFarmRouter(routes).build(pattern, params, { query })` (`@farm.js/core/router`) | `different` |

`Link` hrefs are type-checked against generated routes in `src/farm.d.ts`. Docs: `/docs/routing`.

### Server functions

Choose one path per app. Both use `input` schemas and run the handler only on the server.

| Path                              | When                                                          | Toolchain                                                                       | Status                    |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------- |
| A. API routes as server functions | Default for every migration                                   | `farm dev` / `farm build`, `createEndpoint` + typed `apiClient`                 | `different`, stable       |
| B. Farm server functions          | Closest 1:1 shape to `createServerFn`, called from components | RSC pipeline from `@farm.js/plugin/rsc` with `experimental.serverActions: true` | `different`, experimental |

| TanStack Start (`@tanstack/react-start`)          | Farm                                                                                                                         | Status      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `.inputValidator(schema)` (older `.validator`)    | A: `createEndpoint({ body })` or `{ query }`; B: `createServerFn({ input })` (Zod or standard schema)                        | `rename`    |
| Handler `({ data })`                              | A: `({ body, query, params, request, context })`; B: `({ input, request, signal, context, error })`                          | `rename`    |
| `createServerFn({ method: "GET" })`               | A: `export const GET` with a `query` schema; B: `createServerQuery` (`@farm.js/core/server-query`)                           | `different` |
| `createServerFn({ method: "POST" })`              | A: `export const POST` with a `body` schema; B: `createServerFn` (no `method` option)                                        | `different` |
| Call from a loader: `fn({ data })`                | Both: `await fn(input)` from an async page or `data.main`; it runs in process                                                | `rename`    |
| Call from a component, `useServerFn(fn)`          | A: `apiClient.x.post({ body })`; B: `useServerFn` (`@farm.js/core/server-fn/client`) or `useAction` (`@farm.js/core/client`) | `different` |
| Function `createMiddleware({ type: "function" })` | B: `createServerMiddleware` in `middleware: [...]`; A: `createEndpoint({ middleware })`                                      | `different` |
| Typed errors                                      | `errors: { CODE: { status, data } }` and `error("CODE", data)` (A and B)                                                     | `different` |

Before (TanStack):

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getTodos = createServerFn({ method: "GET" })
  .inputValidator(z.object({ done: z.boolean().optional() }))
  .handler(async ({ data }) => db.todo.findMany({ where: data }));

export const addTodo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ title: z.string().min(1) }))
  .handler(async ({ data }) => db.todo.create({ data }));

// loader: () => getTodos({ data: {} })      component: await addTodo({ data: { title } })
```

After, path A (stable). Keep the handlers in a server module, mount them as API routes, call them
directly on the server and through `apiClient` in the browser:

```ts
// src/features/todos/server.ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export async function listTodos(input: { done?: boolean }) {
  return db.todo.findMany({ where: input });
}

export const getTodosEndpoint = createEndpoint(
  {
    query: z.object({
      done: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional(),
    }),
  },
  async ({ query }) => ({ todos: await listTodos(query) }),
);

export const addTodoEndpoint = createEndpoint(
  { body: z.object({ title: z.string().min(1) }) },
  async ({ body }) => ({ todo: await db.todo.create({ data: body }) }),
);

// src/app/api/todos/route.ts
import { addTodoEndpoint, getTodosEndpoint } from "../../../features/todos/server";
export const GET = getTodosEndpoint;
export const POST = addTodoEndpoint;

// src/lib/api.ts
import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";
export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });

// src/app/todos/page.tsx (server, replaces the loader)
const todos = await listTodos({});

// "use client" component (replaces the component call)
const result = await apiClient.todos.post({ body: { title } });
if (result.error) throw result.error;
```

Query values arrive as strings, so coerce them in the `query` schema. `src/lib/api.generated.ts`
is generated by `farm dev` / `farm generate`; never import endpoint modules into `src/lib/api.ts`.
On the server, `api.todos.get(...)` calls the same endpoint in process with its validation.

After, path B (experimental). The declaration is the closest match to TanStack:

```ts
// src/features/todos/actions.ts
import { createServerFn } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

// Input omitted for brevity; a query with `input` must include every input value in `key`.
export const getTodos = createServerQuery({
  key: () => ["todos"],
  async handler() {
    return db.todo.findMany();
  },
});

export const addTodo = createServerFn({
  input: z.object({ title: z.string().min(1) }),
  invalidates: () => [{ key: ["todos"] }],
  async handler({ input }) {
    return db.todo.create({ data: input });
  },
});

// server: const todos = await getTodos();
// client ("use client"): const add = useServerFn(addTodo); await add({ title });
//                        const todos = useServerQuery(getTodos, undefined); (from @farm.js/core/server-query/client)
```

Requirements for path B, verified in source:

- Without the transform, a client module that imports a `createServerFn` or `createServerQuery`
  module fails the build with "createServerFn handlers run only on the server"
  (`packages/farm/src/server-query-boundary.ts`). Calls from server pages work on either path.
- The transform lives in `@farm.js/plugin/rsc` (`server-fn-transform.ts`). The maintained setup,
  `examples/rsc-demo`, runs it from a `vite.config.ts` using `defineConfig` from
  `@farm.js/plugin/rsc` with `@vitejs/plugin-rsc`, `@vitejs/plugin-react`, and
  `react-server-dom-webpack`, and scripts `vite` / `vite build`. That is a different toolchain from
  the `farm dev` / `farm build` pipeline in this guide, and Phase 2 removes `vite.config.ts`.
- Do not set `experimental.serverActions: true` in `farm.config.ts` as a shortcut: under
  `farm dev` / `farm build` the flag only disables the boundary check (`packages/farm/src/vite.ts`),
  so the handler module would be bundled into the browser.
- Same-origin and body-size rules come from `serverActions` in config.

Use path A unless the user explicitly accepts the experimental RSC toolchain. Docs:
`/docs/api-routes`, `/docs/api-client`, `/docs/server-queries`,
`/docs/routing#route-actions`, `/docs/configuration#server-action-security`.

### Server routes and API routes

| TanStack                                                       | Farm                                                                                                                    | Status      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| `createFileRoute("/api/x")({ server: { handlers: { GET } } })` | `src/app/api/x/route.ts` exporting `GET`                                                                                | `different` |
| `createServerFileRoute().methods({...})`, `createAPIFileRoute` | Same: `src/app/api/**/route.ts`                                                                                         | `different` |
| Handler `({ request, params })`                                | Plain export receives `request`; `createEndpoint` handler receives `{ request, params, body, query, headers, context }` | `different` |
| Server route outside `/api`                                    | `defineRoutes(({ api }) => [api("/feed.xml", { GET })])` in `src/farm.routes.ts`                                        | `different` |
| Server route and page on the same path                         | API handlers live under `/api` (or a programmatic `api()` path)                                                         | `none`      |
| Per-route handler middleware                                   | `createEndpoint({ middleware: [fn] }, handler)`                                                                         | `different` |

```ts
// before: src/routes/api/hello.ts
export const Route = createFileRoute("/api/hello")({
  server: { handlers: { GET: async ({ request }) => Response.json({ ok: true }) } },
});

// after: src/app/api/hello/route.ts
export const GET = async () => Response.json({ ok: true });
```

A route without a `HEAD` export answers `HEAD` with its `GET` handler. Change the `/api` mount with
`api: { basePath }` in `farm.config.ts`. Docs: `/docs/api-routes`, `/docs/routing#programmatic-routes`.

### Middleware and request utilities

| TanStack                                                     | Farm                                                                                    | Status      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------- |
| Global `requestMiddleware` in `src/start.ts` (`createStart`) | `src/app/middleware.ts`, or `middleware: [{ matcher, handler }]` in `farm.config.ts`    | `different` |
| Request `createMiddleware().server(({ next }) => next())`    | `middleware().use(async (ctx, next) => { await next(); })` (`@farm.js/core/middleware`) | `rename`    |
| Global `functionMiddleware`                                  | Add `createServerMiddleware` to each `createServerFn` `middleware` array                | `different` |
| Client half `.client(...)` of function middleware            | No client-side middleware for server functions                                          | `none`      |
| `getRequest()`                                               | `getCurrentRequest()` from `@farm.js/core/request`                                      | `rename`    |
| `getRequestHeader(s)`, `getCookie`                           | `headers()`, `cookies()` from `@farm.js/core/headers` (read-only)                       | `rename`    |
| `setCookie`, `setResponseHeader`                             | `ctx.cookies.set`, `ctx.headers.set` in middleware; headers on a `Response`             | `different` |

A global request middleware becomes `src/app/middleware.ts` exporting
`middleware().use(async (ctx, next) => { ctx.headers.set("x-app", "farm"); await next(); })`, or a
named `export async function middleware(request, context)` that continues unless it returns a
`Response`. Returning a `Response` stops the chain. Segment `middleware.ts` files run from the root down for
pages and API routes in that segment. Docs: `/docs/middleware`.

### TanStack Query

| TanStack                                                   | Farm                                                                    | Status      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ----------- |
| `@tanstack/react-query` hooks                              | Keep the package; provide `QueryClientProvider` from a client component | `same`      |
| `QueryClient` in router context                            | Create it in the provider with `useState`                               | `different` |
| `setupRouterSsrQueryIntegration` / `routerWithQueryClient` | No router integration; pass server data as `initialData` props          | `none`      |
| `ensureQueryData` in loaders                               | Fetch in an async page or `data.main`, pass the result as props         | `different` |
| Farm-native alternative                                    | `createServerQuery` + `useServerQuery`, or `apiClient` cache options    | `different` |

```tsx
// src/components/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Render `<Providers>` around `{children}` in `src/app/layout.tsx`. Components rendered by an async
page hydrate as separate islands, so they cannot read React context from a layout provider; keep
pages whose components call `useQuery` synchronous, or wrap the island in its own provider.
`@tanstack/react-query-devtools` can stay inside `Providers`. Docs: `/docs/server-queries`,
`/docs/api-client`.

### Rendering: SSR, streaming, deferred data, prerendering

| TanStack                                         | Farm                                                                                                        | Status      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------- |
| SSR by default                                   | SSR by default                                                                                              | `same`      |
| Unawaited loader promise + `<Await>` / `defer()` | `defer()` from `@farm.js/core` in `createRoute` `data.main`, React `use()` inside `<Suspense>`              | `different` |
| `<Suspense>` boundaries                          | Same, plus `loading.tsx` as the segment fallback                                                            | `same`      |
| Selective SSR (`ssr: false`, `'data-only'`)      | No switch; render browser-only parts in a client component after mount                                      | `none`      |
| `<ClientOnly>`, `useHydrated`                    | Mounted-state wrapper with `useEffect`; `createClientOnlyFn` for functions                                  | `none`      |
| SPA mode (`spa: { enabled: true }`)              | No SPA shell mode                                                                                           | `none`      |
| `prerender: { enabled: true }`                   | `export const dynamic = "force-static"` or `"use ssg"` per page; `routeRules: { "/": { prerender: true } }` | `different` |
| `prerender.crawlLinks`                           | `generateStaticParams` for dynamic segments; no link crawling                                               | `different` |
| ISR via headers                                  | `export const revalidate = 60` or `routeRules` `swr` / `isr`                                                | `different` |

With `defer()`, `data.main` returns `{ product, reviews: defer(getReviews(id)) }`; the component
types the field as `Deferred<Review[]>` (from `@farm.js/core`) and resolves it with `use(reviews)`
inside `<Suspense>`. Keep data needed for the title, redirects, or authorization awaited, not deferred. Docs:
`/docs/server-rendering`, `/docs/routing#deferred-route-data`, `/docs/cache-ppr`.

### Head and SEO

| TanStack `head()` / root `head`                      | Farm                                                              | Status      |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ----------- |
| `meta: [{ title }]`, `{ name: "description" }`       | `export const metadata: Metadata = { title, description }`        | `different` |
| Title from loader data                               | `export async function generateMetadata({ params })`              | `different` |
| Title templates                                      | `title: { default, template: "%s \| Site" }` in a layout          | `different` |
| `links: [{ rel: "icon" }]`                           | `metadata.icons`; other `<link>` tags in the root layout `<head>` | `different` |
| `links: [{ rel: "stylesheet", href: css }]` (`?url`) | `import "./styles.css"` in the layout                             | `different` |
| `scripts: [...]`                                     | `<script>` in the root layout `<head>` or `<body>`                | `different` |
| `<HeadContent />`, `<Scripts />`                     | Remove; Farm injects head tags and scripts                        | `none`      |
| Server route for `sitemap.xml` / `robots.txt`        | `src/app/sitemap.ts`, `src/app/robots.ts`                         | `different` |

`Metadata` and `MetadataProps` are types from `@farm.js/core`. Docs: `/docs/routing#metadata-and-og-images`.

### Environment variables and environment functions

| TanStack                                   | Farm                                                                                                                               | Status      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `import.meta.env.VITE_*` in client code    | Unchanged (Farm keeps Vite's `VITE_` prefix and `.env` loading)                                                                    | `same`      |
| `process.env.X` on the server              | Unchanged                                                                                                                          | `same`      |
| Typed env                                  | Optional `env: { server: {...}, public: {...} }` in `farm.config.ts`, read with `getEnv` / `getPublicEnv` from `@farm.js/core/env` | `different` |
| `createServerOnlyFn(fn)`                   | `createServerOnlyFn(fn)` from `@farm.js/core/environment`                                                                          | `rename`    |
| `createClientOnlyFn(fn)`                   | `createClientOnlyFn(fn)` from `@farm.js/core/environment`                                                                          | `rename`    |
| `createIsomorphicFn().server(a).client(b)` | `createIsomorphicFn({ server: a, client: b })` (inline object)                                                                     | `different` |

Never expose secrets through `VITE_` or `public`. Docs: `/docs/environment-functions`,
`/docs/deployment#environment-variables`.

### Styling and devtools

- Tailwind v4 (`different`): remove `tailwindcss()` from the Vite config; Farm enables it in dev and
  build unless the project has a PostCSS config. `@import "tailwindcss"`, `@theme`, and `@plugin`
  stay (`same`); keep `tailwindcss`, `@tailwindcss/vite`, and plugins such as
  `@tailwindcss/typography` installed.
- `styles.css?url` plus a head link (`different`): side-effect `import "../styles.css"` in the layout.
- `@tanstack/react-devtools`, `@tanstack/devtools-vite` (`different`): add `@farm.js/devtools@<version>`
  as a devDependency and `plugins: [devtools()]` (`devtools` from `@farm.js/devtools`).
- `@tanstack/react-router-devtools` (`different`): the routes view in Farm DevTools, or
  `farm explain <path>`. `@tanstack/react-query-devtools` (`same`): keep it inside `Providers`.

Docs: `/docs/plugins/devtools`.

### Deployment

| TanStack                                         | Farm                                                                  | Status      |
| ------------------------------------------------ | --------------------------------------------------------------------- | ----------- |
| Nitro or hosting Vite plugin in `vite.config.ts` | `deploy: { target: "vercel" \| "cloudflare" \| "netlify" \| "node" }` | `different` |
| Nitro preset name                                | `deploy: { preset: "aws-lambda" }` or `farm build --preset <name>`    | `different` |
| `.output/server/index.mjs`                       | `.farm/.output/server/index.mjs` (node target default)                | `rename`    |
| Health checks                                    | `GET /_farm/health/live`, `GET /_farm/health/ready` (Node output)     | `different` |

A preset overrides a target. Do not add `nitro` or `h3` overrides; Farm pins them. For Docker,
install devDependencies for `farm build`; the runtime image only needs `.farm/.output`. Docs:
`/docs/deployment`, `/docs/route-runtime`.

## Final checklist

- [ ] `vite.config.*` removed from the project root; needed plugins moved to `farm.config.ts` `vite.plugins`.
- [ ] `src/app/layout.tsx` renders the document, imports global CSS, and exports `metadata`.
- [ ] Every route in the baseline list has a `page.tsx` (or `createRoute`) with a default export.
- [ ] No `@tanstack/react-router` or `@tanstack/react-start` imports remain in `src` outside deleted files.
- [ ] Server functions are called from server code or through API routes; secrets stay server-only.
- [ ] `pnpm dev`, `pnpm build`, `pnpm start`, and `pnpm exec tsc --noEmit` pass.
- [ ] Each route returns its baseline status in dev and production; hydration and client navigation work.
- [ ] Farm packages pinned to exact versions; TanStack packages and generated files removed last.
