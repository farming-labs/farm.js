# A first navigation that does not wait for the renderer

Status: Implemented (islands mode, web) in #3061. React joined the renderer it loads later, and
islands that wait for their triggers no longer load it (see Results).

## Problem

An islands page loads no client runtime: its boot script (2.2 KB br) loads the runtime when a link
or a waiting client component shows intent (RFC 0003, sections 10 and 11). A link click made before
the runtime runs is held, and the boot sends the page request with it (#3042, open). The page
renders once the runtime and the router have loaded and run.

The runtime is 81.6 KB br, and React DOM is two thirds of it. On
`benchmarks/server-components-payload`, islands build with source maps, brotli quality 5, each group
compressed alone:

| Part of `farm-client`        | br      |
| ---------------------------- | ------- |
| React DOM                    | 52.5 KB |
| islx                         | ~14 KB  |
| Farm's client runtime        | ~11 KB  |
| Generated entry              | 5.5 KB  |
| Router chunk (loaded beside) | 10.7 KB |

The router cannot run before React DOM has downloaded and evaluated, though a streamed navigation
never calls it. `farm-client-router` imports its shared bindings from `./farm-client-entry`
(`splitFarmClientRouter` in `packages/farm/src/nitro/universal-build.ts`), and the entry imports
`react-dom/client` statically, as do `@farm.js/islx/react` and islx's island chunk. A module runs
only after its static imports have.

What that costs a first tap, measured with `first-navigation.mjs` (added in #3042; HTTP/2, 4x CPU,
medians of 5 interleaved rounds, ms; Apple M1, macOS 26.2, Node 24.21.0, Chrome 157, 2026-11-21 on
#3042's branch):

| Section | Engine    | 50 ms latency, instant tap | 150 ms latency, 1.6 Mbit/s, 80 ms tap |
| ------- | --------- | -------------------------- | ------------------------------------- |
| docs    | `rsc`     | 113                        | 264                                   |
| docs    | `islands` | 146                        | 698                                   |
| blog    | `rsc`     | 148                        | 286                                   |
| blog    | `islands` | 181                        | 773                                   |

1.6 Mbit/s and 150 ms is Lighthouse's mobile profile. At that bandwidth everything the tap fetches
is the runtime (85,777 bytes on the wire), the router (11,002), React (3,129), the route table
(535) and the page, and the runtime alone takes over 400 ms to arrive. On an instant tap with
bandwidth to spare, a trace shows the runtime's evaluation (about 47 ms at 4x CPU) between the
response arriving and the router starting.

docs and blog are the sections whose navigations stream HTML (`F-Stream: flush`): the router swaps
the new page's markup into the document and then hydrates its islands. Only the hydration needs
React DOM.

## Prior behavior elsewhere

- **Astro**'s client router swaps documents without loading any island's framework; islands
  hydrate by their own directives afterwards.
- **Fresh** partials replace marked regions with server HTML from a small framework-free client.
- **Qwik** prefetches what a page may run while the browser is idle, which spends bytes on every
  visit instead.
- **Farm's `rsc` engine** loads React DOM and the Flight client with the first load (71.0 KB br),
  so its first navigation does not wait for them.

## Decision

A navigation that streams HTML no longer waits for the renderer. In an islands web build, the
client entry loads React, React DOM and islx with its first render or hydration instead of
importing them. The router still imports the entry, but the entry's own imports are now small, so
the router swaps the new page in as soon as its response arrives, and the renderer loads alongside
to hydrate what the page holds.

1. **The entry loads the renderer when it first needs it.** The generated entry
   (`generateClientHydrationEntry` in `packages/farm/src/nitro/universal-build.ts`) imports none of
   React, React DOM or islx. `loadFarmRenderer()` imports `react`, `react-dom/client` and
   `@farm.js/core/internal/islands-runtime` together, once, and sets `React`, `createRoot`,
   `hydrateRoot` and the islands runtime. Whatever renders or hydrates awaits it first: the first
   island that is due (item 2), a route that renders its page component or its hydrating layouts
   (`loadRouteComponent`, `createMatchedHydrationRoute`), and docs search. Once it has settled, an
   await costs a microtask. A chunk that fails to load is requested again on the next call.
2. **The streamed path renders first.** The router swaps the markup, reconciles the head, writes
   history and restores scroll as it does today, and hands the new page's islands to the islands
   runtime without waiting. Until islx loads, that runtime is a stand-in: `hydrate`, `dispose`
   and `endStream` wait for islx in the order they were called, and `carryOver` applies only to an
   island that has hydrated. A navigation that replaces the page before islx arrives disposes its
   islands in order. Islands hydrate by their strategies, as on a first load, and the stand-in
   loads islx with the first that is due, by the rules the boot follows (`watchFarmIslandTriggers`):
   at once for an island that hydrates at load, holds a click, or sits in a Suspense boundary the
   browser must finish, else on an island's idle, visible or interaction trigger, or on a press or
   focus in a form, which islx posts without a page load. A page whose islands all wait loads none
   of it, whether the entry ran for a link or a navigation brought the page.
3. **Islands keep a click.** The boot holds clicks on islands until the entry runs. From then
   until islx loads, the entry holds clicks and submits on islands that have not hydrated, in the
   same queue (`holdFarmIslandInteractions`), and each island's scheduler replays what it finds
   there, as it does for the boot's. If the renderer fails to load, the entry stops holding, and
   the page acts natively.
4. **The boot fetches the renderer when the start needs it at once.** The build lists the
   renderer's chunks in `client-module-preloads.json` (`renderer`, beside `entry` and `router`),
   and the boot script carries them as `data-farm-preload-renderer`. The boot preloads them with
   the entry when what started it renders or hydrates right away: an island's trigger, or a link
   in a layout that hydrates as one root (`F-Render: tree`). For a link whose page streams, it
   leaves them out, so the page request, the entry and the router get the bandwidth first, and the
   entry requests the renderer once it runs. A document that runs the entry at once (no boot)
   preloads them with the entry's imports.

### Eligibility

The entry loads the renderer lazily when the app:

- runs islands mode (`experimental.serverComponents: { mode: "islands" }`) on the web platform
  with the React renderer;
- has no client route slots. A slot renders with React DOM wherever a navigation shows it, so an
  app with slots keeps the static import.

Every other build keeps today's entry. Client plugins keep working: the entry still imports them
statically, so a plugin that imports React or React DOM brings it back into the entry's closure,
and that app keeps today's timing.

### Why the contract holds

Before the runtime runs, nothing on the page has hydrated: no blocker (`useBlocker`) is
registered, no component listens to navigation state, and no React root exists. The swap that runs
before React DOM is the one the router runs today; only the hydration after it moves later.
Islands on the new page hydrate when the renderer arrives, by their strategies, which is what a
first load promises, and a click on one in between is replayed.

## Costs

- The generated entry has a second shape beside the static one. The generator tests cover both,
  and the islands production browser tests run the lazy one.
- The entry's render and hydration paths await one promise.
- The preload manifest gains a list, and the boot script a third preload attribute.
- A streamed first navigation requests the renderer's chunks after the router's. Over HTTP/2 they
  share the connection; they no longer arrive before the page.
- Islands on the new page cannot react to input until the renderer arrives. Their clicks and
  submits are held and replayed; a keystroke or a toggle goes through natively, as before an
  island hydrates on a first load.

## Alternatives

- **Split the entry into a renderer-free core the router imports** (this RFC's first draft): a
  `farm-client-core` module for the route table, base path, history keys and link interception,
  with the router reaching the entry through a cached `import()`. It takes the same bytes off the
  tap's path, but needs a second textual split of the generated client and makes the router's
  render and hydration branches async. Loading the renderer inside the entry gives the router the
  same small closure with one loader and no new module.
- **Load the runtime when the browser is idle after load.** Small to build, but it breaks RFC
  0003's promise that a reader who never navigates or interacts loads no runtime, and it spends
  about 91 KB on every visit. Rejected.
- **Let a held click through as a document navigation.** Fetches the whole document again (16 KB
  br for docs instead of 2.6 KB), loses scroll positions and the boot's early request. Rejected.
- **Shrink the runtime.** islx and Farm's code are about 25 KB br of it; trimming them saves at
  most 50 to 100 ms of a 434 to 570 ms gap at 1.6 Mbit/s. Worth doing, does not close it.
- **V8 compile hints on the runtime chunks** (`//# allFunctionsCalledOnLoad`). Prototyped: 5 to
  39 ms faster on some taps, 14 to 23 ms slower on shop's 150 ms hover, no change to the headline.
  Parked.

## Implementation

- **Entry.** `generateClientHydrationEntry` emits `loadFarmRenderer()` and the islands runtime
  stand-in for an eligible build, and awaits the renderer on the paths that render or hydrate. The
  dynamic import names the islx exports it uses (`import(...).then(function({ ... }) { ... })`):
  passing the module object along whole kept every export of islx's runtime, 11 KB raw more than
  the static import kept.
- **Held interactions.** `holdFarmIslandInteractions` in `packages/farm/src/client/island-runtime.ts`
  holds clicks and submits on islands that have not hydrated, from the entry's start until islx
  has loaded.
- **Preloads.** `createFarmClientModulePreloadPlugin` resolves the renderer's specifiers as the
  build resolved them and writes the `renderer` list. The server puts it on the boot script, and the
  boot (`packages/farm/src/client/islands-boot.ts`) preloads it by what started it.

Development keeps today's entry: `farm dev` generates its own, which loads unbundled modules,
where the order costs nothing worth the parity work.

## Results

Measured 2026-11-21 with `first-navigation.mjs`, interleaved with a build from before the change
(HTTP/2, 4x CPU; Apple M1, macOS 26.2, Node 24.21.0, Chrome 157; load average 8 to 55 from other
work). Medians of 5 rounds in ms, `rsc` / before / after:

| Section | 150 ms latency at 1.6 Mbit/s, 80 ms tap | 50 ms latency, instant tap |
| ------- | --------------------------------------- | -------------------------- |
| docs    | 266 / 715 / 316                         | 124 / 163 / 137            |
| shop    | 225 / 819 / 776                         | 121 / 249 / 216            |
| blog    | 290 / 801 / 389                         | 169 / 213 / 162            |
| guide   | 307 / 871 / 826                         | 226 / 323 / 250            |

- docs and blog stream their pages, so React DOM left the tap's path: at 1.6 Mbit/s a first tap
  is 50 to 100 ms behind `rsc` instead of 450 to 510. What remains is the entry and the router
  (26.8 KB br) on top of the page.
- shop and guide render in the layout's React root, so they still wait for React DOM. Closing that
  gap needs React DOM before the tap (the idle preload rejected above) or a layout that renders
  without it.
- An instant tap got 26 to 73 ms faster on every section.
- With 150 ms of latency and unlimited bandwidth, a 100 ms hover and an 80 ms tap are unchanged
  within noise (9 rounds; a 15-round rerun of shop and guide taps alone: 246 to 240 ms and 269 to
  255 ms).
- Bytes: first-load JavaScript stays 2.2 KB br (the boot grows by 32 B). The router's static
  closure goes from 93.1 to 26.8 KB br. The runtime as a whole goes from 93.2 to 95.5 KB br: about
  0.4 KB of code, the rest compression lost to three files instead of one. A navigation's response
  leaves the renderer list out, so navigation data stays within 0.1 KB.

### React with the renderer

The entry first imported React itself, though nothing it runs before rendering uses React: 2.9 KB
br on every first tap's path. Since 2026-11-22 React loads with React DOM and islx. The files a
first tap waits for (the entry, the router, the route table and their chunks) go from 27.2 to
24.6 KB br. The runtime as a whole grows by 0.2 KB br, and each document by about 20 B, for the
boot's longer preload lists.

Measured with `first-navigation.mjs`, interleaved with `rsc` and `main` at f28cc9ce0 (load average
3 to 5). Medians of 9 rounds in ms, `rsc` / before / after, 150 ms latency at 1.6 Mbit/s, 80 ms
tap:

| Section | First tap       |
| ------- | --------------- |
| docs    | 263 / 312 / 300 |
| shop    | 217 / 333 / 321 |
| blog    | 291 / 375 / 361 |
| guide   | 298 / 381 / 360 |

- Every section's first tap at 1.6 Mbit/s is 12 to 21 ms faster, a quarter of the gap to `rsc` on
  guide and docs.
- At 50 ms latency an instant tap and a 100 ms hover are unchanged within noise (7 rounds; a
  21-round rerun of docs and shop taps: 116 to 116 ms and 131 to 128 ms).

### Islands that wait

The stand-in first loaded islx with any hydration, so the entry's own start loaded it on a page
whose islands all wait for a click, as did every navigation to one: about 71 KB br the visit never
ran, downloading alongside the page a second tap asks for. Since 2026-11-22 it loads with the
first island that is due. Measured with `measure.mjs` against `main` at f7ec6b9cb (ten navigations
after a cold visit, averaged; KB br):

| Section | JavaScript per navigation, before / after |
| ------- | ----------------------------------------- |
| docs    | 9.6 / 2.5                                 |
| blog    | 9.6 / 2.5                                 |
| shop    | 2.5 / 2.5                                 |
| guide   | 2.5 / 2.5                                 |

- A docs or blog visit that navigates ten times loads 27 KB of JavaScript instead of 98, against
  71 KB with `rsc`. Documents and navigation data are unchanged.
- A first tap does not change: at 1.6 Mbit/s the renderer started after the page had mostly
  arrived (9 interleaved rounds, `rsc` / before / after: docs 265 / 291 / 285 ms, shop 218 / 316 /
  313, blog 286 / 346 / 344, guide 284 / 351 / 354; load average 12 to 30).
