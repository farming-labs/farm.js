# Migrate from Nuxt to Farm

This document is the complete instruction set for a coding agent that has been asked to migrate a
Nuxt 3 or Nuxt 4 application to Farm while keeping its Vue Single-File Components through the
`@farm.js/vue` renderer. It contains the task contract, the ordered procedure, verification gates,
and a feature parity map that gives every Nuxt feature its Farm file convention, import path, and
status. Do the migration by hand: no Farm CLI command detects or rewrites Nuxt projects. Every Farm
API named here exists in Farm 0.1.14; when this document marks a feature `none`, do not invent a
Farm API for it, use the stated workaround.

Status values: `same` works unchanged; `rename` keeps the behavior but moves the file or changes
the import or name; `different` has a Farm equivalent with another shape, rewrite as shown; `none`
has no Farm equivalent, apply the workaround and list it in the final report.

## Task contract

**Goal.** The same URLs, API contracts, status codes, cookies, metadata, and interactive behavior,
served by Farm with Vue SFC route files.

**Prerequisites.** Node `>=22.13.0` (required by `@farm.js/vue`), pnpm, a clean git working tree,
and a record of the Nuxt app's behavior before you change it: list every page URL, every
`server/api` and `server/routes` endpoint with method and status, and every `routeRules` entry.

**Facts that apply to every migration (verified on Farm 0.1.14):**

- Farm's app directory is `src/app`. Pages are `page.vue`, layouts are `layout.vue`, one folder per
  URL segment.
- Farm aliases `@/` to `src/`. Nuxt's `~/` and `@/` pointed at `app/` (Nuxt 4) or the project root
  (Nuxt 3). Rewrite those imports and the tsconfig `paths`. `~/`, `~~/`, `@@/`, and `#shared` are
  not defined by Farm.
- Build output is `.farm/.output`. The production start script is
  `node .farm/.output/server/index.mjs`. `farm start` runs the same server but needs the
  `@farm.js/cli` devDependency, so use it only locally. Never use `node .output/server/index.mjs`:
  that is Nuxt's output path and will run a stale Nuxt build or fail.
- Farm passes no `configFile: false` to Vite for `farm dev` or for the production client and SSR
  builds, so Vite's default lookup loads a project-root `vite.config.*`. Delete any leftover
  `vite.config.*` that registers Nuxt or other framework plugins, and move options you still need
  into the `vite` field of `farm.config.ts`.
- Farm loads `.env`, `.env.local`, `.env.[mode]`, and `.env.[mode].local` through Vite's `loadEnv`
  when it loads `farm.config.ts`.
- Vue routes are server-rendered HTML with no client JavaScript unless the route module exports
  `hydrate = true`. Vue hydrates at the route boundary: a hydrated page hydrates its whole route.
- Farm has no Vue `Link` component and does not intercept plain `<a>` clicks. `<a href>` performs a
  full document navigation. SPA navigation in Vue is `useRouter().push()` from
  `@farm.js/vue/bindings`.
- Install Vue plugins (Pinia, vue-i18n, UI libraries) with an app setup module: `vue({ app:
"./src/vue-app.ts" })` in `farm.config.ts`, where the module default-exports `defineVueApp((app,
{ ssr }) => { app.use(...) })` from `@farm.js/vue`. Farm calls it for every Vue app: once per
  server render and once per hydrated root. Requires Farm 0.1.22 or later. Server-side store state
  is not transferred to the browser.

**Done means:** every recorded URL returns the same status and content, client navigation and
hydrated interactions work, `pnpm build` and `pnpm start` succeed, type-check passes, and no `nuxt`,
`#app`, `#imports`, `#components`, or `.nuxt` reference remains.

## Migration procedure

Run the phases in order. Do not start a phase until the previous phase's verification passes.

### Phase 1: install Farm next to Nuxt

Pin exact versions: pnpm 11+ applies `minimumReleaseAge`, which can resolve `latest` to an older
Farm release right after a publish. Keep `@farm.js/core` and `@farm.js/cli` on the same version.
If pnpm refuses a version younger than the release-age window, add that exact `package@version` to
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. `@farm.js/vue` requires `vue@^3.5.44`.

```bash
FARM_VERSION=$(npm view @farm.js/core version)
FARM_VUE_VERSION=$(npm view @farm.js/vue version)
pnpm add @farm.js/core@$FARM_VERSION @farm.js/vue@$FARM_VUE_VERSION vue zod
pnpm add -D @farm.js/cli@$FARM_VERSION vue-tsc typescript
```

Create `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue(),
  deploy: { target: "node" },
});
```

Replace `tsconfig.json` (Nuxt's extends `.nuxt/tsconfig.json`, which disappears) and add
`src/env.d.ts`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "farm.config.ts"]
}
```

```ts
/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
```

Set the scripts below and delete `postinstall: nuxt prepare` (installs fail once Nuxt is gone).
Add `.farm` to `.gitignore`. Delete or empty any root `vite.config.*`.

```json
"scripts": {
  "dev": "farm dev", "build": "farm build", "type-check": "vue-tsc --noEmit",
  "start": "node .farm/.output/server/index.mjs"
}
```

**Verify:** with the Phase 2 layout and a one-line `src/app/page.vue`, `pnpm dev` serves
`http://localhost:3000/` and writes `src/farm.d.ts`.

### Phase 2: root layout, global CSS, static assets

Merge `app.vue` and `layouts/default.vue` into `src/app/layout.vue`. Replace `<NuxtLayout>` and
`<NuxtPage>` with `<slot />`. Import global CSS from the normal script block. `public/` stays.
Farm owns `<html>`, `<head>`, and `<body>`; do not render them. Every page and layout needs
`defineOptions({ inheritAttrs: false })` so route props such as `path` do not fall through to the
root DOM element.

```vue
<script lang="ts">
import type { Metadata } from "@farm.js/core";
import "@/assets/main.css";

export const metadata: Metadata = {
  title: { default: "Acme", template: "%s | Acme" },
};
</script>

<script setup lang="ts">
import SiteHeader from "@/components/SiteHeader.vue";
defineOptions({ inheritAttrs: false });
</script>

<template>
  <SiteHeader />
  <slot />
</template>
```

### Phase 3: pages, one route at a time

Create the Farm folder and `page.vue`, add explicit imports, convert `definePageMeta`, navigation,
and data APIs using the parity tables. Keep dynamic segment names identical.
**Verify each page** in `pnpm dev`: status and HTML match the Nuxt recording; the browser console
has no `Failed to resolve component` or hydration warnings.

### Phase 4: server routes, server middleware, mutations

Convert `server/api/**`, then `server/routes/**`, `server/middleware/**`, `server/plugins/**`.
**Verify** every endpoint with `curl -i` using the recorded method, body, and cookies: status,
headers, `Set-Cookie`, and body match. `farm generate` lists the routes in `src/lib/api.generated.ts`.

### Phase 5: route middleware, auth, config, modules

Convert `app/middleware`, `runtimeConfig`, `app.config.ts`, `nuxt.config.ts`, and modules.
**Verify:** protected URLs redirect when signed out; `routeRules` headers and redirects appear in
`curl -i` output.

### Phase 6: production build

Run `pnpm build` then `pnpm start`. **Verify** the Phase 3 and 4 checks against the production
server, including SPA navigation between two hydrated routes and the state that must survive it.

### Phase 7: type-check and remove Nuxt

Run `pnpm type-check`. Remove `nuxt` and every `@nuxt/*`, `@nuxtjs/*`, `@pinia/nuxt`, and `nuxt-*`
package, plus `nuxt.config.ts`, `app.config.ts`, `.nuxt/`, `.output/`, `app/`, `server/`, and Nuxt
deployment files. This search must return nothing; then rerun Phase 6:

```bash
grep -rn --include='*.vue' --include='*.ts' -e "#app" -e "#imports" -e "#components" -e "definePageMeta" -e "defineNuxt" -e "useNuxtApp" -e "useRuntimeConfig" -e "defineEventHandler" src
```

### Failure symptoms and recovery

| Symptom                                                                 | Cause                                                                 | Recovery                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `farm dev` loads Nuxt or unknown Vite plugins                           | Leftover root `vite.config.*`                                         | Delete it; move needed options into `farm.config.ts` `vite`.                               |
| `ReferenceError: ref is not defined` or `definePageMeta is not defined` | Nuxt auto-import or macro left in place                               | Add the explicit `vue` import; delete the macro and use the Farm export.                   |
| `[Vue warn]: Failed to resolve component: ProductCard`                  | Auto-imported component                                               | Import the SFC explicitly in `<script setup>`.                                             |
| Unknown attribute such as `path="/..."` on the root element             | Missing `defineOptions({ inheritAttrs: false })`                      | Add it to every page and layout.                                                           |
| Buttons do nothing in the browser                                       | Route does not export `hydrate = true`                                | Add `export const hydrate = true` in a normal `<script lang="ts">` block.                  |
| Full page reload on every link                                          | Plain `<a href>`; Farm has no Vue link interception                   | Use the `AppLink` component from the Navigation section in hydrated routes.                |
| `Cannot find module '@/...'` or `~/...`                                 | Alias points at the old `app/` layout                                 | Move files under `src/` and rewrite to `@/`; update tsconfig `paths`.                      |
| `pnpm start` serves old content or `Cannot find module .output/...`     | Start script still points at Nuxt output                              | Use `node .farm/.output/server/index.mjs`.                                                 |
| `pnpm install` fails with `nuxt: command not found`                     | `postinstall: nuxt prepare` left in `package.json`                    | Remove the script.                                                                         |
| Type-check fails on `.nuxt/tsconfig.json`                               | Old tsconfig `extends`                                                | Replace tsconfig as in Phase 1.                                                            |
| `getEnv()` returns an old value after redeploying with new env          | Typed env is resolved at build time                                   | Rebuild, or read per-deploy values from `process.env` in server-only modules.              |
| A secret appears in browser bundles                                     | Server value placed in `env.public` or imported into a hydrated route | Move it to `env.server`; read it only in server modules wrapped with `createServerOnlyFn`. |

## Directory structure

Canonical docs: [/docs/project-structure](/docs/project-structure).

| Nuxt 4 path (Nuxt 3 path)              | Farm path                                                   | Status      |
| -------------------------------------- | ----------------------------------------------------------- | ----------- |
| `app/pages/` (`pages/`)                | `src/app/**/page.vue`, one folder per segment               | `different` |
| `app/layouts/default.vue` (`layouts/`) | `src/app/layout.vue`                                        | `rename`    |
| `app/layouts/<name>.vue`               | `src/app/(<name>)/layout.vue` route group                   | `different` |
| `app/app.vue` (`app.vue`)              | merged into `src/app/layout.vue`                            | `rename`    |
| `app/error.vue` (`error.vue`)          | `src/app/error.vue` and `src/app/not-found.vue`             | `different` |
| `app/components/` (`components/`)      | `src/components/`, explicit imports                         | `different` |
| `app/composables/`, `app/utils/`       | `src/composables/`, `src/lib/`, explicit imports            | `rename`    |
| `app/middleware/` (`middleware/`)      | `src/app/**/middleware.ts`                                  | `different` |
| `app/plugins/` (`plugins/`)            | see Plugins                                                 | `different` |
| `app/assets/` (`assets/`)              | `src/assets/`, imported as `@/assets/...`                   | `rename`    |
| `app/app.config.ts` (`app.config.ts`)  | `src/app-config.ts` plain module                            | `different` |
| `server/api/`                          | `src/app/api/**/route.ts`                                   | `different` |
| `server/routes/`                       | `rewrites()` to an API route, or plugin `runtime.endpoints` | `different` |
| `server/middleware/`                   | `src/app/middleware.ts` or `farm.config.ts` `middleware`    | `different` |
| `server/plugins/`                      | `definePlugin` runtime hooks or `src/instrumentation.ts`    | `different` |
| `server/utils/`                        | `src/server/` (any name), explicit imports                  | `rename`    |
| `shared/` (`#shared`)                  | `src/shared/` imported as `@/shared/...`                    | `rename`    |
| `public/`                              | `public/`                                                   | `same`      |
| `content/`                             | `content/` read through `@farm.js/content`                  | `different` |
| `nuxt.config.ts`                       | `farm.config.ts`                                            | `different` |
| `.nuxt/`, `.output/`                   | `.farm/`, `.farm/.output/`                                  | `rename`    |

## Routing

Canonical docs: [/docs/routing](/docs/routing), [/docs/layouts](/docs/layouts), [/docs/renderers/vue](/docs/renderers/vue).

| Nuxt file                                                         | Farm file                                                                                                                                 | Status      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `pages/index.vue`                                                 | `src/app/page.vue`                                                                                                                        | `rename`    |
| `pages/about.vue` or `pages/about/index.vue`                      | `src/app/about/page.vue`                                                                                                                  | `rename`    |
| `pages/posts/[id].vue`                                            | `src/app/posts/[id]/page.vue`                                                                                                             | `rename`    |
| `pages/posts/[[id]].vue` (optional param)                         | `src/app/posts/page.vue` plus `src/app/posts/[id]/page.vue`                                                                               | `different` |
| `pages/docs/[...slug].vue`                                        | `src/app/docs/[...slug]/page.vue`                                                                                                         | `different` |
| optional catch-all                                                | `src/app/docs/[[...slug]]/page.vue`                                                                                                       | `rename`    |
| `pages/(marketing)/pricing.vue`                                   | `src/app/(marketing)/pricing/page.vue`                                                                                                    | `same`      |
| `pages/parent.vue` with `<NuxtPage />` + `pages/parent/child.vue` | `src/app/parent/layout.vue` with `<slot />` + `src/app/parent/child/page.vue`; `pages/parent/index.vue` becomes `src/app/parent/page.vue` | `different` |
| `pages/[...slug].vue` used as a 404 page                          | `src/app/not-found.vue`                                                                                                                   | `different` |
| loading UI                                                        | `src/app/**/loading.vue`                                                                                                                  | `different` |
| `<NuxtLayout>` in `app.vue`, `<NuxtPage />`                       | root `src/app/layout.vue` with `<slot />`, applied automatically                                                                          | `different` |
| nested layouts                                                    | nested `src/app/**/layout.vue`: root wraps nested wraps page                                                                              | `same`      |
| `setPageLayout("name")`                                           | None; layouts are chosen by folder                                                                                                        | `none`      |

- Farm parses `[[id]]` but matches it as a required `:id`; split it into two pages that share one
  component.
- Nuxt gives a catch-all `params.slug` as an array. Farm gives a string joined with `/`
  (`"a/b/c"`), and `""` for an empty optional catch-all. Use `params.slug.split("/")`.
- Route params with the same name twice in one path, and the names `__proto__`, `constructor`,
  `prototype`, are rejected at discovery.

### Page props

Every page receives `params` (object), `searchParams` (a `Promise` of a plain object, arrays for
repeated keys), `path` (string), and `middleware` (middleware data). Declare the ones you use with
an inline type; layouts receive `params`. A Nuxt page using `definePageMeta({ layout: "shop",
middleware: "auth" })`, `useRoute()`, `useFetch()`, and `useHead()` becomes this server-rendered
page with no client JavaScript:

```vue
<script lang="ts">
import type { MetadataProps } from "@farm.js/core";
import { getProduct } from "@/server/products";

export async function generateMetadata({ params }: MetadataProps<"/products/[id]">) {
  const product = await getProduct(params.id);
  return { title: product?.name ?? "Product" };
}
</script>

<script setup lang="ts">
import { getProduct } from "@/server/products";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ params: { id: string } }>();
const product = await getProduct(props.params.id);
</script>

<template>
  <h1>{{ product?.name }}</h1>
</template>
```

The page lives at `src/app/(shop)/products/[id]/page.vue`, the layout at
`src/app/(shop)/layout.vue`, the guard at `src/app/(shop)/middleware.ts`. Make 404 and redirect
decisions in `middleware.ts`, not in `<script setup>`. Top-level `await` in `<script setup>` relies
on Vue's server renderer awaiting async `setup`; use it only in routes without `hydrate = true`,
because a browser async `setup` needs a `<Suspense>` boundary that Farm's Vue root does not add.

### `definePageMeta`

| Key                                  | Farm equivalent                                                                                    | Status      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------- |
| `layout: "name"`                     | Put the page in a route group with `src/app/(name)/layout.vue`                                     | `different` |
| `layout: false`                      | None. The root layout always wraps every page; keep it minimal and put chrome in groups.           | `none`      |
| `middleware`                         | `middleware.ts` in the page folder or its route group                                              | `different` |
| `key`                                | None. Use a Vue `:key` on an element inside the page.                                              | `none`      |
| `alias`                              | `redirects()` or `rewrites()` in `farm.config.ts`                                                  | `different` |
| `name`                               | None. Farm routes are path-based; build hrefs with `createFarmRouter` from `@farm.js/core/router`  | `none`      |
| `validate`                           | Validate `context.params` in `middleware.ts` and call `notFound()` from `@farm.js/core/navigation` | `different` |
| `pageTransition`, `layoutTransition` | None for Vue route changes                                                                         | `none`      |
| page metadata                        | `export const metadata` or `export async function generateMetadata` in `<script lang="ts">`        | `different` |

## Navigation

Canonical docs: [/docs/renderers/vue](/docs/renderers/vue), [/docs/routing](/docs/routing).

| Nuxt API                              | Farm Vue equivalent                                                                           | Status      |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `<NuxtLink to>`                       | `<a href>` (document navigation) or `AppLink` below (SPA, hydrated routes)                    | `different` |
| `<NuxtLink prefetch>`                 | `router.prefetch(href)` from `useRouter()`                                                    | `different` |
| `navigateTo(url)` in a component      | `useRouter().push(url)` / `.replace(url)` from `@farm.js/vue/bindings`                        | `rename`    |
| `navigateTo(url, { external: true })` | `window.location.assign(url)`                                                                 | `different` |
| `navigateTo` in route middleware      | `context.redirect(url)` or `redirect(url)` from `@farm.js/core/navigation` in `middleware.ts` | `different` |
| `useRouter().back()/forward()`        | `useRouter().back()/forward()`                                                                | `same`      |
| `useRoute().params`                   | page prop `params`; in the browser `useRouter({ routes: ["/posts/[id]"] }).params.value`      | `different` |
| `useRoute().query`                    | page prop `searchParams` (Promise); in the browser `useRouter().searchParams.value`           | `different` |
| `useRoute().path`                     | page prop `path`; in the browser `useRouter().pathname.value`                                 | `different` |
| `refreshNuxtData()` / route reload    | `useRouter().refresh()`                                                                       | `different` |
| `abortNavigation()`                   | Return a `Response` from `middleware.ts`                                                      | `different` |

`useRouter()` returns refs and computed values. During server rendering it reports pathname `/`
and empty params, so read URL data from page props on the server. `params` in the browser needs
the `routes` option. Use it only inside component `setup`.

```vue
<!-- src/components/AppLink.vue: use inside routes that export hydrate = true -->
<script setup lang="ts">
import { useRouter } from "@farm.js/vue/bindings";

const props = defineProps<{ href: string }>();
const router = useRouter();

function onClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  void router.push(props.href);
}
</script>

<template>
  <a :href="href" @click="onClick" @pointerenter="router.prefetch(href)"><slot /></a>
</template>
```

In routes that do not hydrate, `AppLink` renders a working `<a href>` (document navigation).

## Route middleware

Canonical docs: [/docs/middleware](/docs/middleware).

| Nuxt                                           | Farm                                                                                                                           | Status      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| named `middleware/auth.ts` + `definePageMeta`  | `middleware.ts` in the protected folder or route group                                                                         | `different` |
| global `middleware/*.global.ts`                | `src/app/middleware.ts` or `farm.config.ts` `middleware: [{ matcher, handler }]`                                               | `different` |
| inline middleware in `definePageMeta`          | `middleware.ts` next to the page                                                                                               | `different` |
| `defineNuxtRouteMiddleware((to, from) => ...)` | `export async function middleware(request: Request, context: RequestMiddlewareContext)` (type from `@farm.js/core/middleware`) | `different` |
| `to.params`, `to.path`, `to.query`             | `context.params`, `context.pathname`, `context.searchParams`                                                                   | `rename`    |
| `return navigateTo("/login")`                  | `return Response.redirect(new URL("/login", request.url))` or `context.redirect("/login")`                                     | `different` |
| `return abortNavigation()`                     | `return new Response("Forbidden", { status: 403 })`                                                                            | `different` |
| client-side-only middleware                    | None; Farm middleware runs on the server                                                                                       | `none`      |

Farm middleware runs on the server, in development and production, for config entries first, then
`src/app/**/middleware.ts` from the root segment down.

```ts
// src/app/(account)/middleware.ts
import type { RequestMiddlewareContext } from "@farm.js/core/middleware";
import { notFound } from "@farm.js/core/navigation";
import { readSession } from "@/server/session";

export async function middleware(request: Request, context: RequestMiddlewareContext) {
  const session = await readSession(request);
  if (!session) return Response.redirect(new URL("/sign-in", request.url));
  if (context.params.id === "0") notFound();
  context.data.set("user.name", session.user.name);
  context.set("session", session);
}
```

The handler continues automatically unless it returns a `Response`. `context.data` values are
client-safe and reach the page as `props.middleware?.data.get("user.name")`. Values from
`context.set()` stay on the server; read them with `getMiddlewareContext()` from
`@farm.js/core/middleware`. Repeat authorization in API routes. `context.cookies.set()` and
`context.headers.set()` add response cookies and headers.

## Data fetching

Canonical docs: [/docs/api-routes](/docs/api-routes), [/docs/api-client](/docs/api-client),
[/docs/server-queries](/docs/server-queries), [/docs/environment-functions](/docs/environment-functions).

| Nuxt                                                | Farm                                                                                                          | Status      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| `useFetch`/`useAsyncData` in a non-interactive page | `await` a server module in `<script setup>` of a route without `hydrate`                                      | `different` |
| `useFetch`/`useAsyncData` in an interactive page    | Fetch in `onMounted` with `apiClient` from `createApiClients()`; render a pending state on the server         | `different` |
| `useLazyFetch`, `server: false`                     | Fetch in `onMounted` with `apiClient`                                                                         | `different` |
| `$fetch("/api/x")` in a component                   | `apiClient.x.get()` (typed HTTP) or `fetch()`                                                                 | `different` |
| `$fetch("/api/x")` in server code                   | Call the server function directly, or `api.x.get()` (dispatches locally on the server)                        | `different` |
| fetch keys, `getCachedData`                         | `createServerQuery({ key, staleTime })` from `@farm.js/core/server-query`, server-side                        | `different` |
| `refresh()` from `useFetch`                         | Call the fetch function again; or `useRouter().refresh()` for server-rendered data                            | `different` |
| `refreshNuxtData(key)`                              | `revalidateTag()` / `revalidatePath()` from `@farm.js/core/cache` on the server, then `useRouter().refresh()` | `different` |
| `clearNuxtData`                                     | None on the client; `revalidateTag()` server-side                                                             | `none`      |
| `pending`, `error`, `status`                        | Own `ref`s around the `apiClient` call (`result.data` / typed `result.error`)                                 | `different` |

Create the shared client once. Never import endpoint modules into this file:

```ts
// src/lib/api.ts
import { createApiClients } from "@farm.js/core/api/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
```

Interactive page:

```vue
<script lang="ts">
export const hydrate = true;
</script>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiClient } from "@/lib/api";

defineOptions({ inheritAttrs: false });
const cart = ref<{ items: { id: string; name: string }[] } | null>(null);
const error = ref<string | null>(null);
onMounted(async () => {
  const result = await apiClient.cart.get();
  if (result.error) error.value = result.error.message;
  else cart.value = result.data ?? null;
});
</script>

<template>
  <p v-if="error">{{ error }}</p>
  <ul v-else-if="cart">
    <li v-for="item in cart.items" :key="item.id">{{ item.name }}</li>
  </ul>
  <p v-else>Loading cart</p>
</template>
```

Wrap server data access with `createServerOnlyFn` from `@farm.js/core/environment` so a module
imported by a route that later hydrates cannot ship its implementation to the browser.

`useServerQuery` and `useAction` from `@farm.js/vue/bindings` exist, but calling a server query or
server function from browser code requires the server-function transform (`@farm.js/plugin/rsc`
with `experimental.serverActions: true`). That path is not documented for Vue; prefer API routes
plus `apiClient`. Do not import `@farm.js/core/server-query/client` in Vue code: it imports React.

## State

| Nuxt                            | Farm                                                                                                 | Status      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| `useState(key, init)`           | None. Browser-only shared state: a module-level `ref` in a composable used by hydrated routes        | `none`      |
| server-to-client state transfer | None generic; pass client-safe values through middleware `context.data` or fetch after mount         | `none`      |
| Pinia via `@pinia/nuxt`         | `app.use(createPinia())` in the app setup module (`vue({ app })`); stores start fresh in the browser | `different` |
| `provide`/`inject` (Vue)        | `provide()` in a layout's `<script setup>`, `inject()` in descendants                                | `same`      |

Module-level state in server-imported modules is shared by every request on the server. Only keep
mutable module state in code that runs in the browser. Client state survives Farm SPA navigation
(`router.push`) but not document navigation (`<a href>` without `AppLink`).

## Server routes and mutations

Canonical docs: [/docs/api-routes](/docs/api-routes), [/docs/api-client](/docs/api-client).

| Nuxt / h3                                     | Farm                                                                                                                          | Status      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `server/api/users.get.ts`                     | `src/app/api/users/route.ts` exporting `GET`                                                                                  | `different` |
| `server/api/users/[id].patch.ts`              | `src/app/api/users/[id]/route.ts` exporting `PATCH`                                                                           | `different` |
| `server/api/files/[...path].ts`               | `src/app/api/files/[...path]/route.ts`                                                                                        | `rename`    |
| `defineEventHandler(handler)`                 | `export const GET = createEndpoint(opts, handler)` from `@farm.js/core/api`, or `export async function GET(request: Request)` | `different` |
| `readBody(event)`                             | `body` in `createEndpoint`, or `await request.json()`                                                                         | `different` |
| `readValidatedBody(event, schema.parse)`      | `createEndpoint({ body: zodSchema }, ...)`; invalid input returns 400                                                         | `different` |
| `getQuery(event)` / `getValidatedQuery`       | `query` (with `query: zodSchema`), or `new URL(request.url).searchParams`                                                     | `different` |
| `getRouterParam(event, "id")`                 | `params.id` in the `createEndpoint` handler; `(await params).id` in `GET(request, { params })`                                | `different` |
| `getHeader(event, name)`                      | `request.headers.get(name)` or `headers: zodSchema`                                                                           | `different` |
| `getCookie(event, name)`                      | `cookies().get(name)?.value` from `@farm.js/core/headers`                                                                     | `different` |
| `setCookie` / `deleteCookie`                  | `Set-Cookie` header on the returned `Response`; in middleware `context.cookies.set/delete`                                    | `different` |
| `createError({ statusCode, data })`           | `Response.json(data, { status })`, or declared `errors` plus `error(code, data)`                                              | `different` |
| `sendRedirect(event, url)`                    | `Response.redirect(new URL(url, request.url), 302)`                                                                           | `different` |
| `setResponseStatus`, `setHeader`              | `new Response(body, { status, headers })`                                                                                     | `different` |
| returning an object                           | Return the object from a `createEndpoint` handler, or `Response.json(obj)`                                                    | `different` |
| `server/routes/health.ts` (no `/api`)         | Plugin `runtime.endpoints` with `path: "/health"`, or a `rewrites()` entry to an API route                                    | `different` |
| WebSocket handlers (`defineWebSocketHandler`) | None                                                                                                                          | `none`      |

Before:

```ts
// server/api/projects/[id].patch.ts
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const body = await readValidatedBody(event, schema.parse);
  if (!getCookie(event, "session")) throw createError({ statusCode: 401 });
  return updateProject(id!, body);
});
```

After:

```ts
// src/app/api/projects/[id]/route.ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { updateProject } from "@/server/projects";

export const PATCH = createEndpoint(
  { body: z.object({ name: z.string().min(1) }) },
  async ({ body, params, request }) => {
    if (!request.headers.get("cookie")?.includes("session=")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return updateProject(String(params.id), body);
  },
);
```

Put shared authorization in `createEndpoint({ middleware: [requireAuth] })`: a function that returns
a context object, `true`, `false` (403), or a `Response`. Declare `invalidates` on the endpoint when
a mutation makes cached data stale. Server functions (`createServerFn` from
`@farm.js/core/server-fn`) hold validated mutation logic and are called from the endpoint handler,
as in the Vue renderer example. `HEAD` falls back to `GET`; unsupported methods return 405.

## Rendering, hydration, and components

Canonical docs: [/docs/server-rendering](/docs/server-rendering), [/docs/renderers/vue](/docs/renderers/vue).

| Nuxt                                                              | Farm                                                                                                                                                                                             | Status      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| universal rendering (SSR + hydration)                             | Server rendering always; hydration only with `export const hydrate = true`                                                                                                                       | `different` |
| `.server.vue` server components                                   | A route without `hydrate` renders server-only HTML and ships no Vue runtime                                                                                                                      | `different` |
| `<NuxtIsland>`                                                    | None inside a hydrated Vue route; hydration is route-wide for Vue                                                                                                                                | `none`      |
| `.client.vue` / `<ClientOnly>`                                    | `onMounted` flag with `v-if` in a hydrated route                                                                                                                                                 | `different` |
| `Lazy` prefix (`<LazyChart>`)                                     | `defineAsyncComponent(() => import("@/components/Chart.vue"))` from `vue`                                                                                                                        | `rename`    |
| `hydrate-on-visible`, `hydrate-on-idle`, `hydrate-on-interaction` | Vue 3.5 `defineAsyncComponent({ loader, hydrate: hydrateOnVisible() })` from `vue`; for a whole route, `export const island = "visible"` (`"idle"`, `"interaction"`, `"load"`) next to `hydrate` | `different` |
| `ssr: false` (SPA mode)                                           | None globally; fetch in `onMounted` in hydrated routes                                                                                                                                           | `none`      |

`<ClientOnly>` replacement:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
const mounted = ref(false);
onMounted(() => (mounted.value = true));
</script>

<template>
  <BrowserChart v-if="mounted" />
  <div v-else class="chart-placeholder" />
</template>
```

Browser-only helpers: `createClientOnlyFn` from `@farm.js/core/environment` throws a clear error if
called during SSR.

## Auto-imports

Nuxt auto-imports are `none` in Farm. Every identifier must be imported explicitly.

| Nuxt auto-import                                                                                                                        | Farm import                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ref`, `computed`, `reactive`, `watch`, `watchEffect`, `onMounted`, `nextTick`, `toRef(s)`, `provide`, `inject`, `defineAsyncComponent` | `import { ... } from "vue"`                             |
| `defineProps`, `defineEmits`, `defineOptions`, `defineModel`                                                                            | Compiler macros; no import needed (`same`)              |
| `app/components/**` (including `<BaseButton>` from `components/base/Button.vue`)                                                        | `import BaseButton from "@/components/base/Button.vue"` |
| `app/composables/**`, `app/utils/**`                                                                                                    | `import { useCart } from "@/composables/useCart"`       |
| `server/utils/**`                                                                                                                       | `import { db } from "@/server/db"`                      |
| `shared/**`                                                                                                                             | `import { slugify } from "@/shared/slugify"`            |
| `#imports`, `#app`, `#components`                                                                                                       | Delete; import from the real module                     |

Find the gaps with `pnpm type-check` (`Cannot find name 'ref'`) and the browser console
(`Failed to resolve component`). Nuxt resolves nested component names by directory prefix; keep the
template name and import the file under that name.

## Head and SEO

Canonical docs: [/docs/routing](/docs/routing) (Metadata And OG Images).

| Nuxt                                         | Farm                                                                                  | Status      |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| `app.head` in `nuxt.config.ts`               | `export const metadata` in `src/app/layout.vue`                                       | `different` |
| `useHead` / `useSeoMeta` (static)            | `export const metadata: Metadata` (type from `@farm.js/core`) in `<script lang="ts">` | `different` |
| `useHead` with route data                    | `export async function generateMetadata({ params })`                                  | `different` |
| `titleTemplate`                              | `title: { default, template: "%s \| Site" }` in a layout                              | `rename`    |
| reactive head changes after mount            | None; set `document.title` in a hydrated component if required                        | `none`      |
| `<Head>`, `<Title>`, `<Meta>` components     | None for Vue; use metadata exports                                                    | `none`      |
| `server/routes/sitemap.xml.ts`, `robots.txt` | `src/app/sitemap.ts`, `src/app/robots.ts` returning `MetadataRoute` values            | `different` |

Farm merges layout metadata from root to leaf and reconciles head tags during client navigation.

## Runtime config, env, and app config

Canonical docs: [/docs/configuration](/docs/configuration), [/docs/environment-functions](/docs/environment-functions).

| Nuxt                                                  | Farm                                                                                                                               | Status      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `runtimeConfig.apiSecret`                             | `env.server.API_SECRET` schema in `farm.config.ts`; `getEnv("API_SECRET")` from `@farm.js/core/env`                                | `different` |
| `runtimeConfig.public.apiBase`                        | `env.public.PUBLIC_API_BASE`; `getPublicEnv("PUBLIC_API_BASE")`                                                                    | `different` |
| `NUXT_API_SECRET` / `NUXT_PUBLIC_*` runtime overrides | None. Typed env keys are the variable names, resolved at build time; read per-deploy values from `process.env` in server-only code | `none`      |
| `useRuntimeConfig()`                                  | `getEnv()` (server) / `getPublicEnv()` (browser or server)                                                                         | `different` |
| `.env` files                                          | `.env`, `.env.local`, `.env.[mode]` loaded by Vite's `loadEnv`                                                                     | `same`      |
| `app.config.ts` + `useAppConfig()`                    | `src/app-config.ts` exporting a typed `const`; import it                                                                           | `different` |

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";
import { z } from "zod";

export default defineConfig({
  renderer: vue(),
  env: {
    server: { API_SECRET: z.string().min(1) },
    public: { PUBLIC_API_BASE: z.string().url() },
  },
});
```

Farm generates the types into `src/farm.d.ts`. Invalid values fail config loading with
`Invalid server env "API_SECRET"`. Never put a secret under `public`.

## `nuxt.config.ts`

| Nuxt key                                          | Farm `farm.config.ts`                                                                                 | Status      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| `modules`                                         | Farm integrations, plugins, or ordinary packages (see Modules)                                        | `different` |
| `routeRules: { prerender }`                       | `routeRules: { "/": { prerender: true } }`                                                            | `same`      |
| `routeRules: { swr, isr }`                        | `swr` / `isr`: `true` or TTL seconds                                                                  | `same`      |
| `routeRules: { redirect }`                        | `redirect: "/new"` or `{ to, statusCode }` (301, 302, 303, 307, 308)                                  | `same`      |
| `routeRules: { headers, cors }`                   | `headers: {...}`, `cors: true` or an object                                                           | `same`      |
| `routeRules: { ssr: false }`                      | None documented; keep the route server-rendered and fetch in `onMounted`                              | `none`      |
| per-page cache                                    | `export const revalidate = 60` or `export const dynamic = "force-static"` in the page's normal script | `different` |
| `app.baseURL`                                     | `basePath: "/console"`                                                                                | `rename`    |
| `css: [...]`                                      | `import "@/assets/main.css"` in `src/app/layout.vue`                                                  | `different` |
| `alias`                                           | `vite.resolve.alias` plus tsconfig `paths`; prefer `@/`                                               | `different` |
| `vite: {...}`                                     | `vite: {...}` (object or function)                                                                    | `same`      |
| `nitro.preset`                                    | `deploy.target` or `deploy.preset`                                                                    | `rename`    |
| `nitro.storage`                                   | `storage.mounts`                                                                                      | `different` |
| `nitro.scheduledTasks`                            | `cron`                                                                                                | `different` |
| `nitro.routeRules`                                | `routeRules`                                                                                          | `rename`    |
| `experimental.*`, `future.*`, `compatibilityDate` | None; delete                                                                                          | `none`      |
| `devtools`                                        | `plugins: [devtools()]` from `@farm.js/devtools` (optional devDependency)                             | `different` |
| `typescript.typeCheck`                            | `vue-tsc --noEmit` script                                                                             | `different` |
| `extends` (Nuxt layers)                           | `extends` with Farm layers under `layers/<name>`; layer contents must be rewritten like the app       | `different` |

Redirects that are not tied to one route go in `async redirects()`; `:path*` captures the rest of a
path. Canonical docs: [/docs/configuration](/docs/configuration), [/docs/route-runtime](/docs/route-runtime).

## Nitro server features

Canonical docs: [/docs/storage](/docs/storage), [/docs/cache-ppr](/docs/cache-ppr),
[/docs/cron](/docs/cron), [/docs/after](/docs/after), [/docs/plugins/create-plugin](/docs/plugins/create-plugin).

| Nitro                                                            | Farm                                                                                                       | Status      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| `useStorage("data")`                                             | `getStorage("data")` from `@farm.js/core/storage`; same `getItem`/`setItem`/`getKeys`/`removeItem`         | `rename`    |
| storage drivers in `nitro.storage`                               | `storage.mounts: { data: redisStorage(...) }` (`sqliteStorage`, `s3Storage`, `upstashStorage`, ...)        | `different` |
| `defineCachedFunction(fn, opts)`                                 | `unstable_cache(fn, keyParts, { tags, revalidate })` from `@farm.js/core/cache`                            | `different` |
| `defineCachedEventHandler`                                       | `Cache-Control` on the response, a `routeRules` `swr`/`isr` entry, or `unstable_cache` inside the handler  | `different` |
| cache invalidation                                               | `revalidateTag()`, `revalidatePath()` from `@farm.js/core/cache`                                           | `different` |
| `scheduledTasks` + `defineTask`                                  | `cron: { name: { schedule, path } }` and `export const GET = cronRoute(handler)` from `@farm.js/core/cron` | `different` |
| `runTask()` on demand                                            | None; call the same server function from an API route                                                      | `none`      |
| `event.waitUntil(promise)`                                       | `after(callback)` from `@farm.js/core/after`                                                               | `different` |
| `defineNitroPlugin` with `request`/`afterResponse`/`close` hooks | `definePlugin({ runtime: { start, before, after, close } })` from `@farm.js/core`, registered in `plugins` | `different` |
| SDK init at server start                                         | `src/instrumentation.ts` exporting `register()`                                                            | `different` |

`getStorage()` falls back to an in-memory store for unknown mount names; configure a durable mount
for production. `cronRoute()` requires `CRON_SECRET` outside development.

## Error handling

Canonical docs: [/docs/routing](/docs/routing) (File Route States).

| Nuxt                                         | Farm                                                                               | Status      |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| `error.vue` (full-screen app error)          | `src/app/error.vue` (nearest segment boundary) receiving `error` and `reset` props | `different` |
| 404 through `error.vue`                      | `src/app/not-found.vue`                                                            | `different` |
| `createError({ statusCode: 404 })` in a page | `notFound()` from `@farm.js/core/navigation` in `middleware.ts`                    | `different` |
| `showError(err)`                             | Throw an `Error` during render; the nearest `error.vue` renders it                 | `different` |
| `clearError({ redirect })`                   | `reset()` prop, or navigate with `useRouter().push()`                              | `different` |
| `<NuxtErrorBoundary>`                        | A wrapper component using Vue's `onErrorCaptured`, or a segment `error.vue`        | `different` |
| `useError()`                                 | The `error` prop of `error.vue`                                                    | `different` |

```vue
<!-- src/app/error.vue -->
<script setup lang="ts">
defineOptions({ inheritAttrs: false });
const props = defineProps<{ error: unknown; reset: () => void }>();
const message = props.error instanceof Error ? props.error.message : "Something went wrong";
</script>

<template>
  <section>
    <h1>Error</h1>
    <p>{{ message }}</p>
    <a href="">Reload</a>
  </section>
</template>
```

Production responses show a generic message; details stay in server logs. A `reset()` button needs
the boundary to hydrate.

## Plugins

Canonical docs: [/docs/plugins/client](/docs/plugins/client), [/docs/project-structure](/docs/project-structure).

| Nuxt                                                    | Farm                                                                                       | Status      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| `defineNuxtPlugin` calling `nuxtApp.vueApp.use(plugin)` | `app.use(plugin)` in the app setup module (`vue({ app })`)                                 | `different` |
| `provide: { helper }` / `useNuxtApp().$helper`          | Export the helper from a module and import it                                              | `different` |
| global directives (`vueApp.directive`)                  | `app.directive()` in the app setup module, or register locally in `<script setup>`         | `different` |
| global components (`vueApp.component`)                  | `app.component()` in the app setup module, or explicit imports                             | `different` |
| browser analytics / router event plugins                | `definePlugin({ client: { setup, navigation, hydration } })` in `farm.config.ts` `plugins` | `different` |
| small DOM enhancements on every page                    | `src/client.ts` with `defineClient` from `@farm.js/core/client/lifecycle`                  | `different` |
| `.server.ts` plugins                                    | `definePlugin` `runtime` hooks or `src/instrumentation.ts`                                 | `different` |

## Modules

| Nuxt module                              | Farm replacement                                                                                                                                                                                                                                                | Status      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `@nuxtjs/tailwindcss`                    | Built in: Farm enables Tailwind v4 through the installed `@tailwindcss/vite` unless a project PostCSS config exists; `@import "tailwindcss";` in global CSS                                                                                                     | `different` |
| `@nuxt/image` (`<NuxtImg>`)              | `<img>` with `srcset` built from `/_farm/image?url=...&w=...&q=75`; `w` must be in `images.deviceSizes`/`imageSizes`, remote hosts need `images.remotePatterns`. The `Image` component in `@farm.js/core/image` is React-only                                   | `different` |
| `@nuxt/fonts`                            | `@fontsource-*` CSS imports in the root layout, or `localFont`/`remoteFont` from `@farm.js/core/font` declared in a `.ts` module (calls inside `.vue` files are not compiled)                                                                                   | `different` |
| `@nuxt/content`                          | `@farm.js/content` collections in `plugins`; `getCollection`/`getEntry` from `@farm.js/content/server` in server code. `body` is raw Markdown: render it yourself; MDC components are `none`                                                                    | `different` |
| `@nuxtjs/i18n`                           | `i18n` in `farm.config.ts`, catalogs in `src/messages/<locale>.json`, `t` from `@farm.js/core/i18n/server`, `useI18n`/`useTranslations` from `@farm.js/vue/bindings`                                                                                            | `different` |
| `@nuxt/ui`                               | Install its Vue plugin with `app.use()` in the app setup module; it is a Nuxt module, so check which components work without Nuxt                                                                                                                               | `different` |
| `@pinia/nuxt`                            | `pinia` installed with `app.use(createPinia())` in the app setup module (see State)                                                                                                                                                                             | `different` |
| `nuxt-auth-utils`, `@sidebase/nuxt-auth` | Better Auth through `@farm.js/better-auth` (`integrations: { auth: betterAuth({ instance }) }`) with `createAuthClient` from `better-auth/vue`; or built-in `auth: true` with `@farm.js/auth` (server helpers in `@farm.js/auth/server`, client APIs are React) | `different` |
| `@nuxt/devtools`                         | `@farm.js/devtools`                                                                                                                                                                                                                                             | `rename`    |
| `@nuxt/eslint`                           | Plain ESLint or oxlint config                                                                                                                                                                                                                                   | `none`      |

For a working Vue reference of Better Auth, generate one in a scratch directory:
`pnpm create @farm.js/app ref-auth --template better-auth --renderer vue --typescript`. Docs:
[/docs/integrations/auth/better-auth](/docs/integrations/auth/better-auth), [/docs/images](/docs/images),
[/docs/fonts](/docs/fonts), [/docs/plugins/content](/docs/plugins/content),
[/docs/internationalization](/docs/internationalization).

## Deployment

Canonical docs: [/docs/deployment](/docs/deployment).

| Nuxt / Nitro preset           | Farm `deploy`                                                                        | Output                                 | Status      |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------- | ----------- |
| `node-server` (default)       | `target: "node"`                                                                     | `.farm/.output`                        | `rename`    |
| `vercel`                      | `target: "vercel"`                                                                   | `.vercel/output`                       | `rename`    |
| `netlify`                     | `target: "netlify"`                                                                  | `dist` + `.netlify/functions-internal` | `rename`    |
| `cloudflare-pages`            | `target: "cloudflare"`                                                               | `.farm/.output`                        | `rename`    |
| any other Nitro preset        | `preset: "aws-lambda"` (or `farm build --preset <name>`)                             | Nitro provider shape                   | `rename`    |
| `nuxi generate` (full static) | `routeRules` `prerender: true` per route, or `export const dynamic = "force-static"` | per target                             | `different` |

Self-hosted: `node .farm/.output/server/index.mjs` with `HOST` and `PORT`; the output is
self-contained. Do not override Farm's pinned `nitro` or `h3`. Remove Nuxt build commands from host
settings.

## Testing

Canonical docs: [/docs/testing](/docs/testing).

| Nuxt                                  | Farm                                                                                           | Status      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------- |
| `@nuxt/test-utils` `$fetch` / `setup` | `createFarmTestHarness()` from `@farm.js/core/testing`; `farm.endpoint(GET, { path, params })` | `different` |
| server function unit tests            | `farm.serverFn(fn, input)`                                                                     | `different` |
| `mountSuspended` component tests      | `mount` from `@vue/test-utils` with `@vitejs/plugin-vue` in a Vitest config                    | `different` |
| `@nuxt/test-utils/e2e`                | Playwright against `pnpm build && pnpm start`                                                  | `different` |
| `nuxi typecheck`                      | `vue-tsc --noEmit`                                                                             | `rename`    |

## Final report

When finished, report to the user: the routes and endpoints migrated, every feature you resolved
with a `none` workaround, the output of `pnpm build`, `pnpm start` checks, and `pnpm type-check`,
and anything you could not reproduce exactly (for example Pinia state that Nuxt hydrated from the
server, or Nuxt UI components that need Nuxt).
