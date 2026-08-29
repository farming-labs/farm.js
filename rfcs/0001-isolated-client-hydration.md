# RFC 0001: Isolated client hydration inside server-rendered layouts

- Status: Proposed
- Tracking issue: [#565](https://github.com/farming-labs/farm.js/issues/565)
- Scope: Standard React renderer (non-RSC)

## Summary

Farm currently promotes a complete route or layout to a browser hydration root when static analysis
finds a transitive `"use client"` import. This is valid traditional SSR, but it also puts the server
layout in the browser module graph and executes it during hydration.

This RFC proposes an experimental component-island protocol. A server-rendered layout remains a
server module while each supported `"use client"` leaf receives its own marker, client module
reference, serialized props, and React root.

```text
Server-rendered layout (never imported by the browser)
├── static layout markup
├── isolated client boundary (hydrated independently)
└── server-rendered page
```

The first implementation must be gated by `experimental.isolatedClientHydration`. Existing
route-wide hydration remains the default and the safe fallback until the acceptance matrix in this
RFC passes in development and production.

## Motivation

With the standard React renderer, `"use client"` means that browser interactivity is required. It
does not mean that every server module above that component should become browser code.

Today a layout such as this becomes the hydration boundary:

```tsx
import { AccountMenu } from "../components/account-menu";
import { readServerTheme } from "../server/theme";

export default function Layout({ children }) {
  const theme = readServerTheme();
  return (
    <main data-theme={theme}>
      <AccountMenu />
      {children}
    </main>
  );
}
```

If `AccountMenu` contains `"use client"`, Farm currently imports and executes `Layout` in the
browser. That duplicates module execution and can expose server-only dependencies to Vite's client
graph. PR #564 makes failures in this path visible; it intentionally does not change the ownership
of the hydration root.

## Why an RFC comes before the runtime change

This is not only a bundling optimization. The current route-wide root also defines observable React
semantics: which components share context, which error and Suspense boundaries own work, which state
survives navigation, and when roots are disposed. Splitting it into independent roots without first
agreeing on those rules could make a smaller bundle that is behaviorally incorrect.

The RFC does not prevent implementation experiments. It gives the gated implementation PRs a
reviewable pass/fail contract and prevents a partial experiment from silently becoming the default.
The feature should graduate only when it is both correct and a measured net performance gain.

## Goals

- Keep a server layout out of the browser graph when it only renders supported client leaves.
- Preserve the server-rendered DOM if a boundary cannot load or hydrate.
- Hydrate only the explicit client module with serializable props.
- Preserve client state in shared layouts during SPA navigation.
- Support multiple and nested client-module imports without creating overlapping React roots.
- Keep development and production behavior equivalent.
- Define deterministic fallback and diagnostic behavior for unsupported compositions.

## Non-goals

- Reimplementing the React Server Components transport.
- Passing arbitrary server React nodes, functions, classes, or request objects to a client root.
- Sharing React context across independent roots.
- Changing the behavior of explicit client layouts or `export const hydrate = true`.
- Enabling the feature for Vue, Svelte, Solid, or Preact in the first implementation.

## Current behavior

`getClientModuleMetadata()` recursively follows imports. When a layout reaches a client module it
sets `shouldHydrate: true`. The route manifest then includes the layout module, and both generated
client runtimes import the complete layout and hydrate from `#root`.

This route-wide root currently owns several behaviors that an isolated design must replace
deliberately:

- layout and page composition;
- integration providers;
- Suspense and error ownership;
- island scheduling and pre-hydration click replay;
- SPA navigation and root disposal;
- HMR rerendering.

## Proposed model

### 1. Classify client edges instead of promoting every ancestor

Static analysis should distinguish these cases:

| Module shape                                         | Hydration plan                       |
| ---------------------------------------------------- | ------------------------------------ |
| Layout contains `"use client"`                       | Existing route-wide layout hydration |
| Layout exports `hydrate = true`                      | Existing route-wide layout hydration |
| Server layout imports supported client leaves        | Isolated component boundaries        |
| Server layout uses an unsupported client composition | Existing route-wide fallback         |
| Server layout has no client edge                     | No hydration                         |

The compiled metadata should record a hydration kind and boundary references rather than using a
single transitive boolean:

```ts
type FarmHydrationKind = "none" | "module" | "isolated" | "fallback";

interface FarmClientBoundaryReference {
  id: string;
  modulePath: string;
  exportName: string;
  islandStrategy: "load" | "interaction" | "visible" | "idle";
}
```

`shouldHydrate` remains available while the feature is experimental, but an isolated layout must
not use it to place the layout module in the browser graph.

### 2. Create server proxies for client imports

For SSR transforms only, imports from a `"use client"` module should resolve through a generated
server proxy. The proxy renders the real implementation on the server and wraps its output with a
boundary marker. Client-to-client imports continue to resolve normally, so descendants of an
existing client root do not create nested roots.

The first implementation supports default and named component imports. Namespace imports, dynamic
client imports owned by a server module, JSX spreads that prevent safe analysis, and client
components receiving React-element children use the route-wide fallback.

### 3. Emit a boundary protocol

Each supported boundary receives a request-unique ID. Props are stored in a non-executable JSON
script and escaped with the same HTML-safe rules as existing page data.

```html
<farm-client-boundary
  data-farm-client-boundary="b1"
  data-farm-client-ref="account-menu:AccountMenu"
  data-farm-island-strategy="load"
  style="display: contents"
>
  <button type="button">Account</button>
</farm-client-boundary>
<script type="application/json" data-farm-client-props="b1">
  { "avatarUrl": "/avatar.png" }
</script>
```

The marker element is the `hydrateRoot()` container. Parser-sensitive locations such as table,
select, and SVG content are unsupported in the first implementation and use route-wide hydration.
This restriction avoids browser reparsing that could move the marker away from its server markup.

Boundary IDs are transport identifiers, not component keys. The runtime owns roots by marker
element so IDs from navigation fragments cannot collide with roots already in the document.

### 4. Generate a boundary manifest

The client build should contain loaders for boundary modules, not imports of their server owners:

```ts
const boundaryManifest = {
  "account-menu:AccountMenu": {
    load: () => import("/src/components/account-menu.tsx"),
    exportName: "AccountMenu",
  },
};
```

Production converts module paths to chunk references. Development uses Vite module URLs. In both
modes the manifest is generated from the same compiled boundary metadata.

A production regression must prove that a server-only sentinel from the layout is absent from the
client output and that no client chunk imports the layout module.

### 5. Hydrate and dispose roots independently

The client runtime scans for unowned `[data-farm-client-boundary]` markers and, for each marker:

1. reads and validates its props record;
2. resolves the manifest entry;
3. schedules the existing island strategy;
4. imports the client module;
5. calls `hydrateRoot(marker, createElement(Component, props))`;
6. marks the boundary hydrated and replays queued interactions inside that marker.

Loading or hydration failure reports the boundary reference and original error, leaves the SSR DOM
in place, and never replaces the boundary with an empty client root.

Before navigation removes a subtree, the runtime unmounts every owned root inside that subtree.
After the HTML fragment is committed, it scans only the inserted subtree. Boundaries in a shared
layout are not replaced or rehydrated, so their state survives navigation.

### 6. Define composition semantics

#### Nested client imports

If one client component imports another, they belong to one client graph and one React root. Only
the server-to-client edge emits a marker. Overlapping roots are forbidden.

#### Props and children

The initial serializer accepts JSON-compatible values plus the existing explicitly supported page
data encodings. Functions, symbols, class instances, DOM objects, request objects, and React
elements are not serializable.

A client component used with React-element `children` is not isolated in the first implementation.
Static detection selects route-wide hydration. If an unsupported value is discovered only while
rendering, Farm reports an actionable error and leaves that boundary server-rendered instead of
destroying its HTML.

#### Context and integration providers

An isolated root cannot inherit React context from a server layout, sibling root, or route-wide
integration provider. Context must be created inside the client boundary's own graph. A client
provider intended to wrap server-rendered children is an unsupported composition and uses
route-wide hydration.

Integrations that require `wrapWithIntegrationProviders()` must declare isolated-root support.
Otherwise their routes use the existing root.

#### Suspense and errors

Server Suspense and error boundaries continue to own server rendering. Once hydration begins, only
Suspense and error boundaries inside the same client graph can catch work from that client root.
An import or root-level hydration failure is handled by Farm's boundary diagnostic and preserves
SSR markup.

### 7. Preserve explicit whole-module behavior

These cases continue to use the existing route-wide path:

- the layout itself has a `"use client"` directive;
- the layout exports `hydrate = true`;
- static analysis finds an unsupported composition;
- a renderer or integration does not opt into isolated roots;
- the experimental option is disabled.

This makes the rollout additive and provides an escape hatch while component islands mature.

## Safety invariants

The experimental implementation and every later stable version must preserve these invariants:

1. **Server graph isolation is verified.** A client build must fail its regression fixture if the
   owning layout, its server-only dependency, or a server sentinel appears in a browser chunk.
2. **SSR is the fail-closed state.** An import, manifest, serialization, or hydration error keeps the
   server-rendered DOM visible. Farm must not clear the container or mount an empty replacement root.
3. **Serialization is allowlisted.** The transport accepts plain, explicitly supported data only.
   It rejects functions, symbols, React elements, objects with custom prototypes, request objects,
   and other executable or ambient server state.
4. **Only explicit props cross the boundary.** Farm never serializes module scope, closures,
   environment variables, integration secrets, or the layout's complete props as a convenience.
5. **The payload is HTML-safe and non-executable.** JSON escapes `<`, `>`, `&`, and line separators,
   is read from `textContent`, and is parsed without `eval` or generated script execution.
6. **Ownership is exact.** One marker has at most one React root. Client-to-client imports do not
   create nested markers, and removed navigation subtrees are unmounted before DOM removal.
7. **Unsupported semantics are explicit.** Context spanning roots, React-element children,
   parser-sensitive containers, and integrations without isolated-root support select the existing
   route-wide path or preserve inert SSR with a clear runtime diagnostic.
8. **Resource use is bounded.** Boundary count, serialized bytes, roots, and queued interactions are
   observable and guarded. Exceeding an implementation limit cannot cause unbounded roots or payload
   growth; Farm chooses the safe route-wide plan when it can do so before streaming begins.
9. **The flag is off by default.** Development, SSR, SSG, and navigation use the same compiled plan,
   so production cannot unexpectedly select a less-tested ownership model.

These invariants are required tests, not documentation-only promises.

## Performance and cost model

Isolated hydration is expected to win when a relatively large server layout owns a small number of
interactive leaves. It is not automatically cheaper for every route.

### Expected gains

- The layout and its transitive server-oriented modules are removed from client transfer,
  parse/compile, and evaluation work.
- React hydrates the interactive leaves instead of reconstructing the complete layout and page
  tree.
- Shared layout boundaries keep their roots and state during navigation rather than rerendering the
  whole route owner.
- `interaction`, `visible`, and `idle` strategies defer module loading and hydration per boundary
  instead of delaying or activating one large route root.

### Added costs

- A shared boundary loader, manifest, DOM scan, and root registry add client runtime bytes.
- Every marker and serialized prop record adds HTML and server serialization work.
- Many small boundaries can create extra chunks and requests.
- Every independent React root has scheduler and memory overhead.
- Navigation must discover, hydrate, and dispose several roots instead of updating one root.

Therefore boundary count alone is not a success metric. The same fixture must be measured with the
existing route-wide plan and the isolated plan, using the same React version, bundler, minification,
and browser conditions.

### Required measurements

Implementation PRs must report at least:

- compressed and uncompressed initial client JavaScript;
- browser module and request counts;
- server HTML bytes, including markers and serialized props;
- server render/serialization time;
- client parse/evaluation and hydration time;
- time until the tested boundary handles its first interaction;
- post-hydration heap use and React root count;
- warm SPA navigation time and retained-layout state.

The benchmark suite needs three shapes: one small interactive leaf in a large server layout,
several normal sibling boundaries, and a many-boundary stress case. The stress case establishes the
crossover point where independent-root overhead outweighs the saved layout work.

### Graduation gates

The feature cannot become the default unless all of the following are true:

1. The representative layout fixture transfers and executes strictly less client JavaScript than
   route-wide hydration, and the server owner is absent from the client graph.
2. Median hydration CPU and first-interaction latency do not regress beyond the benchmark's measured
   confidence interval or 5%, whichever is larger. At least one representative fixture must show a
   statistically meaningful improvement rather than only parity.
3. Added HTML, SSR time, request count, and heap use are reported. Any material regression must be
   removed, justified by a larger measured user-facing win, or routed through the old plan.
4. The many-boundary benchmark has a documented crossover point. Before stable rollout, Farm must
   use a deterministic graph/boundary cost guard or retain route-wide hydration for shapes beyond
   that point.
5. Development and production select equivalent ownership. A production-only size heuristic cannot
   silently choose different React semantics.

In short: if Farm cannot demonstrate a net win for a route shape, it keeps the current route-wide
hydration path. Smaller client ownership is the mechanism; measured user-facing performance is the
goal.

## Configuration and rollout

The first implementation is opt-in:

```ts
export default defineConfig({
  experimental: {
    isolatedClientHydration: "enabled",
  },
});
```

The rollout has three explicit modes. Omitting the option or using `"off"` preserves route-wide
hydration. `"analyze"` reports which owners are eligible and the client modules they would remove
without changing runtime behavior. `"enabled"` uses isolated roots for safe shapes and automatically
keeps route-wide hydration for unsupported graphs. Boolean values are intentionally not accepted so
configuration remains unambiguous as the experiment evolves.

The flag must select the same plan during development, production SSR, SSG, and SPA navigation.
It should graduate to the default only after the acceptance matrix is stable across React 18 and
React 19. Removing the old route-wide fallback is not part of this RFC.

## Diagnostics

Diagnostics should identify the owner, client reference, and remediation. They must not suggest
that RSC is required.

Examples:

```text
[Farm.js] <AccountMenu> cannot use isolated hydration because its children contain a React element.
Falling back to route-wide hydration for layout "/dashboard".
```

```text
[Farm.js] Could not hydrate client boundary account-menu:AccountMenu. The server-rendered HTML was
preserved. Original error: ...
```

Development should explain the unsupported construct. Production may collapse repeated messages
but must retain the boundary reference and original error.

## Acceptance matrix

The feature is not complete until executable tests cover all rows below in development and the
prebuilt production runtime where applicable.

| Area                          | Required assertion                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Browser graph                 | A server layout sentinel and server-only dependency are absent from client chunks    |
| Client cost                   | Initial compressed JS, executed modules, and hydration CPU beat the route-wide case  |
| Server cost                   | Marker bytes and serialization time stay within the recorded performance budget      |
| Root overhead                 | Normal and stress fixtures report heap, root, request, and chunk counts              |
| Basic boundary                | A counter in a server layout hydrates and updates without importing the layout       |
| Multiple boundaries           | Independent sibling counters retain independent state                                |
| Nested client graph           | A client component importing another client component creates one root               |
| Shared layout navigation      | Layout boundary state survives page navigation                                       |
| Removed subtree               | Roots are unmounted before their navigation subtree is removed                       |
| New fragment                  | Only newly inserted boundaries hydrate after navigation                              |
| Scheduling                    | `load`, `interaction`, `visible`, and `idle` remain boundary-local                   |
| Click replay                  | A queued interaction replays exactly once in its owning boundary                     |
| Serializable props            | Supported values round-trip without hydration warnings                               |
| Unsupported children          | The route-wide fallback is selected with a clear diagnostic                          |
| Runtime serialization failure | SSR HTML remains intact and the original error is reported                           |
| Suspense and errors           | Client-local boundaries behave normally; root failure preserves SSR HTML             |
| HMR                           | Updating one client module rerenders its live instances without reloading the layout |
| React versions                | The React 18 and React 19 renderer jobs pass                                         |
| SSR modes                     | Streaming SSR, buffered SSR, and SSG emit equivalent boundary metadata               |

The core fixture should use a layout with a module-scope server-only sentinel and an interactive
client child. It must test both visible server layout content and client interaction, preventing a
regression that appears correct only after client rendering.

## Implementation phases

1. Capture route-wide correctness and performance baselines for the three benchmark shapes.
2. Add boundary metadata and server import proxies behind the experimental flag.
3. Add the marker/props protocol and isolated-root runtime for initial documents.
4. Integrate root ownership with fragment navigation, click replay, HMR, and client plugins.
5. Add production graph assertions, resource guards, and the complete acceptance fixture.
6. Publish the before/after report, document the crossover point, and evaluate stability.

Each phase must preserve the existing route-wide path. The flag should not ship as stable until all
phases are present; partial phases are suitable only for internal fixtures.

## Alternatives considered

### Keep hydrating the complete layout

This is simple and remains the fallback, but it continues to execute server-oriented modules in the
browser and does not address #565.

### Require RSC

RSC already has a client-reference transport, but #565 concerns the standard renderer. Requiring
RSC would change the application's rendering model rather than improve non-RSC SSR.

### Hydrate from arbitrary comment ranges

React's public `hydrateRoot()` API requires a root container. A marker element gives the runtime a
stable owner for scheduling, disposal, and click replay. Parser-sensitive contexts therefore need
an explicit fallback instead of relying on unsupported range hydration.

### Silently skip unsupported boundaries

That preserves HTML but leaves apparently interactive UI inert. Farm should either choose the known
route-wide fallback or emit a visible, actionable diagnostic when the unsupported value is only
known at render time.

## Decision requested

Approve the boundary protocol, safety invariants, performance gates, ownership rules, and opt-in
rollout as the contract for #565. Runtime implementation can then land incrementally without
changing the semantics described here or claiming a win that the benchmarks do not show.
