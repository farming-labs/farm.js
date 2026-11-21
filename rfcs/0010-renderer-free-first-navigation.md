# A first navigation that does not wait for the renderer

Status: Draft (islands mode, web).

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

A navigation that streams HTML no longer waits for the renderer. The router swaps the page in as
soon as its response arrives, and the renderer loads alongside to hydrate what the new page holds.

1. **The router stops importing the entry.** The generated web client of an islands app splits
   into the entry (`farm-client`: React, islx, hydration, tree renders) and a renderer-free core
   module the entry and the router both import (`farm-client-core`: base path and trailing-slash
   policy, chunk-error recovery, the route table and its matcher, history keys, the router
   stand-in, link interception). The router reaches the entry's functions through a cached
   `import()`, only on the paths that render or hydrate. Once the entry has loaded, that import
   resolves in a microtask.
2. **The streamed path renders first.** The router swaps the markup, reconciles the head, writes
   history, restores scroll and focus, and then waits for the entry to hydrate the new content's
   islands. Islands hydrate by their strategies, as on a first load.
3. **The boot sends the router ahead.** A held click on a link whose navigation streams (the boot
   already tells: it sends `F-Stream` unless the layout hydrates as one root) imports the core and
   the router and starts the navigation. The entry's download starts after the page request and
   the router's, so it does not compete with them for bandwidth. A click inside a root that
   hydrates whole (`F-Render: tree`) keeps today's order.

### Eligibility

Before it changes the DOM without the renderer, the router proves the navigation needs none. Any
other case loads the renderer first, as today:

- the response streams HTML (`F-Stream`), not a tree payload;
- no React root owns the swap target (`reactRootContainer` is unset);
- the app registers no client plugins (the build already emits `createPluginlessClientRuntime`
  for that case). A plugin can intercept navigations (`runFarmNavigationDelegates`), and its
  module may import the renderer, so an app with client plugins waits for the entry.

### Why the contract holds

Before the runtime runs, nothing on the page has hydrated: no blocker (`useBlocker`) is
registered, no component listens to navigation state, and no React root exists. The swap that
runs early is the one the router runs today; only what follows it moves later. Islands on the new
page hydrate when the renderer arrives, by their strategies, which is what a first load promises.

## Costs

- One more module on the intent path (`farm-client-core`). Its bytes move out of the entry, so the
  total stays the same within a chunk header; HTTP/2 fetches it beside the others.
- The router's render and hydration branches become async, awaiting the cached entry import.
- `splitFarmClientRouter` grows a second split. It is textual, like the first, and its output is
  covered by the generator tests.
- Islands on the new page cannot react to input until the renderer arrives. The boot's queued
  interactions (`replayFarmQueuedInteraction`) must cover them as they cover a first load's; the
  verification plan tests it.

## Alternatives

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

1. Generator: emit `farm-client-core` and import it from the entry and the router. No behavior
   change; generator tests cover the split, and the runtime-size report lists the chunks.
2. Router: reach the entry through the cached import; run the streamed path before it loads when
   the navigation is eligible.
3. Boot: import the core and the router for a held click on a streaming link; fetch the entry
   after them.
4. Development: the dev entry keeps today's order. It shares the router's semantics (render, then
   hydrate) but loads unbundled modules, where the order costs nothing worth the parity work.

## Verification plan

- A production browser test that holds the entry chunk's response until the new page's heading is
  in the document, for a held click on a streaming link: the page must render while React DOM is
  still pending, a click on one of its islands before then must apply once the chunk is released,
  and its islands must hydrate. The same test on a
  `F-Render: tree` link must wait for the chunk.
- The islands contract suites (`tests/e2e-server-components`), production and development.
- `first-navigation.mjs` before and after, interleaved: 150 ms with 1.6 Mbit/s and an 80 ms tap,
  and 50 ms with an instant tap, all sections. shop and guide must not get slower.
- Bytes per chunk before and after (`measure.mjs`): first-load JavaScript stays 2.2 KB, and the
  runtime's total stays within a chunk header of today's.

The expected effect is an estimate until then: at 1.6 Mbit/s a docs or blog tap would wait for the
router and the page (about 14 KB) instead of about 100 KB, which puts it near the `rsc` engine's
264 to 286 ms rather than 698 to 773 ms.
