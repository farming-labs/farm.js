# RFC 0012: Component islands for every renderer

- Status: Draft, open for discussion. Nothing here is implemented.
- Tracking issue: none yet
- Scope: `experimental.isolatedClientHydration` and islands mode for Preact, Solid, Vue, Svelte
  and custom renderers; a per-use hydration attribute for every renderer, React included

## Summary

Component islands work only with React today. This RFC makes them work for any renderer, with the
work split in two places:

1. **The module says what can run in the browser.** `"use client"`, as today. Vue and Svelte keep
   the `hydrate = true` export they already use for this. Any other format uses a one-line
   re-export.
2. **The use site may say when it hydrates.** `client:load`, `client:idle`, `client:visible` or
   `client:interaction` on a client component rendered from server output sets the strategy for that
   one island.

```tsx
// src/app/page.tsx, a server component
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

Renderers implement one optional server export, `withIsland(component, reference)`. The browser
side reuses the renderer client contract Farm already calls for route slots: `createElement` and
`hydrateRoot`. The wire format (`<f-island>` and `f/props`) does not change.

## Problem

A React page that is a server component hydrates each client component it renders as its own
root, inside `<f-island>`, when that island's trigger fires ([RFC 0001](./0001-isolated-client-hydration.md),
[RFC 0003](./0003-islands-server-components.md)). Preact, Solid,
Vue, Svelte and [custom renderers](https://farmjs.dev/docs/renderers/custom) get none of this:

- **A page that imports a client module hydrates whole,** as one root at `#__farm_page__`
  (`inspectClientModuleMetadata` in `packages/farm/src/utils/client-component.ts`). The docs say
  so: "Solid, Vue, and Svelte currently hydrate at the route boundary".
- **An async page stays server-only.** Its client components render as inert HTML and Farm logs a
  warning.
- **`isolatedClientHydration: "enabled"` is accepted but doesn't work.** The config allows it for
  any renderer: `resolveFarmIsolatedClientHydrationMode` never looks at the renderer. But only
  React gets islands:
  - The transform that wraps client exports runs only when `isReactRenderer` is true (`vite.ts`).
  - The browser runtime's error boundary is `class extends ReactRuntime.Component`.

  This is read from the code, not run: such an app emits no islands, and its client entry likely
  throws at startup, because no other renderer's client module exports `Component`.

React has a gap of its own. A module's `export const island = "visible"` sets the strategy for
every place that renders it. So the same component can't hydrate at once above the fold and only
when visible further down. A component from a package can't wait for its trigger without a
wrapper file.

## What already does not depend on React

| Piece                                                                    | Where                                                                                 | Tied to React                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `<f-island src export props strategy>`, `<script type="f/props" for>`    | `client/island-value-protocol.ts`                                                     | No                                               |
| Trigger scheduler: `load`, `idle`, `visible`, `interaction`, held clicks | `scheduleFarmIslandHydration` in `client/island-runtime.ts`                           | No: it takes a container and a callback          |
| Pre-hydration hold script and boot script                                | `server/prehydration-hold-script.ts`, `client/islands-boot.ts`                        | No                                               |
| One root per container through the renderer client module                | Route slots (`routeSlotRoots`) in the dev and production client entries               | No: `createElement`, `hydrateRoot`, `createRoot` |
| Hydrating a nested container in Solid                                    | `data-farm-solid-render-id` in `packages/farm-solid/src/runtime.ts`                   | Solid's own                                      |
| Module id to chunk loaders, island preloads                              | Generated client entry, `client-module-preloads.json`                                 | No                                               |
| Server wrapper that emits the island                                     | `createFarmIsolatedClientBoundary` (`useContext`, `useId`, `dangerouslySetInnerHTML`) | Yes                                              |
| Error boundary around each browser root                                  | `createFarmIsolatedHydrationRuntime`                                                  | Yes                                              |
| Rewriting each export of a client module into a wrapped component        | `transformIsolatedClientBoundaryModule`                                               | Only through the `isReactRenderer` gate          |

Two things are missing:

- A seam where a renderer renders "this component, as an island".
- A way to say, at each use, when that island hydrates.

## Prior behavior elsewhere

- **Astro** decides at the use site: `<Counter client:visible />`. A component without a directive
  is static HTML. Directives work only in `.astro` files, which never run in the browser, and each
  framework renders each island as its own root.
- **Fresh** makes every component in `islands/` an island: the folder is the marker. Props must
  serialize.
- **React Server Components** (Next.js, Farm's `"rsc"` mode) decide at the module with
  `"use client"`. Every use from server code is a boundary. There is no per-use timing.
- **Qwik** resumes instead of hydrating, so it has no island marker.
- **Farm today:**
  - `"use client"`, or `hydrate = true` in Vue and Svelte, marks the module.
  - `export const island` sets its timing.
  - Islands mode infers `"interaction"` for React modules that provably do nothing before a click
    (RFC 0003, section 11).

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

So in every renderer Farm ships, a namespaced attribute reaches the component as an ordinary
prop. Vue gives it the value `""` instead of `true`, and Babel needs one option changed. Something
has to read the attribute and remove it before the component sees its props.

### A. Module only: `"use client"` plus `export const island`

This is today's model.

- The build knows every client module before it runs, so chunks, preloads, `server-only` checks
  and strategy inference all stay per module.
- It's the same contract as React Server Components, so switching between `"rsc"` and `"islands"`
  stays a one-line change.
- But timing is per module, not per use.
- And `"use client"` can't be read from a `.vue` or `.svelte` file. The directive scan stops at
  the first `<`.

### B. Use site only: `client:*` marks the island (Astro)

- Each use is explicit, and any component can be an island without touching its module.
- But to find the module behind `Counter` at a use site, Farm would have to read every template
  language's use sites, then point that import at a generated client module. That turns every use
  of the import in that module into an island, unless Farm rewrites each use in each compiler's
  output.
- An interactive component used without the attribute renders a control that never works. Astro
  accepts that; Farm's rule is to fail closed.
- It also splits the contract from React Server Components, where `"use client"` alone makes the
  boundary.

### C. A wrapper component: `<Island of={Counter} when="visible" start={1} />`

- It's a plain component, so no compiler is involved.
- But it carries no module reference. The build still has to find which module `Counter` came
  from, so it needs the same use-site analysis as B.
- Props are typed through an indirection, and the call site is longer.

### D. An import attribute: `import { Counter } from "./counter" with { island: "visible" }`

- Timing would be per import, which is no finer than A.
- Browsers reject import attributes other than `type`. A module the browser loads unbundled in
  development would fail to load.

### Decision

**Use A's marker and add B's attribute as a per-use override.**

- The module marker is what makes a component a client component, as in React Server Components.
- The attribute only chooses when one island hydrates.

This gets each option's strength without its cost:

- The build knows every client module, as it does today.
- Timing is per use.
- No use-site parsing is needed to _find_ islands. The compilers already deliver the attribute as
  a prop.
- An interactive component used without the attribute still hydrates, at its module's default.

## Design

### 1. Client modules

A module is a client module when any of these is true:

- It starts with `"use client"`.
- It's a `.vue` or `.svelte` file whose module script exports `hydrate = true`. That's the marker
  those docs already use. Today an imported `hydrate = true` module makes its importer hydrate as
  a whole. With islands on, it becomes an island like a `"use client"` module.
- It's a `"use client"` module that re-exports from another file. This works for any format,
  including a custom renderer's own:

  ```ts
  "use client";
  export { default as Counter } from "./counter.leaf";
  ```

  Farm already accepts `export { Name } from "./name"` in a client module.

Farm compiles each export of a client module, in the server graph, into
`withIsland(component, reference)`. This is the existing `transformIsolatedClientBoundaryModule`
without its React gate.

```ts
export interface FarmIslandReference {
  /** The module id the browser imports, as `<f-island src>` carries it. */
  readonly src: string;
  readonly export: string;
  /** The module's `island` export, or "load". */
  readonly strategy: FarmIslandStrategy;
}
```

### 2. The `client:*` attribute

- **The attribute names.** `client:load`, `client:idle`, `client:visible` and `client:interaction`
  are the four existing strategies. An attribute with no value, `true` or `""` (Vue's form) all
  mean "on".
- **Which strategy wins.** The use-site attribute first, then the module's `island` export, then
  inference (islands mode), then `"load"`.
- **The component never sees it.** Farm removes `client:*` keys before the component receives its
  props, in every mode. `"rsc"` mode hydrates every client component with the page, so there the
  attribute has no other effect.
- **Inside a client root it does nothing.** In an island, or in a route that hydrates as a whole,
  a client component belongs to that root, as in React. The attribute is removed, and `farm dev`
  warns once, naming the component.
- **Wrong uses fail the build with the fix:**
  - On a component that isn't a client component:
    `` `client:visible` on `Chart` in src/app/page.tsx: ./chart.tsx is not a client module. Add "use client" to it, or re-export it from a module that starts with "use client". ``
  - Two `client:*` attributes on one element.
  - A value other than `true` or `""`. Values are reserved for options, such as a root margin for
    `visible`.
- **Types.** Generated declarations add the four keys to the active renderer's
  `JSX.IntrinsicAttributes`. That interface applies to every component, so the types also accept
  the attribute on a server component. The build check catches that case.

### 3. The renderer seam

There's one new optional export on the renderer's server module:

```ts
export interface FarmServerRendererRuntime {
  // ...
  /**
   * Wraps a client component so that, rendered from server output, it starts an island.
   * Farm calls it on each export of a client module in the server graph.
   */
  withIsland?(component: unknown, reference: FarmIslandReference): unknown;
}
```

Core does the part that doesn't depend on the renderer, in one function the wrapper calls:

```ts
// @farm.js/core/renderer
export function resolveFarmIsland(
  props: Record<string, unknown>,
  reference: FarmIslandReference,
): FarmResolvedIsland | undefined;

export interface FarmResolvedIsland {
  /** The component's props, without `client:*`. */
  readonly props: Record<string, unknown>;
  /** `<f-island>` attributes: src, export, props id, strategy. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Escaped JSON for `<script type="f/props" for={attributes.props}>`. */
  readonly json: string;
}
```

It returns `undefined` when the props don't serialize. Farm logs that once, and the component keeps
its server HTML, as today.

The renderer does the three parts only it can:

1. **Inside a root, render the component plain,** with `client:*` removed. A renderer tracks
   "inside a root" with its own context, as React's `wrapClientGraph` does today.
2. **Otherwise, render the island markup.** That's `<f-island {...attributes} style="display:contents">`
   around the component, then the props script. The script is written with the renderer's raw-HTML
   API: `dangerouslySetInnerHTML` in React and Preact, `innerHTML` in Solid and Vue, `{@html}` in
   Svelte.
3. **Render the component so it hydrates as its own root.** That means matching what the browser's
   `hydrateRoot(<f-island>, createElement(component, props))` expects. Solid already writes
   `data-farm-solid-render-id` on island containers for this. Vue and Svelte may need to render an
   island separately and insert its HTML, which is how Astro renders every island.

React's wrapper, `createFarmIsolatedClientBoundary`, is about 90 lines. It becomes React's
`withIsland`, with the same output.

### 4. The browser

There is no new renderer export.

- **Non-React renderers.** A loader in core finds each `f-island[src]`, schedules it with
  `scheduleFarmIslandHydration`, imports the module, reads the props, and calls the renderer client
  module's `hydrateRoot(island, createElement(Component, props))`. That's what route slots already
  do.
- **Errors.** If `hydrateRoot` throws, the loader restores the server HTML and reports the
  error. An error thrown after hydration is handled by the renderer, as for a route root.
- **React** keeps its runtime and error boundary unchanged.
- **Navigation** unmounts a page's islands, as it does for React.

A renderer without `withIsland` keeps today's behavior. Farm stops accepting
`isolatedClientHydration: "enabled"` or islands mode with it, with this config error:
``The "solid" renderer does not support component islands (`withIsland`). Remove `experimental.isolatedClientHydration`, or use a renderer that supports them.``
That replaces the likely startup error described in Problem.

### 5. Composition

- **Props.** The same rules as for isolated client components today: JSON values, plus `Date`,
  `Map`, `Set` and the rest only with islands mode's codec. A function or an element prop means no
  island, with a warning.
- **Server output as children.** Not in this RFC. A client component passed server-rendered
  children keeps its server HTML outside a hydrating layout, as today. Mounting DOM the renderer
  didn't render (`<f-slot>`) is still open for React too (RFC 0003, open question 1).
- **Context.** In the browser, an island sees integration providers and nothing from the server
  components above it.
- **Nesting.** A client component inside an island is part of that island.
- **Tables, lists, `<select>` and SVG.** RFC 0006 grows the island to the container, but only
  where Farm parses the parent, which is JSX. A Vue or Svelte client component directly inside
  `<table>`, `<ul>` and the like would put `<f-island>` where the HTML parser moves it. Version 1
  documents this limit.
- **How many islands.** Outside islands mode, RFC 0001 allows four roots per route. It keeps the
  whole route as one root when the count depends on data, such as a `.map`. The planner reads that
  from JSX tokens. `v-for` and `{#each}` need the same reading, or Vue and Svelte routes with islands
  in a loop stay whole.
- **Hot updates.** These stay as each renderer's Vite plugin provides them
  ([custom renderers](https://farmjs.dev/docs/renderers/custom#hot-updates-in-development)).

## Costs

- Each renderer writes `withIsland`. React's existing wrapper is about 90 lines.
- Farm runs the build check for `client:*` on each server module:
  - For JSX, it parses the source before the renderer compiles it, as `farm:island-containers`
    does.
  - For `.vue` and `.svelte`, it reads the compiled output. There the attribute is an object key
    in the props of a call whose callee or first argument is the component (see the table above).
    This needs a spike.
- Babel: Farm sets `throwIfNamespace: false` where it configures Babel JSX (Preact with a `babel`
  option).
- When off, nothing is added. Without `isolatedClientHydration` or islands mode, client exports
  aren't wrapped, and route-wide hydration is unchanged.
- Bytes: not measured. The scheduler and loader already ship with React islands. The non-React
  loader drops the React error boundary. Phase 1 measures each renderer's page with and without
  islands.

## Alternatives considered

- **The attribute alone promotes any component (Astro's full model).** The build check would
  already find the use site. Farm already generates client modules for package client components
  in islands mode, so the import could point at a generated `"use client"` re-export.
  - Not chosen for now: every other use of that import in the module would hydrate too, and a
    stateful component used without the attribute would render as a dead control.
  - Revisit if third-party components without `"use client"` turn out to be common.
- **Core renders each island separately and splices it into the stream.** This needs no renderer
  export. But it costs a renderer call per island plus splicing async output into the stream, even
  for renderers that can hydrate a nested container inline (React, and Solid with render ids). A
  renderer can still do this inside its own `withIsland`.
- **A `<farm-island>` custom element that renders its component in the browser.** It has no
  server HTML, so the page shows nothing until JavaScript runs.
- **Per-renderer island APIs** (`@farm.js/vue/island`, and so on). Each would have its own markup
  and loader, and none would share the scheduler, preloads or the contract suite.

## Rollout

0. **Fail closed.** Give the config error above to a renderer without `withIsland` when islands
   are enabled, with a regression test. This can ship on its own.
1. **The seam.**
   - Add `withIsland`, `FarmIslandReference` and `resolveFarmIsland`.
   - Drop the transform's React gate for renderers that implement `withIsland`.
   - Build the non-React browser loader.
   - The custom renderer example (`examples/custom-renderer`) implements it first: it's the
     smallest renderer and has its own browser tests. Then Preact, Solid, Vue and Svelte.
   - Shared coverage in `@farm.js/renderer-tests`: an island hydrates alone, keeps its server HTML
     when props don't serialize, and restores it on a hydration error.
2. **The `client:*` attribute**, for every renderer including React: removal (in `"rsc"` mode too,
   where client references come from `@vitejs/plugin-rsc`), precedence, the build check, types, the
   Babel option and the docs.
3. **Vue and Svelte client modules.** An imported `hydrate = true` module becomes an island when
   islands are on.
4. **Later, in their own RFCs:**
   - server output as island children (`<f-slot>`) per renderer;
   - islands mode (islx adapters beyond `@farm.js/islx/react`);
   - async pages for non-React renderers.

## Acceptance

- Each renderer passes the shared suite in `farm dev` and in a production build:
  - A server page renders one client component three times with three strategies.
  - The `client:visible` copy requests its chunk only after it scrolls into view, asserted from
    network requests.
  - Each island keeps its own state.
  - Props round-trip.
  - A hydration error restores the server HTML.
- A page without islands ships the same JavaScript as before, compared byte for byte in the
  production build.
- `client:*` on a server component fails the build with the message above, in each template
  language.

## Open questions

1. **`client:only` and `client:media`.** One would skip the server render, the other would match a
   media query. Neither strategy exists today.
2. **Attribute values as options,** for example `client:visible="400px"` for a root margin.
3. **Showing a client component as static HTML at one use site.** For example, `client:none` for a
   chart that doesn't need to be interactive on that page.
4. **The build check for template languages.** Read the compiled output (proposed), or parse each
   template language.
5. **Inline or separate rendering.** Can Vue and Svelte render an island inline so it hydrates as
   its own root, or must they render it separately?
6. **Loops in templates.** How the planner counts islands in `v-for` and `{#each}` (see
   Composition).
7. **Custom formats.** The re-export works today. Should the renderer descriptor also be able to
   name the marker for its format?
