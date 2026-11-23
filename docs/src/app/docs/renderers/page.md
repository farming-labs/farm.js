---
title: "Renderers"
description: "Choose React, Preact, Solid, Vue, or Svelte for application UI while keeping FARMJS routing, server APIs, middleware, observability, and deployment."
section: "Core"
---

# Renderers

Choose React, Preact, Solid, Vue, or Svelte for application UI while keeping FARMJS routing, server
APIs, middleware, observability, and deployment. React remains the default; Preact, Solid, Vue, and
Svelte are beta renderer adapters.

## Choose a renderer

| Renderer                         | Select it with       | Route components | Best fit                                                     |
| -------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------ |
| [React](/docs/renderers/react)   | Omit `renderer`      | `.tsx`, `.jsx`   | Complete FARMJS client API and integration UI support.       |
| [Preact](/docs/renderers/preact) | `renderer: preact()` | `.tsx`, `.jsx`   | Small React-compatible runtime with streaming SSR.           |
| [Solid](/docs/renderers/solid)   | `renderer: solid()`  | `.tsx`, `.jsx`   | Fine-grained interactive UI with FARMJS server features.     |
| [Vue](/docs/renderers/vue)       | `renderer: vue()`    | `.vue`           | Vue SFCs, SSR, hydration, and FARMJS server features.        |
| [Svelte](/docs/renderers/svelte) | `renderer: svelte()` | `.svelte`        | Svelte 5 components, runes, SSR, and FARMJS server features. |

The renderer controls component compilation, element creation, server rendering, and browser
hydration. FARMJS continues to control route discovery, layouts, API routes, middleware, cache and
storage, integrations, observability, and deployment output.

## Feature support

The first two tables are checked against the renderer descriptors and their server/client exports,
so entry-point or capability changes cannot silently leave the documentation stale.

<!-- renderer-capability-matrix:start -->

| Renderer | Vite entry                          | Server entry                          | Client entry                          | Route module extensions                 |
| -------- | ----------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------------------- |
| React    | `@farm.js/core/renderer/react/vite` | `@farm.js/core/renderer/react/server` | `@farm.js/core/renderer/react/client` | `.ts`, `.tsx`, `.js`, `.jsx`            |
| Preact   | `@farm.js/preact/vite`              | `@farm.js/preact/server`              | `@farm.js/preact/client`              | `.ts`, `.tsx`, `.js`, `.jsx`            |
| Solid    | `@farm.js/solid/vite`               | `@farm.js/solid/server`               | `@farm.js/solid/client`               | `.ts`, `.tsx`, `.js`, `.jsx`            |
| Vue      | `@farm.js/vue/vite`                 | `@farm.js/vue/server`                 | `@farm.js/vue/client`                 | `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`    |
| Svelte   | `@farm.js/svelte/vite`              | `@farm.js/svelte/server`              | `@farm.js/svelte/client`              | `.ts`, `.tsx`, `.js`, `.jsx`, `.svelte` |

| Renderer | SSR | Streaming                                                                                                                | Hydration | Component head output | Route updates                         | Plain functions |
| -------- | --- | ------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------- | ------------------------------------- | --------------- |
| React    | Yes | Node (Web on edge targets)                                                                                               | Yes       | Framework metadata    | Reconciles                            | Yes             |
| Preact   | Yes | Node + Web                                                                                                               | Yes       | Framework metadata    | Reconciles                            | Yes             |
| Solid    | Yes | Node + Web                                                                                                               | Yes       | Framework metadata    | Remounts ([why](#re-render-behavior)) | Yes             |
| Vue      | Yes | Node + Web                                                                                                               | Yes       | Framework metadata    | Reconciles                            | Yes             |
| Svelte   | Yes | Buffered ([test](https://github.com/farming-labs/farm.js/blob/main/packages/farm-svelte/src/__tests__/renderer.test.ts)) | Yes       | Native + framework    | Reconciles                            | Yes             |

<!-- renderer-capability-matrix:end -->

“Component head output” means markup emitted from inside the renderer's component model. All five
renderers support FARMJS static metadata; Svelte additionally carries `<svelte:head>` output through
its server adapter. “Route updates” describes what happens when FARMJS hands an existing browser
root a freshly materialized route tree, not ordinary reactive updates inside a mounted component.

The higher-level framework features below use those adapter primitives:

| Capability                                       | React                    | Preact                          | Solid                | Vue                  | Svelte               |
| ------------------------------------------------ | ------------------------ | ------------------------------- | -------------------- | -------------------- | -------------------- |
| File pages and nested layouts                    | Available                | Available                       | Available            | Available            | Available            |
| Loading, error, not-found, and slot files        | Available                | Available                       | Available            | Available            | Available            |
| Static metadata and favicon configuration        | Available                | Available                       | Available            | Available            | Available            |
| API routes and generated typed API clients       | Available                | Available                       | Available            | Available            | Available            |
| Server functions, middleware, cache, and storage | Available                | Available                       | Available            | Available            | Available            |
| Observability and production Node output         | Available                | Available                       | Available            | Available            | Available            |
| Basic create-app starter                         | Available                | Available                       | Available            | Available            | Available            |
| Better Auth create-app starter                   | Available                | Native                          | Native               | Native               | Native               |
| Router state and programmatic navigation         | Available                | Through `preact/compat`         | Solid binding        | Vue binding          | Svelte store         |
| Callable actions and server queries              | Available                | Not yet                         | Not yet              | Not yet              | Not yet              |
| Client theme and i18n state                      | Available                | Through `preact/compat`         | Solid binding        | Vue binding          | Svelte store         |
| Shared client stores (`createStore`)             | Available                | Through `preact/compat`         | Solid binding        | Vue binding          | Svelte store         |
| Typed `Link` components                          | Available                | Through `preact/compat`         | Solid component      | Vue component        | Svelte component     |
| Action form components (`useAction().Form`)      | Available                | Through `preact/compat`         | Not yet              | Not yet              | Not yet              |
| Programmatic UI routes                           | Available                | Available                       | Available            | Available            | Available            |
| Markdown and MDX pages (`page.md`)               | Available                | Available                       | Available            | Available            | Available            |
| Docs adapter                                     | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| Generated metadata images (`opengraph-image`)    | Available                | Available                       | Available            | Available            | Available            |
| React Server Components and optimized boundaries | Available experimentally | Not applicable                  | Not applicable       | Not applicable       | Not applicable       |
| Other integration UI providers and starters      | Available                | Provider-specific compatibility | React-oriented today | React-oriented today | React-oriented today |

Follow the focused compatibility notes for [Preact](/docs/renderers/preact#react-compatibility),
[Solid](/docs/renderers/solid#current-boundaries), [Vue](/docs/renderers/vue#current-boundaries), and
[Svelte](/docs/renderers/svelte#current-boundaries) before choosing a non-React renderer for a
React-oriented UI surface.

In experimental React Server Components, synchronous page and layout components are rendered through React, including supported server hooks such as `useId()`. A string or variable containing `async` does not make a component asynchronous. Stateful hooks and effects still belong in Client Components.

Preact resolves the React-shaped bindings through `preact/compat`. Solid exposes signal-backed
getters, Vue exposes refs and computed values, and Svelte exposes readable stores. The underlying
navigation, action, query-cache, theme, and i18n transports live in the renderer-neutral
`@farm.js/core/renderer-client` entry.

## Native client bindings

Import client bindings from the selected renderer rather than importing React hooks:

```ts
// Solid
import { useAction, useRouter, useServerQuery, useTheme } from "@farm.js/solid/bindings";

// Vue
import { useAction, useRouter, useServerQuery, useTheme } from "@farm.js/vue/bindings";

// Svelte
import {
  createAction,
  createRouter,
  createServerQuery,
  createTheme,
} from "@farm.js/svelte/bindings";
```

Actions remain normal typed RPC calls. Solid exposes action state through reactive properties, Vue
through refs, and Svelte through the callable action's readable-store subscription. Server queries
share FARMJS's existing browser cache, invalidation, deduplication, stale-while-revalidate, focus,
and reconnect behavior across all bindings. During server rendering a query binding returns an
idle snapshot and starts no read, matching React's `useServerQuery`; the browser loads it after
hydration.

These bindings take a server function or server query, and browser code can only import one through
React's server-function transform today (`experimental.serverActions` with `@farm.js/plugin/rsc` or
with islands mode). In Preact, Solid, Vue, Svelte, and custom renderers that import stops the build with
`CLIENT_SERVER_FUNCTION`. Until a renderer-neutral transport lands, call server code through an API
route and `apiClient`, as the
[Solid example](https://github.com/farming-labs/farm.js/tree/main/examples/solid-renderer) does.

### Shared client state

`createStore` from `@farm.js/core/renderer-client` creates an in-memory store that works with every
renderer. Define it once in a plain module:

```ts
// src/cart.ts
import { createStore } from "@farm.js/core/renderer-client";

export const cart = createStore({ items: [] as string[] }, (store) => ({
  add(item: string) {
    store.items.set((items) => [...items, item]);
  },
}));
```

Then bind it where a component reads it:

| Renderer | Bind it with                                                        | You get                              |
| -------- | ------------------------------------------------------------------- | ------------------------------------ |
| React    | `cart.use("items")`, with `createStore` from `@farm.js/core/client` | The value, as a hook                 |
| Preact   | The React version, through `preact/compat`                          | The value, as a hook                 |
| Solid    | `useStore(cart)` from `@farm.js/solid/bindings`                     | An accessor: `state().items`         |
| Vue      | `useStore(cart)` from `@farm.js/vue/bindings`                       | A read-only ref: `state.value.items` |
| Svelte   | `createReadable(cart)` from `@farm.js/svelte/bindings`              | A readable store: `$state.items`     |

`get()`, `set()`, `subscribe()`, `reset()`, and field accessors such as `cart.items.set()` work the
same in every renderer. Outside React, calling a field accessor (`cart.items()`) reads the current
value; in React it is a hook. The React entry adds `use()` and is otherwise the same store, as
described in [React](/docs/renderers/react#shared-client-state).

A store defined at module scope is shared by every request on the server. Keep request-specific
data out of it.

## Renderer modules

A renderer descriptor names three modules by package specifier. FARMJS resolves each one from the
app and imports its named exports, in development and in production builds. None of them needs a
default export.

| Module   | Required named exports                                                              | Optional named exports include                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite`   | `createFarmRendererPlugin`                                                          |                                                                                                                                                                                   |
| `server` | `name`, `createElement`, `isValidElement`, `Fragment`, `Suspense`, `renderToString` | `renderToReadableStream`, `renderToPipeableStream`, `renderToStringWithHead`, `ErrorBoundary`, `generateHydrationScript`, `markFunctionComponent`, `configureApp`, `capabilities` |
| `client` | `createElement`, `Suspense`, `createRoot`, `hydrateRoot`                            | `configureApp`                                                                                                                                                                    |

- The development server and `farm build` check the server module's required exports when they load
  it, and fail with one error that names every missing export.
- `createFarmRendererPlugin({ ssr, buildLifetime, rendererOptions })` returns a Vite plugin, an
  array of plugins, or a promise of either. `rendererOptions` is the descriptor's `options`.
- FARMJS composes every route tree with `createElement()`: layouts, the page, and the boundaries for
  loading, error, and not-found files. The server and client modules must build the same tree from
  the same calls.
- `renderToString()` may return a promise.
- `createRoot()` and `hydrateRoot()` return a root with `render(element)` and `unmount()`, plus the
  optional `renderRoute()` described under [Re-render behavior](#re-render-behavior).
- Both modules must export `configureApp()` when the descriptor sets `appSetup`.
- A renderer with its own file format lists its extensions in `componentExtensions` and compiles
  them in the Vite module. FARMJS reads a route's `hydrate` export from the file as written, before
  that compiler runs, so `hydrate` must be the literal `true` or `false` in any format.
- A JSX renderer names its runtime package in `jsxImportSource`. In development, Vite's dependency
  scan compiles JSX as React unless the app's tsconfig names a source, so FARMJS passes this one to
  the scan. Without it, an app with no React installed fails the scan and reloads on its first
  visit.

Check a renderer against the contract types from `@farm.js/core/renderer`. The full list of optional
server exports is on `FarmServerRendererRuntime`.

```ts
import type {
  FarmRendererClientRuntime,
  FarmRendererViteModule,
  FarmServerRendererRuntime,
} from "@farm.js/core/renderer";
import * as client from "./client";
import * as server from "./server";
import * as vite from "./vite";

// Each line fails type-checking when a module drifts from what FARMJS imports.
export const serverContract: FarmServerRendererRuntime = server;
export const clientContract: FarmRendererClientRuntime = client;
export const viteContract: FarmRendererViteModule = vite;
```

The official renderers also run a shared conformance suite, published as `@farm.js/renderer-tests`.
It calls these exports in Node and jsdom and fails where a renderer behaves differently from the
official ones:

```bash
pnpm add -D @farm.js/renderer-tests vitest
```

```ts
// @vitest-environment node
import { defineRendererServerConformance } from "@farm.js/renderer-tests";
import * as server from "./server";

defineRendererServerConformance(server);
```

`defineRendererClientConformance()` checks the client module and needs a jsdom environment. The
[package README](https://github.com/farming-labs/farm.js/tree/main/packages/farm-renderer-tests)
lists every suite and what it checks.

For a complete renderer to copy from, see
[`examples/custom-renderer`](https://github.com/farming-labs/farm.js/tree/main/examples/custom-renderer).
It renders an app with leaf, a small UI library that isn't one of the official renderers, through
an adapter written in plain JavaScript: the descriptor, the three modules, router and theme hooks,
a `Link`, a `.leaf` file format, and the conformance suites. CI runs its browser tests against
`farm dev` and a production build.

## Client state in a custom renderer

FARMJS keeps its client state in plain stores that any renderer can read. Each one implements
`FarmClientStore` from `@farm.js/core/renderer-client`:

```ts
interface FarmClientStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}
```

| Function                            | The store holds                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `createRendererRouter()`            | Pathname, search and route params, page state, and navigation status, with `push`, `replace`, `refresh`, `prefetch`, `back`, and `forward` |
| `createRendererAction(fn)`          | The status, data, and error of a server function call, with `submit` and `reset`                                                           |
| `createRendererQuery(query, input)` | A server query's data from the shared browser cache, with `refetch` and `dispose`                                                          |
| `createRendererTheme()`             | The theme preference and resolved theme, with `setTheme` and `toggleTheme`                                                                 |
| `createRendererI18n()`              | The locale and a translator, with `setLocale`                                                                                              |
| `createStore(state)`                | Your app's own state                                                                                                                       |

The Solid, Vue, and Svelte bindings are one short function over this contract plus thin wrappers.
A custom renderer needs the same function in its own reactivity. For a renderer with React-style
hooks:

```ts
import { useEffect, useState } from "my-renderer";
import { createRendererRouter, type FarmClientStore } from "@farm.js/core/renderer-client";

export function useFarmStore<T>(store: FarmClientStore<T>): T {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  useEffect(() => {
    // Catch a change between the first render and the subscription.
    setSnapshot(store.getSnapshot());
    return store.subscribe(() => setSnapshot(store.getSnapshot()));
  }, [store]);
  return snapshot;
}

export function useRouter() {
  const [router] = useState(() => createRendererRouter());
  return { ...useFarmStore(router), push: router.push, replace: router.replace };
}
```

- Create a store once per component, not on every render, and unsubscribe when it unmounts.
- `getSnapshot()` returns the same value until the state changes, so an identity check is enough to
  skip an update.
- Call `dispose()` on a query store when its component unmounts.
- During server rendering, a query store returns an idle snapshot and starts no request. The browser
  loads it after hydration.

## Renderer capability contract

Renderer packages advertise streaming support in their descriptor instead of relying on FARMJS to
guess from optional runtime exports:

```ts
import { defineRenderer } from "@farm.js/core";

export const customRenderer = defineRenderer({
  name: "custom",
  vite: "@example/renderer/vite",
  server: "@example/renderer/server",
  client: "@example/renderer/client",
  capabilities: {
    streaming: {
      node: true,
      web: false,
      runtimes: {
        edge: { node: false, web: true },
      },
    },
    reconcilesRerenders: false,
    functionComponents: false,
  },
});
```

The top-level streaming values are the fallback when no runtime override exists and for presets
whose runtime is unknown. Local development resolves as `node`; production resolves from the
deployment preset. A `runtimes.node` or `runtimes.edge` entry overrides the pair once FARMJS knows
the runtime. Existing renderers that support the same primitives everywhere can keep using only
the two booleans.

| Renderer | Node target        | Edge target        |
| -------- | ------------------ | ------------------ |
| React    | Node stream        | Web stream         |
| Preact   | Node + Web streams | Node + Web streams |
| Solid    | Node + Web streams | Node + Web streams |
| Vue      | Node + Web streams | Node + Web streams |
| Svelte   | Buffered           | Buffered           |

### Re-render behavior

`reconcilesRerenders` states whether re-rendering an existing root diffs the new tree against the
live DOM or rebuilds it.

Virtual-DOM renderers (React, Preact, Vue) compare the incoming tree with what is mounted. Svelte's
FARMJS compatibility root likewise applies a new element description through one mounted reactive
root. In both cases, a client navigation keeps matching DOM nodes, focus, and component state.

Solid remains a compile-time fine-grained renderer: handing `root.render()` a freshly materialized
tree replaces its nodes because there is no virtual DOM to diff. FARMJS therefore does not use
ordinary root re-rendering for a shared Solid layout. The client runtime supplies route state to the
adapter's optional `renderRoute()` method instead; the Solid adapter keeps the matching layout chain
mounted and updates its page slot and params through signals. Changing the layout chain still mounts
the new chain, as it does in the other renderers.

Renderers that do not declare the field are treated as rebuilding, so nothing silently depends on
reconciliation it will not get. The shared renderer conformance suite asserts the behavior each
renderer declares, so the flag cannot drift away from what the adapter actually does.

Custom fine-grained renderers can implement the same optional route-update contract:

```ts
import type { FarmRendererClientRoot, FarmRendererRouteState } from "@farm.js/core/renderer";

interface CustomRoot extends FarmRendererClientRoot {
  renderRoute(state: FarmRendererRouteState): void;
}

export function hydrateRoot(
  container: Element,
  element: unknown,
  initialRoute?: FarmRendererRouteState,
): CustomRoot {
  // Establish native reactive bindings from initialRoute during hydration.
  // Later navigations call root.renderRoute(nextRoute).
}
```

`layouts` arrive outermost first with stable route patterns, `page` is the innermost route slot, and
`params` is the current route-param snapshot. `element` is the fully composed fallback tree, while
`wrap()` reapplies framework-owned outer wrappers such as integration providers. Renderers that omit
`renderRoute()` continue through `render(element)` unchanged.

### Function components

`functionComponents` states whether the renderer can render a plain function component: one that
takes props and returns an element tree rather than a component built by the renderer's own
compiler. FARMJS gates integration provider components on this capability.

All official renderers support synchronous plain function components. React and Preact handle them
through their native element model, while Vue and Solid materialize their returned element tree in
the adapter. Vue and Svelte also need their adapters to distinguish a plain function from one of
their own components, because both are functions at runtime: a native Vue functional component
takes `(props, { slots, attrs, emit })` and returns VNodes, and a compiled Svelte component is a
function too. Their adapters call only the functions FARMJS marked and render every other function
as a native component, so Vue functional components keep their slots, attrs, and emit.

FARMJS resolves the ambiguity at build time rather than guessing. A provider component in a
production build must be an importable module reference, so the module's extension answers the
question: a `.svelte` provider under the Svelte renderer is a Svelte component, while a `.tsx` one is
a function component. The check uses the extensions the renderer itself declares in
`componentExtensions`, not the resolved set, which always includes `.ts`, `.tsx`, `.js`, and `.jsx`.
Components that are not renderer-compiled are marked so the adapter calls them instead of
instantiating them.

Async plain function components are not part of this contract. Official adapters reject them with
an actionable error instead of rendering a promise, an empty string, or `[object Object]`. Resolve
the data before creating the element tree or use the renderer's native asynchronous primitives.
A page is the exception: with any renderer but React, Farm awaits an async page component itself,
in development and in production builds, and hands the renderer the elements it returns. That's
how `page.md` pages render with every renderer.

The field defaults to `false`, so a renderer whose adapter has not been taught to handle function
components fails with a clear error naming the renderer rather than rendering something broken.

FARMJS builds the production client and SSR graphs in parallel by default. If a renderer's compiler
plugin uses process-global mutable caches, set `buildConcurrency: "serial"` on its descriptor. The
official Vue renderer does this because `@vitejs/plugin-vue` shares SFC descriptor and script caches
between plugin instances.

A renderer advertising `node` streaming for the active runtime must export
`renderToPipeableStream()` from its server entry. A renderer advertising `web` streaming must
export `renderToReadableStream()` returning a WHATWG `ReadableStream`. FARMJS validates those
declarations when the development server renderer starts and again in the generated production
runtime. Production still checks the function before calling it, but only a primitive enabled by
the resolved descriptor can be selected. This keeps the declaration and runtime export in
agreement instead of treating an accidental export as support. FARMJS uses buffered
`renderToString()` when neither capability is enabled. Descriptors without a `capabilities` field
remain buffered for compatibility. A renderer that exports only `renderToReadableStream()` streams
in development as well as in production builds.

A render error before any output should fail the stream (`onShellError()`, or an errored Web
stream), and FARMJS answers with the error's status. After output has started, the status is sent,
so report the error through the `onError` callback or option and end the stream. FARMJS logs it and
the response ends with what was sent. In a production build, a Web stream that errors after output
resets the connection instead.

Farm also uses `renderToString()` for documents it sends whole, such as the not-found and error
pages with their layouts, so it may return a promise and should wait for the renderer's own async
content instead of throwing: the official Preact renderer uses `renderToStringAsync()`, Solid uses
`renderToStringAsync()`, and Vue's `renderToString()` is already async. React renders a document
that suspends with its streaming renderer and waits for every boundary before sending it.

## Renderer-neutral server code

Keep product and server behavior outside the component runtime whenever possible:

```ts
import { createEndpoint } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

const input = z.object({ name: z.string().min(1) });

const greet = createServerFn({
  input,
  async handler({ input }) {
    return { message: `Hello, ${input.name}` };
  },
});

export const POST = createEndpoint(
  "/api/greeting",
  { method: "POST", body: input },
  async ({ body }) => greet(body),
);
```

React, Preact, Solid, Vue, and Svelte components can call this endpoint through the same generated client.
Database access, secrets, validation, cache invalidation, middleware, and the server-function
handler remain on the server.

## Switch renderers deliberately

The renderer option is application-wide. Do not mix React, Preact, Solid, Vue, and Svelte route components
in the same route tree. Share server modules, schemas, API clients, CSS, and plain TypeScript across
renderers; rewrite component and client-state code using the selected renderer's native primitives.

The Basic and Better Auth templates support every renderer directly:

```bash
pnpm create @farm.js/app my-auth-app --template better-auth --renderer vue --typescript
```

Other integration starter templates currently target React. Add their renderer-neutral server
integration to a native Basic starter when using Preact, Solid, Vue, or Svelte.
