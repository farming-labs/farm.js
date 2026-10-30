# RFC 0003: Server components in islands mode

- Status: Draft
- Tracking issue: none yet
- Scope: `experimental.serverComponents`, production and development, React first; the wire format
  is renderer-neutral

## Summary

`experimental.serverComponents` becomes `boolean | { mode: "rsc" | "islands" }`. Both modes share
one authoring contract: pages and layouts are server components by default, `"use client"` marks
client code, async components and Suspense stream, and server actions, metadata and
`generateStaticParams` behave the same. Switching modes is a one-line config change.

- `"rsc"` runs React's Flight pipeline (`@farm.js/plugin/rsc` on `@vitejs/plugin-rsc`). `true`
  means `{ mode: "rsc" }`.
- `"islands"` is Farm's own engine. It sends the static output once, as HTML, plus a small manifest
  of client components and their props. It hydrates only client components, groups the ones that
  share context into context regions, and navigates by layout segment. Large prop values are
  content-addressed: sent once, by hash, as immutable files the browser caches across pages.

```ts
export default defineConfig({
  experimental: {
    serverComponents: { mode: "islands" },
  },
});
```

## Motivation

RSC lets an app keep server code off the client while keeping one React tree, so context and
client state work across the page and across navigations. The tree has a cost that content-heavy
pages pay in full. Measured on a 376-page documentation site (assistant-ui.com's docs) built three
ways, page `/docs/architecture`, October 27, 2026:

| Build                     | Document | Inlined payload |
| ------------------------- | -------- | --------------- |
| Farm, `"rsc"` mode        | 391 KB   | 239 KB          |
| Next.js 16                | 410 KB   | 267 KB          |
| Farm, normal `farm build` | 179 KB   | none            |

The costs, in order of size:

1. **The page is sent twice.** The HTML paints the page; the inlined payload rebuilds the same
   output as a tree for hydration. On this page that is 61% of the document.
2. **Hydration walks static output.** React hydrates one root for the document. Server components
   do not run in the browser, but every element they produced is matched against the DOM.
3. **Navigation resends shared layouts or whole pages.** Farm's `"rsc"` mode fetches one payload
   per page, layouts included. Farm's `Link` prefetches whole HTML documents (3.2 MB for 73 links on
   one page). Next 16 fetches by segment and reuses layouts, but its page segments were still
   20–354 KB uncompressed each.
4. **Two server renders per uncached request:** the RSC render, then SSR of its payload.
5. **React only.** Flight is React's element tree; Preact, Solid, Vue and Svelte cannot use it.

What RSC gains (server-only code and its imports stay out of the client) is already measured in
Farm. Server layouts (#2299) took the same docs entry from 191 to 51 files, client JS from 1.80 to
1.47 MB, and hydration from 661 to 397 ms. Islands mode keeps that gain and removes costs 1–3 and 5.

## Goals

- One authoring contract for both modes; no component changes when switching.
- First-load documents within 10% of a normal Farm build of the same page (no duplicated output).
- Hydrate only client components; never walk static output.
- Context and state work as in `"rsc"` for client components under a shared provider.
- Client state in unchanged layouts survives navigation.
- Navigation transfers only the segments that change, cached by segment, with prefetch.
- Development and production behave the same.
- A deterministic, diagnosed fallback for every unsupported composition; never a broken page.
- A wire format that other renderers can adopt.

## Non-goals

- Replacing `"rsc"`. It stays a supported mode and the meaning of `true`.
- A Flight-compatible payload in islands mode.
- Resumability (Qwik-style serialization of closures and listeners).
- Changing the normal `farm build` path for apps without `serverComponents`.

## Configuration

```ts
interface FarmExperimentalConfig {
  serverComponents?: boolean | { mode: "rsc" | "islands" };
}
```

| Value                 | Meaning                      |
| --------------------- | ---------------------------- |
| `false` or unset      | No server components (today) |
| `true`                | `{ mode: "rsc" }`            |
| `{ mode: "rsc" }`     | React Flight pipeline        |
| `{ mode: "islands" }` | This RFC                     |

`mode` is required in the object form, so that a later default change cannot silently switch an
app's engine. Whether `true` ever maps to `"islands"` is decided after the acceptance gates pass
(see [Open questions](#open-questions)).

## The authoring contract (both modes)

- A page, layout, `loading`, `error` or `not-found` file is a server component unless its module
  starts with `"use client"`.
- `"use client"` marks a module as an entry into the client graph; its imports are client code.
- Server components may be `async`, may not use state, effects or context, and may read server-only
  modules (`server-only`, the `react-server` condition).
- Props from server to client must be serializable: the same set RSC allows (primitives, plain
  objects and arrays, `Date`, `Map`, `Set`, `BigInt`, typed arrays, promises, elements, server
  actions).
- Server output may be passed to a client component as `children` or another prop.
- `Suspense` boundaries stream; a promise passed to a client component resolves with `use()`.
- `"use server"` functions are callable from client code and from `<form action>`.

A test suite runs the same app fixtures in both modes and compares rendered DOM, interactivity and
navigation state.

## Design

### 1. One server render

Islands mode renders once. Server components execute and produce host elements. A client component
renders in place through the server proxy of RFC 0001, which wraps its HTML in a boundary marker and
records its module reference and props. There is no separate SSR pass over a payload, which removes
cost 4.

### 2. First-load wire format: HTML plus island scripts

The format is implemented in [islx](https://github.com/farming-labs/islx) (`@farm.js/islx`), a
renderer-agnostic package Farm's islands mode runs on; its
[SPEC.md](https://github.com/farming-labs/islx/blob/main/SPEC.md) is the normative version. Every
element, script type and header carries the `f` prefix, and JSON reserves one key, `$`:

```html
<f-island src="src/components/toc.tsx" export="Toc" props="_R_b_" strategy="load">…</f-island>
<script type="f/props" for="_R_b_">{"headings":[…],"tree":{"$":"r","v":"04jiw29097x8ki"}}</script>
<script type="f/value" name="04jiw29097x8ki">[…]</script>
<f-slot name="_R_5_s0">…server output passed as children…</f-slot>
```

Headers: `F-Values` (values the browser holds), `F-Layouts` (layouts on screen), `F-Render`
(`tree`: rebuild from the server tree; `document`: a navigation), `F-Action` (an action call).
Tags: `r` value, `s` slot, `a` action (with `b`, its sealed captured values), `o` app data with a
`$` key, and `u n B D M S U R Y F K` for the types JSON cannot hold.

The design below began as one manifest per page:

The document carries the HTML and one non-executable JSON manifest, escaped like Farm's existing
page data:

```ts
interface FarmIslandManifest {
  version: 1;
  islands: Array<{
    id: string; // matches data-farm-client-boundary in the HTML
    ref: string; // client reference: module id and export
    props: SerializedProps; // RSC-equivalent serialization
    strategy: "load" | "interaction" | "visible" | "idle";
    region?: string; // the context region that owns it, if any
    slots?: Record<string, string>; // prop name to slot id, for server output passed as props
  }>;
  regions: Array<{
    id: string;
    ref: string;
    props: SerializedProps;
    slots: Record<string, string>;
  }>;
  segments: string[]; // segment keys rendered on this page, root to leaf
}
```

Static output appears only in the HTML. The manifest holds no element tree for it. Props are what
remains, and on the benchmark they are not small: 150 KB raw on one docs page, almost all of it one
value (the navigation tree passed to a client provider). Section 3 handles that.

### 3. Content-addressed values

Client props repeat across pages. On the benchmark, 98.5% of prop bytes on a docs page are
identical to the previous page's, and one value, the navigation tree, is about 95% of them. RSC
inlines every value in every payload. Islands mode sends a large value once:

- A serialized prop value whose JSON reaches 512 bytes is identified by a 64-bit hash of that JSON.
  The island's props carry `{"$":"r","v":"<hash>"}` in its place, and the value travels in a
  `<script type="f/value" name="<hash>">` before the island. Inner values are
  addressed first, so a tree that changes in one place keeps sharing its unchanged parts; a thin
  wrapper around one addressed value gets no key of its own.
- **Client:** a value store keyed by hash. It parses each value once and hands islands that share a
  value the same object. Only islands mode ships it.
- **Navigation:** the request names the hashes the client holds (`F-Values`, the 128 most
  recently used). The server leaves those values out, with everything inside them. An exact list
  instead of a Bloom filter: no false positives, so no recovery fetch, and the header stays under
  2 KB.
- **Caching:** leaving values out makes the HTML one browser's. The server counts it as a request
  read, the mechanism `headers()` uses, so that response never enters a PPR shell, an ISR entry or
  a shared CDN cache, and production page responses vary on `F-Values`. Responses without the
  header, including every first load, stay complete and cacheable.
- **Shared value files (measured, not built):** writing values that two or more prerendered pages
  share as immutable files (`/_farm/v/<hash>.json`) makes a first visit 43% heavier on the docs
  benchmark (16.0 KB to 23.0 KB, plus a request before islands hydrate) and a later full load 21%
  lighter (16.0 KB to 12.6 KB): break-even at two cached full loads per first visit. The values
  repeat text the HTML renders, which brotli shares inside the document (3.5 KB) but not in a
  separate file (10.4 KB). Worth revisiting only for large values the HTML does not render, such as
  search indexes. The lab figure above assumed the file was already cached.
- Within one document: islx writes each value once per response. A render state the framework
  gives (`renderToStream`, `IslandsProvider`, or Farm's request store) remembers what the response
  wrote, and an island records its values only after its props have encoded, so a render React
  retries (an action's values still sealing) never marks a value written without writing it. On the
  docs benchmark the raw document drops from 103.5 KB to 69.7 KB; brotli had already removed most
  of the repeat (16.0 to 15.9 KB).

Measured in the lab on the RSC benchmark (brotli, averages over 376 docs pages): the first-load
document drops from 46.0 KB (islands) to 22.8 KB, plus a 23.5 KB value file shared by every docs page,
and a navigation from 29.1 KB to 5.7 KB.

Measured on the implementation (`benchmarks/server-components-payload`, a 300-page docs app whose
layout passes a 32 KB tree to two client components, production builds in Chrome): a navigation drops
from 100.9 KB raw (15.7 KB brotli) to 38.4 KB (12.3 KB), level with `"rsc"` at 37.4 KB (12.0 KB),
with 28% less first-load JavaScript than `"rsc"`. Segment navigation then removes the layout's HTML:
8.0 KB raw (2.5 KB brotli) per navigation.

### 4. Hydration: islands, then regions

Each island hydrates as its own root with the existing island runtime and strategies, from its
recorded props. Static HTML between islands is never hydrated.

### 5. Context regions

Independent roots cannot share context, which is why RFC 0001 falls back to route-wide hydration
around providers. A **context region** removes that fallback.

A client component that receives server output (as `children` or another element prop) and renders
it is a region. The region hydrates as one root. Its server-output props are **slots**: references
to the DOM ranges that already hold that output. Islands inside a slot become descendants of the
region's tree, so they read its context and share its state.

Slots are what keep regions cheap. A slot is mounted as an opaque host element whose content React
does not reconcile. Its HTML is read from the existing DOM at hydration time, not sent again. Server
layouts (#2299) and the server tree already render static subtrees this way (`<f-html>`),
but they embed the HTML a second time in the JSON. Islands mode must not.

A client component that inspects its children (`Children.map`, `cloneElement`, `isValidElement` on
them) cannot work with an opaque slot. That one slot is sent in element form (the server tree's
format), and the build reports it. Eligibility is decided before any output is optimized; anything
ambiguous takes the element form.

### 6. Streaming

HTML streams as today. A Suspense boundary's late chunk carries its HTML and the manifest entries
for the islands inside it. The island runtime hydrates them when the chunk arrives. An island in a
fallback that is replaced before it hydrates is never hydrated.

### 7. Navigation by segment

A route is a chain of segments: each layout, then the page. Navigation requests only the segments
below the first one that changes.

- **Request:** the target URL and the segment keys the client already has.
- **Response, per segment:** its HTML, its manifest entries (islands, regions, slots), and head
  changes (title and metadata tags, through the existing metadata reconciler).
- **Client:** unchanged segments stay mounted, so their roots, state, focus and scroll position
  survive. Islands and regions in replaced segments are unmounted before the new HTML is inserted;
  the new ones hydrate with their strategies.
- **Cache:** a client cache keyed by segment and URL. A layout segment fetched once is reused for
  every page under it.
- **Prefetch:** a small route tree first (which segments the target needs), then the missing
  segments, for links in the viewport or on intent. This replaces `Link`'s whole-document
  prefetch in islands mode.
- **Static pages:** segment responses are written at build time as files at their own URLs, so CDNs
  cache them without relying on `Vary`.

### 8. Server actions

Islands mode keeps Farm's `"use server"` transform, ids and request security (origin check, body
limit). The response is the action's result, plus refreshed segments in the navigation format when
the action revalidated data the page shows. `<form action>` keeps working before JavaScript loads.

### 9. Renderers

The wire is HTML plus serialized props and DOM slot references, so it is not tied to React's tree.
React ships first. Other renderers adopt the same manifest through their client and server bindings,
with shared coverage in `@farm.js/renderer-tests`.

## Fallbacks

| Situation                                                | Result                                         |
| -------------------------------------------------------- | ---------------------------------------------- |
| Client component inspects its children                   | That slot sent in element form                 |
| Props that do not serialize                              | Build error, as in `"rsc"`                     |
| Unsupported client import shape (RFC 0001 list)          | Route-wide hydration for that route, diagnosed |
| Integration provider without `supportsIsolatedHydration` | Region around the provider, or route-wide      |
| Island chunk fails to load                               | Server HTML stays; error reported              |

Every fallback logs once per module with the reason, and the build report lists them.

## Measurements

[`benchmarks/islands-payload`](../benchmarks/islands-payload) reads a built RSC app's static
output and compares designs. assistant-ui.com's docs (376 static pages), brotli q5, averages:

| Design                                | First-load document                       | Bytes per navigation |
| ------------------------------------- | ----------------------------------------- | -------------------: |
| `"rsc"`                               | 56.9 KB                                   |              38.8 KB |
| Islands: HTML plus client props       | 46.0 KB                                   |              29.1 KB |
| Islands plus content-addressed values | 22.8 KB, plus a shared 23.5 KB value file |               5.7 KB |

Ideas that did not help, so the design leaves them out:

- **String interning** (a dictionary of repeated strings such as class names): 9% smaller raw, 5%
  larger after brotli, which already removes that repetition.
- **Reusing payload rows or element subtrees across pages by hash:** only 22.8% of a payload's rows
  and 7.5% of its element subtrees are already held after a navigation. Large values repeat; markup
  does not.
- **Hash-consing repeated subtrees inside a page:** at most 8.3% of bytes raw, before compression.

## Comparison

|                         | `"rsc"`                    | `"islands"`                                  |
| ----------------------- | -------------------------- | -------------------------------------------- |
| Server renders per page | Two (RSC, then SSR)        | One                                          |
| First-load extra data   | Whole tree as payload      | Client props; large values once, by hash     |
| Hydration               | One root, walks all output | Islands and regions; static output untouched |
| Shared context          | Whole tree                 | Inside a region                              |
| Navigation              | Payload per page           | Changed segments; held values not resent     |
| Renderers               | React                      | React first, others by design                |

## Acceptance

Each phase must pass before the next starts. Benchmarks compare the same pages in islands mode,
`"rsc"` mode and Next.js on: document bytes, client JS, requests, time to hydrate, bytes per
navigation, and build time.

Correctness matrix: development and production; static, dynamic and streaming pages; client
navigation with state kept in layouts; back and forward; HMR; error and not-found boundaries;
`basePath`; i18n; node-server, Vercel and Cloudflare targets.

## Rollout

| Phase | Work                                                                                                          | Gate                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0     | Config type, `true` = `"rsc"`, docs                                                                           | Type and docs only                                                                            |
| 1     | Islands mode for React: server components by default, island manifest, content-addressed values, static pages | `benchmarks/islands-payload` documents at or below the measured 22.8 KB; only islands hydrate |
| 2     | Context regions with DOM slots                                                                                | Providers work; pixel-identical; state kept                                                   |
| 3     | Segment navigation, cache and prefetch                                                                        | Bytes per navigation below Next.js on the same pages                                          |
| 4     | Streaming with islands in late chunks                                                                         | First content no later than `"rsc"`                                                           |
| 5     | Actions with segment refresh                                                                                  | Parity with `"rsc"` action tests                                                              |
| 6     | Other renderers                                                                                               | Shared renderer suite                                                                         |

## Implementation status

- Phase 0: done (#2315).
- Phase 1: islands mode on Farm's pipeline, server owners for context, DOM slots, `"use server"`
  actions with progressive enhancement, content-addressed values with navigation omission, in
  `farm dev` and production. Each island keeps its own props script: one manifest for the page
  measured 0 to 12 bytes worse after brotli and would hold back islands in streamed chunks, so the
  "manifest" is the set of per-island scripts. Not built: shared value files (measured above),
  values in server-tree payloads.
- Phase 3, first part: segment navigation in production. A navigation sends the layouts on screen
  (`F-Layouts`, keyed by pattern and params); the server renders the page and the layouts
  that changed, and marks the rest `data-farm-layout-kept`. The browser applies a segment only where
  the page still shows those layouts, and fetches the whole document otherwise (a stale prefetch).
  Not kept: the root layout, any layout when one in the chain hydrates as a root, and routes with
  slots. Routes a shared cache can store send the whole document, and the request-scoped response
  is `private, no-store`. A kept layout does not render, as in Next.js: access checks belong in
  middleware or page guards. PPR routes cache each segment under its own key (the page's shell key
plus the number of kept layouts; `revalidatePath` clears both, since entries are stored by path).
The prefetch cache keys a partial response by the headers it was asked with (layout chain, tree
navigation), so a navigation from other layouts fetches its own answer.
- Values in server-tree payloads: a page under a layout that hydrates as one root sends its large
  prop values once, in scripts right before its payload, and the browser re-renders those scripts
  so hydration matches. On the shop benchmark a navigation drops from 5.8 KB to 4.2 KB (brotli);
  RSC sends 3.8 KB.
- Payload-only navigations: a browser that renders the destination in its layout's React root
  says so (`F-Render: tree`), and the server sends that page's payload, chunks and
  server-HTML parts without its HTML, which the browser would never use. The shop navigation
  drops to 1.5 KB. A response marked payload-only that arrives where no root can rebuild it (a
  stale prefetch) makes the browser fetch the whole document; a failed chunk renders the page
  whole so its error boundary applies.
- Server actions as props: a registered `"use server"` function in client props travels as
  `{"$":"a","v":id}` in island props and server-tree payloads alike; the browser turns it
  into a cached stub, and server rendering keeps the real function, so the form still posts without
  JavaScript. After an action called from JavaScript the page refreshes; a refresh carries the
  islands still on the page over (same component at the same position keeps its root and state and
  gets the new props), as one React tree would. A `redirect()` from the action is a client
  navigation.
- Typed values: props, server-tree payloads and action arguments and results carry `undefined`,
  non-finite numbers and `-0`, `BigInt`, `Date`, `Map`, `Set`, `URL`, `RegExp`, typed arrays and
  `ArrayBuffer` as `$` tags (`{"$":"D","v":"…"}`). The server encodes through its installed hook,
  so the browser bundle carries only the decoder. Decoding action arguments accepts browser input:
  no `__proto__` assignment, unknown or malformed tags rejected with 400. App data that has its own
  `$` key travels wrapped as `o`, so no key is reserved.
- Contract suite: `tests/e2e-server-components`, the same tests for `"rsc"` and `"islands"`, against
  `farm dev` and production builds.
- islx: the format, the codec, values, server trees, hydration and server actions moved into
  [`@farm.js/islx`](https://github.com/farming-labs/islx) (0.0.1), which islands mode now runs on
  (#2367). It added inline `"use server"` functions: the variables they read from their component
  travel sealed (AES-GCM, bound to the action, a key per build or `ISLX_ACTIONS_KEY`), never as
  readable form fields. Forms written in server components post without a page load once
  JavaScript runs. The contract suite covers both, in both modes (18 tests). Apps on isolated
  hydration without islands mode never load islx.

## Prior work in Farm

- [RFC 0001](./0001-isolated-client-hydration.md): isolated client boundaries, the server proxy,
  island strategies.
- The server tree (`client/server-tree.ts`): server output as a tree of host elements and client
  references, with `<f-html>` for parts it cannot represent.
- Server layouts (#2299): a layout rendered as a server tree whose client components rebuild under
  the parent root, the first context region.
- Page module preloads (#2292), so island chunks are not discovered late.
- `"rsc"` mode in `@farm.js/plugin/rsc`, including prerendered payloads and `farm.config.ts`
  support.

## Alternatives considered

- **Only `"rsc"`.** Keeps every cost above, and keeps server components React-only.
- **Shrink the Flight payload by referencing the DOM.** Needs a fork of React's Flight client,
  because hydration consumes the decoded tree, not the DOM.
- **Resumability.** Removes hydration but needs closures and listeners to be serializable, which
  changes the component model and breaks the shared contract.
- **Isolated hydration without regions.** Already implemented (RFC 0001). Real apps wrap content in
  providers, so most routes fall back to route-wide hydration.

## Open questions

1. **Slot adoption in React.** Mounting a slot from DOM that React did not render needs a verified
   pattern that survives re-renders, Strict Mode and HMR. Phase 2 starts with that spike.
2. **Region detection.** Inferred from "client component renders server output", or an explicit
   marker on providers, or both.
3. **Segment URLs.** The path scheme for prerendered segment files, and how it composes with
   `basePath` and i18n.
4. **Revalidation.** How ISR and `revalidate` apply to segment files.
5. **The default.** Whether and when `true` maps to `"islands"`.
6. **Value threshold.** The size above which a value is content-addressed, and how many pages must
   share it before it becomes a file instead of staying inline.
7. **Value file lifetime.** Files are immutable by hash; old ones need a cleanup story per deploy
   target.
