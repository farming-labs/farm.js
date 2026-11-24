# RFC 0012: An islands interface for renderers

- Status: Draft, open for discussion. Nothing in Farm is implemented. It builds on islx's
  renderer-neutral islands ([farming-labs/islx#91](https://github.com/farming-labs/islx/pull/91),
  released in islx 0.0.28) and on `resolveIslandMarkup`
  ([farming-labs/islx#92](https://github.com/farming-labs/islx/pull/92), open).
- Tracking issue: none yet
- Scope: core's renderer contract (`@farm.js/core/renderer`) and the client entries Farm generates.
  This RFC only adds an interface that a renderer can choose to implement. It does not change
  React, Preact, Solid, Vue or Svelte.

## Summary

Core gives renderers the pieces it uses for React's component islands. A renderer opts in by
setting `capabilities.islands` in its descriptor and exporting `withIsland` from its server module.
A renderer that doesn't opt in takes exactly the code path it takes today.

For apps on a renderer that has opted in, there are two parts:

1. **The module says what can run in the browser.** `"use client"`, as in React. For a file format
   that can't start with a directive, a `"use client"` module re-exports it.
2. **Where a component is used, an attribute can say when it hydrates.** `client:load`,
   `client:idle`, `client:visible` or `client:interaction` on a client component rendered from
   server output sets the strategy for that one island.

```tsx
// src/app/page.tsx, a server component, on a renderer that opts in
import { Counter } from "../components/counter"; // "use client", export const island = "idle"

export default function Page() {
  return (
    <>
      {/* idle: the module's default */}
      <Counter start={1} />
      {/* at once */}
      <Counter client:load start={2} />
      {/* when it scrolls into view */}
      <Counter client:visible start={3} />
    </>
  );
}
```

In the browser, core reuses the renderer client contract it already calls for route slots:
`createElement` and `hydrateRoot`. islx's renderer-neutral runtime finds and starts the islands,
so a renderer writes no browser code for them. The wire format (`<f-island>` and `f/props`) does
not change.

## Problem

A React page that is a server component hydrates each client component it renders as its own
root, inside `<f-island>`, when that island's trigger fires ([RFC 0001](./0001-isolated-client-hydration.md),
[RFC 0003](./0003-islands-server-components.md)). The pieces that make this work are written
against React, or sit behind an `isReactRenderer` check, so a
[custom renderer](https://farmjs.dev/docs/renderers/custom) can't use them:

- **The server wrapper.** `createFarmIsolatedClientBoundary` emits the island with React's
  `useContext`, `useId` and `dangerouslySetInnerHTML`.
- **The export transform.** `transformIsolatedClientBoundaryModule` wraps each export of a client
  module, but `vite.ts` runs it only when `isReactRenderer` is true.
- **The browser runtime.** `createFarmIsolatedHydrationRuntime`'s error boundary is
  `class extends ReactRuntime.Component`.

So a page on any other renderer that imports a client module hydrates as one root at
`#__farm_page__`, and an async page stays server-only, with its client components left as inert
HTML. The docs say: "React Server Components and islands are React-only."

Most of what islands need already works without React:

| Piece                                                                    | Where                                                                   | Tied to React                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------ |
| `<f-island src export props strategy>`, `<script type="f/props" for>`    | `client/island-value-protocol.ts`                                       | No                                               |
| Trigger scheduler: `load`, `idle`, `visible`, `interaction`, held clicks | `scheduleFarmIslandHydration` in `client/island-runtime.ts`             | No: it takes a container and a callback          |
| Pre-hydration hold script and boot script                                | `server/prehydration-hold-script.ts`, `client/islands-boot.ts`          | No                                               |
| One root per container through the renderer client module                | Route slots (`routeSlotRoots`) in the dev and production client entries | No: `createElement`, `hydrateRoot`, `createRoot` |
| "Inside a hydrating route" signal for the server                         | Optional `wrapClientGraph` and `isolateServerPageGraph`, called by core | No: any renderer may export them                 |
| Module id to chunk loaders, island preloads                              | Generated client entry, `client-module-preloads.json`                   | No                                               |

What's missing is a seam: a place where a renderer renders "this component, as an island", and a
way for core to know the renderer has one.

### What islx already provides

Farm's islands mode runs on [islx](https://github.com/farming-labs/islx), and islx#91 added two
entries that don't import React:

- **`@farm.js/islx/islands/server`**: `renderIslandMarkup({ src, export, strategy, id, props, html, sent })`
  writes `<f-island>` around HTML from any renderer's string renderer, plus its props script.
  - Props go through islx's codec: JSON, `Date`, `Map`, `Set` and its other tagged types, and server
    actions. Values are sent once per response.
  - A function, promise or element prop throws, naming the island.
- **`@farm.js/islx/islands/client`**: `createIslandRuntime({ renderer, load, schedule })` finds the
  islands, waits for each one's strategy, decodes its props, and calls the renderer's one
  function, `hydrate(container, Component, props, island)`.
  - If `hydrate` throws, the island gets its server HTML back and is reported. It isn't marked
    hydrated, and held clicks aren't replayed onto it.
  - `schedule` is required. Farm passes `scheduleFarmIslandHydration`, which has the same
    signature, so Farm keeps its own scheduler and doesn't need islx's.

islx's `examples/renderers` hydrates a load, an interaction and a visible island on Preact 11.2,
Vue 3.5, Svelte 5.59 and Solid 1.9 with these entries. Its Chrome e2e suite checks that each
island keeps the server's DOM nodes, decodes `Date` and `Map` props, replays the click that woke
it exactly once, and logs no hydration warnings, against both the production build and the dev
server.

So this RFC doesn't define a wire format, a props serializer or a browser loader. Core connects
islx to the renderer contract.

## The rule: core exposes, renderers opt in

The rule applies to this RFC and to anything else core exposes from the rendering layer later:

1. **A capability is declared.** The renderer descriptor states it in `capabilities`, which core
   reads from config without loading the renderer. The server or client module exports the hooks
   it needs.
2. **An undeclared capability changes nothing.** Core takes exactly today's path: the same
   transforms, the same imports in the generated entries, and the same output.
3. **A declared capability that's incomplete fails at startup.** If a renderer declares
   `islands` but doesn't export `withIsland`, `assertFarmRendererServerModule` names the missing
   export and links the docs. It doesn't fall back quietly.
4. **The proof is in the build output.** The official renderer examples build byte-identical
   client and server output before and after the change.

This is how `streaming`, `reconcilesRerenders` and `functionComponents` already work.

## Where the marker goes

### What compilers do with an attribute

These are the results of compiling `<Counter client:visible start={1} />` on 2026-11-23, with
Node 24.21.0 and the versions in the lockfile:

| Compiler                                                  | Output                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| oxc (Rolldown 1.3.3), `react` and `preact` import source  | `jsx(Counter, { "client:visible": true, start: 1 })`                                                           |
| babel-preset-solid 1.9.12, `dom` and `ssr`                | `createComponent(Counter, { "client:visible": true, ... })`                                                    |
| @vue/compiler-sfc 3.5.44, client                          | `_createBlock(Counter, { "client:visible": "", start: 1 })`                                                    |
| @vue/compiler-sfc 3.5.44, SSR                             | `_ssrRenderComponent(Counter, _mergeProps({ "client:visible": "", start: 1 }, _attrs), …)`                     |
| Svelte 5.56.8, client and server                          | `Counter($$renderer, { 'client:visible': true, start: 1 })`                                                    |
| @babel/plugin-transform-react-jsx 7.29.7, default options | Throws "Namespace tags are not supported by default"; with `throwIfNamespace: false`, `"client:visible": true` |

TypeScript 5.9.3 with `@types/react` 19.2.13 rejects the attribute on a component whose props
don't declare it (TS2322). After the keys are added to `JSX.IntrinsicAttributes`, it accepts the
attribute and catches a typo: `client:visibel` gets "Did you mean '"client:visible"'?".

So the major JSX and template compilers all deliver a namespaced attribute as an ordinary prop.
Vue's value is `""` instead of `true`, and Babel's classic JSX transform needs one option. A
renderer that compiles JSX through any of them gets the attribute to `withIsland` without extra
work.

### Options

- **A. Module only (`"use client"` plus `export const island`).** This is the React model today.
  - The build knows every client module before it runs.
  - It's the same contract as React Server Components.
  - But timing is per module: one component can't hydrate at once in one place and only when
    visible in another.
- **B. Use site only, where `client:*` alone makes an island (Astro).**
  - Each use is explicit.
  - But core would have to read every template language's use sites to find the module behind a
    component.
  - An interactive component used without the attribute would render a control that never works.
- **C. A wrapper component: `<Island of={Counter} when="visible" />`.**
  - It needs no compiler support.
  - But it carries no module reference, so it needs the same use-site analysis as B.
- **D. An import attribute: `import { Counter } from "./counter" with { island: "visible" }`.**
  - Timing is per import, which is no finer than A.
  - Browsers reject import attributes other than `type`, so a module loaded unbundled in
    development would fail.

### Decision

**Use A's marker and add B's attribute as a per-use override.**

- The module marker is what makes a component a client component.
- The attribute only chooses when one island hydrates.

This keeps build-time knowledge of every client module and adds per-use timing. It needs no
use-site parsing to find islands, because the compilers already deliver the attribute as a prop.
And an interactive component used without the attribute still hydrates, at its module's default.

## Design

### 1. The descriptor and the contract

```ts
export interface FarmRendererCapabilitiesInput {
  // ...existing keys
  /** The server module exports `withIsland`. Experimental. */
  islands?: boolean;
}

export interface FarmServerRendererRuntime {
  // ...existing exports
  /**
   * Wraps a client component so that, rendered from server output, it starts an island.
   * Farm calls it on each export of a client module in the server graph.
   */
  withIsland?(component: unknown, reference: FarmIslandReference): unknown;
}

export interface FarmIslandReference {
  /** The module id the browser imports, as `<f-island src>` carries it. */
  readonly src: string;
  readonly export: string;
  /** The module's `island` export, or "load". */
  readonly strategy: FarmIslandStrategy;
}
```

`capabilities.islands` defaults to `false`. Islands still need the app to set
`experimental.isolatedClientHydration: "enabled"`, as React's do.

### 2. What core exposes

From `@farm.js/core/renderer`, one function does the work that doesn't depend on the renderer:

```ts
export function resolveFarmIsland(
  props: Record<string, unknown>,
  reference: FarmIslandReference,
): FarmResolvedIsland | undefined;

export interface FarmResolvedIsland {
  /** The component's props, without `client:*`. */
  readonly props: Record<string, unknown>;
  /** Value scripts written before the island: values this response hasn't sent yet. */
  readonly values: readonly FarmIslandScript[];
  /** The island element: its tag (`f-island`) and attributes (src, export, props id, strategy, style). */
  readonly element: { readonly tag: string; readonly attributes: Readonly<Record<string, string>> };
  /** The props script written after it. */
  readonly script: FarmIslandScript;
}

export interface FarmIslandScript {
  readonly attributes: Readonly<Record<string, string>>;
  /** Escaped for a script element. Write it raw. */
  readonly text: string;
}

/** Attribute types to add to the renderer's `JSX.IntrinsicAttributes`. */
export interface FarmIslandAttributes {
  "client:load"?: boolean | "";
  "client:idle"?: boolean | "";
  "client:visible"?: boolean | "";
  "client:interaction"?: boolean | "";
}
```

What `resolveFarmIsland` does:

- **Removes `client:*` keys** from the props.
- **Picks the strategy.** The use-site attribute first, then the module's `island` export, then
  `"load"`.
- **Names the island** with an id that is unique within the response, from the request's render
  state, as React's `useId` does for its islands.
- **Serializes the props through islx**, with one set of sent values per response, so a value
  shared by several islands goes once. The rules are islx's (see above), which accept more than
  React's isolated client components do today: `Date`, `Map`, `Set` and server actions as well as
  JSON.
- **Returns `undefined` when the props don't serialize.** Farm logs islx's error, which names the
  island, once, and the component keeps its server HTML, as with React today.

The tag and script types come back in the result, so a renderer never hardcodes the wire format.
`FarmIslandAttributes` exists because core can't add types to a custom renderer's JSX namespace;
the renderer's own types include it.

islx#91 only returns the markup as one string (`renderIslandMarkup`). A renderer that builds
elements, rather than strings, needs the parts. So islx#92 adds `resolveIslandMarkup`, which
returns the values, element and script that `renderIslandMarkup` joins.

### 3. What the renderer implements

`withIsland(component, reference)` returns a component of the renderer's own kind. When it renders,
it does three things:

1. **Inside a hydrating route, it renders the component plain,** with `client:*` removed. The
   renderer knows it's inside one through its own context, which it sets in `wrapClientGraph`.
   Core already calls that optional export for any renderer.
2. **Otherwise, it calls `resolveFarmIsland` and renders the result:** the value scripts, the
   island element around the component, then the props script. Script text is written raw.
3. **It renders the component so it hydrates as its own root,** matching what
   `hydrateRoot(<f-island>, createElement(component, props))` expects in the browser. A renderer
   with hydration ids or markers handles that itself. For example, it might reset its id context
   for the island's subtree, or render the island separately and insert its HTML.

islx's examples show the second way works for page-wide hydration keys. Its Solid adapter renders
each island with `renderToString(..., { renderId: island.id })` and hydrates with the same
`renderId`. In Farm the island's server render is the renderer's own business, and so is how its
`hydrateRoot` finds the id. farm-solid's `hydrateRoot` already reads `data-farm-solid-render-id`
from the container and falls back to the first `data-hk`. So a Solid `withIsland` could add that
attribute to the island element and need nothing new in the browser. That is unverified, and it's
the first thing the Solid follow-up checks.

### 4. What core does when a renderer opts in

These steps run only when `capabilities.islands` is true and isolated hydration is enabled:

- **The planner records client modules as islands** for that renderer, as it does for React.
- **The transform wraps each export** of a client module in the server graph as
  `withIsland(component, reference)`. This is `transformIsolatedClientBoundaryModule` with an
  added branch. React's branch is unchanged.
- **The generated client entries start islx's runtime, in dev and production,** with the
  renderer's `hydrate` built from the client module Farm already imports:

  ```ts
  import { createIslandRuntime, defineIslandRenderer } from "@farm.js/islx/islands/client";
  import * as renderer from "<the renderer's client module>";

  const islands = createIslandRuntime({
    renderer: defineIslandRenderer({
      hydrate: (container, Component, props) =>
        renderer.hydrateRoot(
          container,
          wrapWithIntegrationProviders(renderer.createElement(Component, props)),
        ),
    }),
    // The same generated loader and scheduler React's isolated hydration runtime gets today.
    load: loadFarmIsolatedBoundary,
    schedule: scheduleFarmIslandHydration,
  });
  ```

  - `hydrateRoot` returns a `FarmRendererClientRoot`, whose `unmount()` is what islx needs back.
    The renderer writes no browser code for islands.
  - If `hydrateRoot` throws, islx restores the server HTML. An error after hydration is the
    renderer's to handle, as for a route root.

- **A navigation calls `islands.dispose()`,** which unmounts the page's islands and drops the ones
  still waiting for their strategy. The new page calls `islands.hydrate()`.
- **The build check runs on server modules.** A `client:*` attribute on a component that isn't a
  client component fails the build, with this message:
  `` `client:visible` on `Chart` in src/app/page.tsx: ./chart.tsx is not a client module. Add "use client" to it, or re-export it from a module that starts with "use client". ``
  Two `client:*` attributes on one element also fail, and so does a value other than `true` or
  `""`. Values are reserved for options.

React keeps `createFarmIsolatedClientBoundary`, its runtime, and its error boundary.

### 5. Composition

- **Props.** islx's codec types and server actions. A function, promise or element prop means no
  island, with a warning. Promise props stay in `@farm.js/islx/react` for now.
- **Server output as children.** Not in this RFC. A client component given server-rendered
  children keeps its server HTML, as React's does outside a hydrating layout.
- **Context.** In the browser, an island sees integration providers and nothing from the server
  components above it.
- **Nesting.** A client component inside an island is part of that island.
- **How many islands.** RFC 0001's planner allows four roots per route. When the count depends on
  data, it keeps the route as one root. The planner reads that from JSX tokens, which covers JSX
  renderers. A template format needs the same reading, or its routes with islands in a loop stay
  whole.
- **Tables, lists, `<select>` and SVG.** RFC 0006 grows the island to the container, but only in
  islands mode on React. A custom renderer's client component directly inside `<table>`, `<ul>`
  and the like would put `<f-island>` where the HTML parser moves it. Version 1 documents this
  limit.

## Costs

- **For existing renderers: none.** They don't declare `islands`, so core's output for them is
  unchanged, and acceptance checks that byte for byte.
- **For a renderer that opts in:** it implements `withIsland`, about the size of React's
  ~90-line `createFarmIsolatedClientBoundary`, and `wrapClientGraph`.
- **For core:**
  - one branch in the export transform;
  - `resolveFarmIsland`, which wraps islx's `resolveIslandMarkup` with the strategy, the id and
    the response's sent values;
  - about ten generated lines that start islx's runtime, imported only when a renderer declares
    `islands`;
  - the build check, which parses JSX use sites before the renderer compiles them, as
    `farm:island-containers` does. Other template formats need a spike.
- **For islx:** `resolveIslandMarkup` (islx#92) and a release with it. 0.0.28 already ships the
  islands entries; Farm core pins `@farm.js/islx` 0.0.25 today.
- **Bytes:** islx#91 measured its islands client at 6.0 KB gzip with rolldown's minifier, and the
  action client it loads only for an island with an action prop at 2.7 KB. Not measured inside a
  Farm page. Phase 1 measures a page on the custom renderer example with and without islands.

## Alternatives considered

- **Implement islands in each official renderer now.** Not in scope. Each renderer adopting the
  interface is its own change, with its own review of hydration ids and markers.
- **Core renders each island separately and splices it into the stream.** This needs no renderer
  export. But it costs a renderer call per island and async splicing, even for a renderer that can
  hydrate a nested container inline. A renderer can still do this inside its own `withIsland`.
- **Core writes its own wire format, serializer and browser loader.** The first draft of this RFC
  did, with JSON-only props. islx#91 already has all three without React, with a richer codec,
  the restore on failure, and browser tests on four renderers. A second copy in core would drift
  from the one Farm's islands mode already runs on.
- **Gate on the `withIsland` export instead of a descriptor capability.** Core decides the
  transform and the client entries from config, before it loads the server module. An export
  check alone would mean loading the renderer at config time, and a missing export would quietly
  mean "no islands".
- **The attribute alone promotes any component (Astro's full model).** Not chosen: every other use
  of that import would hydrate too, and a stateful component used without the attribute would
  render as a dead control.

## Rollout

0. **islx.** Add `resolveIslandMarkup` (islx#92, the parts `renderIslandMarkup` joins), release
   islx, and bump Farm core's pin.
1. **The interface.**
   - Add `capabilities.islands`, `withIsland`, `FarmIslandReference`, `resolveFarmIsland` and
     `FarmIslandAttributes`.
   - Add the transform branch, and start islx's runtime in the dev and production entries, with
     the `assertFarmRendererServerModule` check.
   - Unit tests cover `resolveFarmIsland`: strategy precedence, attribute removal, ids unique
     within a response, a value shared by two islands sent once, the serialization failure, and
     Vue's `""`.
2. **The reference implementation.**
   - `examples/custom-renderer` (`farm-leaf`) implements `withIsland` and `wrapClientGraph`.
   - `tests/e2e-custom-renderer` covers it in dev and production.
3. **The `client:*` attribute** for renderers that declare `islands`: the build check, the types,
   and the docs.
4. **Docs.** An "Islands" section on the [custom renderers](https://farmjs.dev/docs/renderers/custom)
   page, marked experimental.

Not part of this RFC, and each needs its own go-ahead:

- **An official renderer adopting the interface.** The interface stays experimental until one
  renderer with its own hydration ids passes the suite. Solid is the cheapest check: it already
  writes `data-farm-solid-render-id` on island containers, its `hydrateRoot` reads it, and islx's
  Solid example hydrates islands with one render id each.
- **The `client:*` attribute for React.**
- **`isolatedClientHydration: "enabled"` on Preact, Solid, Vue or Svelte today.** Reading the
  code, that app emits no islands, and its client entry probably throws at startup. This needs a
  repro before any fix.
- **Other parts of the rendering layer exposed the same way,** each in its own RFC: a hot-update
  hook, action forms that post without JavaScript, out-of-order streaming, and the docs adapter
  and integration UI, which are React-oriented today.

## Acceptance

- **Existing renderers.** Build `examples/basic` (React), `preact-renderer`, `solid-renderer`,
  `vue-renderer` and `svelte-renderer` on `main` and on the change, with and without
  `isolatedClientHydration: "enabled"`. The client and server output is byte-identical.
- **The custom renderer example, in `farm dev` and in a production build:**
  - A server page renders one client component three times, with three strategies.
  - The `client:visible` copy requests its chunk only after it scrolls into view, asserted from
    network requests.
  - Each island keeps its own state.
  - Props round-trip, including a `Date`, a `Map` and a server action.
  - A hydration error restores the server HTML.
  - Navigating away unmounts the islands, and navigating back hydrates them again.
- **Fail closed.** A renderer that declares `islands` without `withIsland` fails at startup with
  the missing export named. `client:*` on a server component fails the build with the message
  above.

## Open questions

1. **`client:only` and `client:media`.** One would skip the server render, the other would match a
   media query. Neither strategy exists today.
2. **Attribute values as options,** for example `client:visible="400px"` for a root margin.
3. **Showing a client component as static HTML at one use site,** for example `client:none`.
4. **The build check for template formats.** Read the compiled output (where the attribute is an
   object key next to the component; see the table above), or let the renderer provide the check.
5. **Custom file formats.** The re-export works today. Should the descriptor also be able to name
   the marker for its format?
