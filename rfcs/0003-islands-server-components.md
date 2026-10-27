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
  share context into context regions, and navigates by layout segment.

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

### 2. First-load wire format: HTML plus an island manifest

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

Static output appears only in the HTML. The manifest holds no element tree for it. On the
benchmark page this replaces the 239 KB inline payload with the props of the client components on
the page.

### 3. Hydration: islands, then regions

Each island hydrates as its own root with the existing island runtime and strategies, from its
recorded props. Static HTML between islands is never hydrated.

### 4. Context regions

Independent roots cannot share context, which is why RFC 0001 falls back to route-wide hydration
around providers. A **context region** removes that fallback.

A client component that receives server output (as `children` or another element prop) and renders
it is a region. The region hydrates as one root. Its server-output props are **slots**: references
to the DOM ranges that already hold that output. Islands inside a slot become descendants of the
region's tree, so they read its context and share its state.

Slots are what keep regions cheap. A slot is mounted as an opaque host element whose content React
does not reconcile. Its HTML is read from the existing DOM at hydration time, not sent again. Server
layouts (#2299) and the server tree already render static subtrees this way (`<farm-server-html>`),
but they embed the HTML a second time in the JSON. Islands mode must not.

A client component that inspects its children (`Children.map`, `cloneElement`, `isValidElement` on
them) cannot work with an opaque slot. That one slot is sent in element form (the server tree's
format), and the build reports it. Eligibility is decided before any output is optimized; anything
ambiguous takes the element form.

### 5. Streaming

HTML streams as today. A Suspense boundary's late chunk carries its HTML and the manifest entries
for the islands inside it. The island runtime hydrates them when the chunk arrives. An island in a
fallback that is replaced before it hydrates is never hydrated.

### 6. Navigation by segment

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

### 7. Server actions

Islands mode keeps Farm's `"use server"` transform, ids and request security (origin check, body
limit). The response is the action's result, plus refreshed segments in the navigation format when
the action revalidated data the page shows. `<form action>` keeps working before JavaScript loads.

### 8. Renderers

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

## Comparison

|                         | `"rsc"`                    | `"islands"`                                  |
| ----------------------- | -------------------------- | -------------------------------------------- |
| Server renders per page | Two (RSC, then SSR)        | One                                          |
| First-load extra data   | Whole tree as payload      | Client components' props                     |
| Hydration               | One root, walks all output | Islands and regions; static output untouched |
| Shared context          | Whole tree                 | Inside a region                              |
| Navigation              | Payload per page           | Changed segments' HTML and props             |
| Renderers               | React                      | React first, others by design                |

## Acceptance

Each phase must pass before the next starts. Benchmarks compare the same pages in islands mode,
`"rsc"` mode and Next.js on: document bytes, client JS, requests, time to hydrate, bytes per
navigation, and build time.

Correctness matrix: development and production; static, dynamic and streaming pages; client
navigation with state kept in layouts; back and forward; HMR; error and not-found boundaries;
`basePath`; i18n; node-server, Vercel and Cloudflare targets.

## Rollout

| Phase | Work                                                                                | Gate                                                        |
| ----- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0     | Config type, `true` = `"rsc"`, docs                                                 | Type and docs only                                          |
| 1     | Islands mode for React: server components by default, island manifest, static pages | Documents within 10% of normal builds; only islands hydrate |
| 2     | Context regions with DOM slots                                                      | Providers work; pixel-identical; state kept                 |
| 3     | Segment navigation, cache and prefetch                                              | Bytes per navigation below Next.js on the same pages        |
| 4     | Streaming with islands in late chunks                                               | First content no later than `"rsc"`                         |
| 5     | Actions with segment refresh                                                        | Parity with `"rsc"` action tests                            |
| 6     | Other renderers                                                                     | Shared renderer suite                                       |

## Prior work in Farm

- [RFC 0001](./0001-isolated-client-hydration.md): isolated client boundaries, the server proxy,
  island strategies.
- The server tree (`client/server-tree.ts`): server output as a tree of host elements and client
  references, with `<farm-server-html>` for parts it cannot represent.
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
