---
title: "Rendering Model"
description: "Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config."
section: "Core"
---

# Rendering Model

Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.

Rendering controls decide when HTML is produced. [Route Runtime](/docs/route-runtime) separately decides where a dynamic page or API handler executes and how deployment limits are applied.

Dynamic rendering, static rendering, and revalidation apply to every renderer. The component
examples below use React-compatible TSX; see [Renderers](/docs/renderers) for Preact, Solid, Vue, and
Svelte conventions and the features that remain React-specific.

## Rendering options

RSC page URLs return HTML for document visits and a Flight payload for requests accepting
`text/x-component`. Both representations include `Vary: Accept`. When you enable shared caching,
configure the CDN or reverse proxy to honor `Vary`; do not cache these responses by URL alone.
Farm preserves existing `Vary` fields, including `Origin` and Nitro's `Accept-Encoding`.

| Mode    | How to opt in                                  | Best for                                |
| ------- | ---------------------------------------------- | --------------------------------------- |
| Dynamic | Default for request-bound pages                | Dashboards and personalized UI.         |
| Static  | dynamic = force-static or use static directive | Marketing pages and stable docs.        |
| ISR     | revalidate = seconds                           | Content that can refresh on a schedule. |
| PPR     | experimental_ppr = true                        | Static shells with dynamic holes.       |

## Route-level config

**src/app/pricing/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 300;

export default async function PricingPage() {
  return <main>Pricing</main>;
}
```

## Use directives when compactness wins

Farm also recognizes compact rendering directives at the top of route modules. This keeps small examples readable while preserving explicit exports for Next-style compatibility.

**src/app/blog/page.tsx**

```tsx
"use ssg; 60";

export default function BlogPage() {
  return <main>Blog</main>;
}
```

`use ssg; 60` statically generates the route and revalidates it every 60 seconds. Farm also accepts
`use ssg`, `use dynamic`, and `use ppr; 60` when those rendering modes fit the route.

## Dynamic rendering

Use dynamic rendering for request-specific pages such as dashboards, account settings, and pages that depend on cookies, headers, or per-user data.

With experimental React Server Components enabled, Farm streams HTML while inserting the styles,
hydration payload, and client script. HTML injection preserves UTF-8 bytes across stream chunks,
including emoji and non-ASCII content, without buffering the entire page.

**src/app/dashboard/page.tsx**

```tsx
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <main>Dashboard</main>;
}
```

## Static rendering

Use static rendering for pages that can be built once and served quickly.

During a production build, Farm also scans routes that use the default dynamic mode. If a
non-parameterized route does not read cookies, headers, authentication, search parameters, or
middleware request data, Farm reports it as a static-rendering candidate. The build keeps the route
dynamic until you opt in, because request-bound work may be hidden in an imported component or data
loader.

Review each suggestion, including its imported code, then add the static export when it is safe. This
keeps personalized pages dynamic while making stable pages easy to move onto the fastest rendering
and caching path.

If an explicitly static route directly reads request APIs or request props, Farm reports the unsafe
read and keeps the route dynamic instead of freezing request-specific HTML into a shared artifact.
This check covers the route module itself; continue reviewing imported components and data loaders,
because request-bound work in transitive imports cannot be proven safe from the route source alone.

Farm serves generated HTML only for `GET` and `HEAD` requests. Other request methods continue through
the live route instead of receiving a cached page document.

**src/app/about/page.tsx**

```tsx
export const dynamic = "force-static";

export default function AboutPage() {
  return <main>About Farm</main>;
}
```

## ISR-style revalidation

`revalidate` caches a static response and refreshes it after the configured number of seconds.

**src/app/pricing/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 300;

export default async function PricingPage() {
  const plans = await loadPlans();
  return <PricingTable plans={plans} />;
}
```

## PPR with Suspense

PPR is for pages with a stable shell and dynamic sections. Put dynamic work behind Suspense boundaries so the shell can be cached while the slower section resolves independently.

**src/app/dashboard/page.tsx**

```tsx
import { Suspense } from "react";

export const experimental_ppr = true;
export const revalidate = 60;

export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<RevenueSkeleton />}>
        <RevenuePanel />
      </Suspense>
    </main>
  );
}
```

## Deferred route islands

The route-level hydration strategy is shared by renderer adapters. Preact uses the same nested
`"use client"` analysis through its compatibility runtime; Solid, Vue, and Svelte currently hydrate
at the route boundary selected by their adapter.

Client routes and server routes that import a client boundary can defer their JavaScript while Farm
keeps the server-rendered HTML visible. Add an optional static `island` export to the client module:

```tsx
"use client";

export const island = "interaction";

export function CopyButton({ value }: { value: string }) {
  return <button onClick={() => navigator.clipboard.writeText(value)}>Copy</button>;
}
```

Farm propagates the strategy to the route hydration boundary, emits it in the route manifest, and
splits production route modules behind dynamic imports. Deferred routes therefore avoid evaluating
their route chunk until its trigger while preserving the initial SSR output.

These strategies control hydration of the initial server-rendered document. During client-side
navigation, the navigation itself signals user intent, so Farm loads and renders a route-wide
destination immediately instead of leaving the previous route visible while waiting for another
trigger.

| Strategy      | Hydration trigger                                                     |
| ------------- | --------------------------------------------------------------------- |
| `load`        | Immediately. This is the default and compatibility-first behavior.    |
| `interaction` | The first button-like click; Farm replays that click after hydration. |
| `visible`     | When the route boundary approaches the viewport.                      |
| `idle`        | During browser idle time, with a timeout fallback.                    |

With [isolated client hydration](/docs/configuration#isolated-client-hydration), each eligible
client module keeps its own strategy, including after SPA navigation. Sibling boundaries can mix
all four strategies: one boundary's trigger never hydrates another, and an interaction click is
claimed and replayed once by the boundary that contains it. Removing a boundary cancels its pending
observer, idle callback, or interaction listener.

Farm uses the same isolated boundary metadata for Vite development, streamed or buffered SSR, and
statically generated HTML. In development, updating a client module rerenders every live boundary
created from that module without importing or replacing its server-owned layout; sibling boundary
state stays mounted. If one page needs the route-wide fallback, that fallback stays on the page
boundary and does not promote otherwise eligible client leaves in its server-owned layout.
Farm also keeps graphs above four statically bounded isolated roots route-wide. Data-dependent
boundary lists use the same fallback because their root count is unknown before streaming. This
measured guard prevents request, marker, root, and hydration overhead from growing past the first
observed crossover; the [benchmark report](https://github.com/farming-labs/farm.js/blob/main/benchmarks/isolated-hydration/results/latest.md) includes route-wide, isolated, and RSC controls with raw samples.
The representative fixtures also run route-wide and isolated hydration with Farm's experimental
React compiler enabled, proving both the initial hydration cost and repeated state-update cost of
the combined path.

The export must be one of these static string literals so Farm can analyze it without executing
application code. Without an explicit route-level `island` export, a route that imports client
boundaries with different strategies safely falls back to `load` because its current route-level
React-compatible root cannot schedule those children independently. Keep interactive leaves small today; a
eligible leaves can also use Farm's experimental React compiler for direct state binding updates
after their independent roots mount.

### Async pages and client components

A page or layout can be an `async` server component and still render `"use client"` components that
work in the browser:

```tsx
import { StarButton } from "./star-button";

export default async function RepoPage() {
  const repo = await getRepo();
  return (
    <main>
      <h1>{repo.name}</h1>
      <StarButton initialCount={repo.stars} />
    </main>
  );
}
```

React cannot run an `async` component in the browser, so the page itself stays server-rendered and
never ships to the client. Each eligible client boundary it renders hydrates as its own island, with
the props the server passed it. This works by default in React apps; it does not need
`experimental.isolatedClientHydration`. The same applies to a page, async or not, that renders an
`async` server component: that component's client components hydrate as islands too.

Under a parent layout that hydrates as a whole route, such as one that wraps the app in a client
provider, the async page hydrates inside the layout's React tree instead. Farm resolves the page on
the server into its elements and client-component references, embeds that tree in the HTML, and the
browser rebuilds it under the layout, so the page's client components read the layout's context and
share its state. Server JSX passed to a client component, as `children` or any other prop, stays
server output, Suspense
content streams in, and the tree is rebuilt after client navigation between pages of that layout.
A part the server cannot describe this way, such as a server component that calls hooks or a client
component whose props do not serialize, stays server HTML whose own client components hydrate as
islands.

Navigating away cancels pending island work and unmounts its roots without waiting for hydration.
React's early-update diagnostic during that synchronous cancellation is expected; hydration
mismatches, updates to live roots, and other errors are still reported.

Islands have the same limits as [isolated client leaves](#isolated-client-leaves-without-rsc):

- Props must be serializable. Server-rendered JSX passed as `children` or another prop
  (`<ClientShell><ServerList /></ClientShell>`) crosses only under a hydrating layout (above);
  elsewhere that one client component keeps its server HTML and Farm logs it once.
- A client component must export each component by name (`export function Name`,
  `export { Name }`, `export { Name } from "./name"`, or `export default`), not through
  `export *`, and must not sit where the HTML parser moves it: directly inside `<table>`, `<tbody>`,
  `<tr>`, `<select>` or `<svg>`. Inside a `<td>`, `<th>`, `<caption>` or `<foreignObject>` it is
  fine.
- An integration provider that wraps the whole route, and does not declare
  `supportsIsolatedHydration: true`, keeps its routes route-wide.

When one of these applies, the route stays server-rendered, its client components are not
interactive, and Farm logs a warning naming the module and the reason. Fix the reason, or render
the interactive part from a synchronous page. Preact, Solid, Vue, and Svelte keep async pages
server-only.

In [islands mode](#react-server-components) every page is a server component, so hydrating a page whole
would ship its module and its server-only imports to the browser. Islands mode never does that:
`farm build` fails and names each page, the reason, and how to restructure it, and `farm dev` logs
the same error and serves the page without client JavaScript.

Client components that come from a package, such as the icons in `lucide-react`, cannot be isolated
yet. An async page renders them as static HTML and still hydrates its own client components as
islands, and Farm logs which packages it left static.

### Isolated client leaves without RSC

`"use client"` also remains available in a normal React SSR application. Set
`experimental.isolatedClientHydration` to `"analyze"` to audit which local client leaves Farm can
split without changing runtime behavior, or to `"enabled"` to hydrate safe leaves independently.
Unsupported routes keep the existing route-wide ownership model. See
[Isolated client hydration](/docs/configuration#isolated-client-hydration) for the modes and safety
rules. This experiment is disabled when RSC owns the route. Integration providers also keep the
route-wide root unless they explicitly declare that they can be recreated around independent
isolated roots.

## React Server Components

Turn on React Server Components in `farm.config.ts`. `farm dev`, `farm build`, and `farm start`
then run Farm's RSC pipeline on the official `@vitejs/plugin-rsc`: pages and layouts are server
components, and `"use client"` marks client components.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
});
```

That is the whole setup. When the RSC packages are missing, `farm dev` and `farm build` install
them with the app's package manager: `@farm.js/plugin` at the installed `@farm.js/core` version, and
`@vitejs/plugin-rsc`, `react`, `react-dom` and `react-server-dom-webpack` at the exact versions the
plugin requires. Commit the updated `package.json` and lockfile. In CI (`CI` is set) nothing is
installed: `serverComponents: true` runs without RSC and warns, and an explicit `mode` fails with the
command to run. Set `FARM_SKIP_RSC_INSTALL=1` anywhere else the build must not change dependencies.
Fast Refresh works in development without more setup; an app that installs `@vitejs/plugin-react`
gets its own copy instead of Farm's.

`serverComponents: true` is the same as `serverComponents: { mode: "rsc" }`, React's own server
components engine. `{ mode: "islands" }` is Farm's own engine
([RFC 0003](https://github.com/farming-labs/farm.js/blob/main/rfcs/0003-islands-server-components.md)),
built on [islx](https://github.com/farming-labs/islx), its renderer-agnostic wire format:
it renders on Farm's normal pipeline, sends static output once as HTML, and hydrates only client
components. A client component that receives server output (`children`, or any element prop) keeps
that output as a slot of the existing HTML instead of receiving it again, and a server page under a
layout that hydrates (a client provider, say) hydrates inside that layout's tree, so its client
components read the provider's context. That layout, and the other server layouts on its pages,
render as server trees too: the browser rebuilds them from the HTML, so their modules and their
server-only imports never reach it, and a navigation keeps the provider's state. A provider
imported straight from a package fails the build; render it from a local `"use client"` module
(a `providers.tsx`) instead. A large prop value (512 bytes of JSON or more, such as a
navigation tree) travels once, keyed by its content: client components that share it share one
copy, and a client navigation leaves out the values the browser already holds. A client navigation
also leaves out the layouts the browser keeps: the server renders the page and any layout that
changed, so a layout's client state survives and its HTML is not sent again. A layout the browser
keeps does not render on that navigation, so put access checks in middleware or a page `guard`,
not in a layout's body. `router.refresh()` and full loads render every layout. A PPR route caches
each segment under its own key next to the full page, and sends every value so the cached HTML
suits any browser; a prerendered page always sends the whole document. A page under a layout that
hydrates as one root (a client provider around the pages) sends its large prop values once too,
in the payload its client components rebuild from. When the browser already renders that layout,
a navigation to such a page carries only that payload: the browser rebuilds the page in the
layout's React tree, so the server leaves out the page's HTML. `"use server"`
functions work from forms, with or without JavaScript, and from client components, in `farm dev`
and in production. A server component can pass one to a client component as a prop, and can
declare one inline: an `async` function with `"use server"` as its first statement may read the
component's variables, which travel with it sealed (AES-GCM, bound to the action) rather than as
form fields the browser could read or change. Every instance of one build shares the sealing key;
set `ISLX_ACTIONS_KEY` to keep forms on open pages working across deploys. A `<form>` written in a
server component posts its action without a page load once JavaScript runs. After an
action called from JavaScript, the page refreshes, as the form posted without JavaScript would show
it: islands still on the page keep their state and get their new props, and a `redirect()` from the
action becomes a client navigation. Props and action arguments are not limited to JSON:
`undefined`, `NaN`, `Infinity`, `-0`, `BigInt`, `Date`, `Map`, `Set`, `URL`, `RegExp`, typed arrays
and `ArrayBuffer` arrive as themselves (`URL` and `RegExp` in islands mode only; RSC does not
support them). Functions other than server actions and class instances do not cross; a client
component given one keeps its server HTML and is not hydrated. Islands mode needs none of the RSC packages and is experimental. Both modes share
the authoring rules on this page, so switching between them is a one-line change; the same contract
tests (`tests/e2e-server-components`) run against both, in development and in production builds.
`benchmarks/server-components-payload` compares what each mode sends.

The app's `vite` options and plugins apply as in other Farm apps, and so does built-in Tailwind.
The build goes to the deploy target's
output directory, so `farm start` and platform deploys work unchanged.

The pipeline does not run every Farm feature yet:

- `auth`, `integrations`, `headers`, `redirects`, `rewrites`, `routeRules`, and `context` decide
  what a request may see or receive. Running the app without them could expose what they protect,
  so `farm dev` and `farm build` stop with an error that names them.
- Farm `plugins`, `storage`, `schema`, `cron`, `workflows`, `docs`, `theme`, and `observability`
  are ignored, with a warning.

Before this flag ran the RSC pipeline it only switched off isolated hydration, so some apps set it
without using React Server Components. If such an app uses `auth`, `integrations` or another
feature above that RSC cannot run yet, nothing is installed and it keeps running without React
Server Components, with a warning that says why. `{ mode: "rsc" }` is always treated as a
deliberate choice. `farm doctor` reports which way an app goes.

A `vite.config.ts` built with `defineConfig` from
`@farm.js/plugin/rsc` and the `vite` CLI keeps working, as in the
[`rsc-demo` example](https://github.com/farming-labs/farm.js/tree/main/examples/rsc-demo).

Both setups follow the same route contract:

- **Static pages.** A page that opts in to static rendering, as in [Static rendering](#static-rendering),
  is prerendered at build time together with its RSC payload. A dynamic route lists its paths with
  `generateStaticParams()`. Client navigation fetches the payload at `<page>.rsc` (`/index.rsc` for
  `/`), so a prerendered page navigates without reaching the server. A page that any middleware may
  handle, and every page of an app with i18n, stays server-rendered, because middleware never sees a
  static file. Pages with `revalidate` also render on each request for now; the pipeline has no
  revalidating cache yet. A page that asks to be static and fails to render fails the build.
- **Metadata.** Layouts and pages resolve `metadata`, `generateMetadata()`, and viewport exports in
  the same order and with the same title templates as other Farm apps, and the server renders the
  same head tags.
- **Images.** `<Image>` follows the app's `images` config. Without `sharp`, `provider: "auto"` keeps
  original image URLs, and the optimizer at `images.path` runs only when it can.
- **Root layouts.** A root layout that renders `<html>` owns the document, as in Next.js, and the
  browser hydrates the whole document.

A client that loaded an older deployment and fetches a prerendered payload from a newer one does not
get the deployment-mismatch reload that a server-rendered payload triggers.

## Automatic optimized boundaries

Automatic optimized boundaries are a React-only experiment and are not applied to Preact, Solid,
Vue, or Svelte routes.

Farm can experimentally render large, non-interactive Server Component regions through the native
Strata renderer. Enable the flag once in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
    optimizedBoundary: true,
  },
});
```

Application components remain ordinary JSX:

```tsx
export default function ArticlePage() {
  return (
    <article className="prose">
      <h1>Representation-aware rendering</h1>
      <p>Farm selects this host-only region automatically.</p>
    </article>
  );
}
```

Farm evaluates eligible host-element trees on the server and uses Strata only when the region is
large enough to benefit. Trees containing Client Components, event handlers, refs, unsupported
elements or attributes, unsafe URLs, or other uncertain values retain normal React rendering. The
flag does not require an application boundary component or a direct Strata dependency.

The current Strata runtime uses a native Node binding. Keep this experiment on Node deployments until
a Wasm or JavaScript fallback is available for edge and Cloudflare worker targets.

## Choosing a mode

| Need                                   | Use                                     |
| -------------------------------------- | --------------------------------------- |
| User-specific data on every request    | `dynamic = "force-dynamic"`             |
| Stable docs, marketing, or policy page | `dynamic = "force-static"`              |
| Stable page with scheduled refresh     | `revalidate = 60`                       |
| Static shell plus dynamic holes        | `experimental_ppr = true` with Suspense |
