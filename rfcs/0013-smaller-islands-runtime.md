# A smaller islands runtime for pages that hydrate at load

Status: Draft (islands mode). No code yet.

## Problem

Islands mode loads less than the `rsc` engine wherever a page's islands wait. On the payload
benchmark's four sections, a cold load runs 7 to 8 ms of script against `rsc`'s 59 to 88 ms, and
the first navigation lands 6 to 23 ms sooner (`timing.mjs` on 17605bd07, localhost, 4x CPU):

| Section | Engine    | Main thread (ms) | Script (ms) | First navigation (ms) |
| ------- | --------- | ---------------- | ----------- | --------------------- |
| docs    | `rsc`     | 151              | 59          | 41                    |
| docs    | `islands` | 96               | 7           | 27                    |
| shop    | `rsc`     | 139              | 61          | 42                    |
| shop    | `islands` | 77               | 8           | 36                    |
| blog    | `rsc`     | 208              | 87          | 84                    |
| blog    | `islands` | 112              | 7           | 61                    |
| guide   | `rsc`     | 205              | 88          | 85                    |
| guide   | `islands` | 103              | 7           | 62                    |

It loses when every island on a page hydrates at load. Then both engines need React DOM at once,
and what islands loads beside it is larger than what `rsc` loads beside it.

The probe is a page of 24 client components with strategy `load`. Each renders a heading, a list
of 20 values and a button whose label an effect changes once it has hydrated. Its document is
2.9 KB br in islands mode and 2.4 KB in `rsc`. The JavaScript it loads, at brotli quality 11:

| Part                                | `rsc`                | `islands`                                                        |
| ----------------------------------- | -------------------- | ---------------------------------------------------------------- |
| React DOM, React, scheduler         | about 49.9 KB        | 51.6 KB                                                          |
| Everything else (the engine's code) | about 16.7 KB        | 30.0 KB                                                          |
| Total                               | 66.6 KB in 3 modules | 81.6 KB in 8 modules                                             |
| Where the engine's code lives       | `index`, `entry-rsc` | the entry (13.2 KB), the islands runtime (15.4 KB), small chunks |

`rsc` bundles React with its own code, so its React share is estimated from a source-mapped build
by removing React's bytes and compressing the rest. islands ships React DOM as its own chunk,
which compresses a little worse.

The time until all 24 widgets have hydrated, and the first contentful paint, with every script
served at brotli 11 through an HTTP/2 proxy that adds 150 ms of latency (Apple M1, macOS 26.2,
Node 24.21.0, Chrome 157, 4x CPU, interleaved, medians of 7 or 9, 2026-11-23, load average 4 to
14; a range spans the two runs of a configuration that ran twice):

| Network    | Engine                                | All hydrated (ms) | First paint (ms) |
| ---------- | ------------------------------------- | ----------------- | ---------------- |
| 1.6 Mbit/s | `rsc`                                 | 787 to 794        | 248 to 256       |
| 1.6 Mbit/s | `islands`                             | 868               | 388              |
| 1.6 Mbit/s | `islands` without the stylesheet link | 847 to 851        | 228 to 252       |
| unlimited  | `rsc`                                 | 432 to 438        | 236 to 248       |
| unlimited  | `islands`                             | 500 to 501        | 376 to 388       |
| unlimited  | `islands` without the stylesheet link | 435 to 471        | 244 to 260       |

Two costs show here, and only the second is this RFC's.

1. **An empty stylesheet blocks the first paint.** The benchmark app has no CSS. Farm writes an
   empty `farm-client.css` so its documents' link does not 404 (`validateClientBuildOutput`), and
   every islands document links it. The link blocks rendering and the module scripts behind it,
   so a style-free page waits one round trip for 0 bytes: 130 to 160 ms of first paint and 20 to
   65 ms of hydration above. `rsc` emits no link. An app with CSS pays for the request in both
   engines. The fix is to leave out the link when the file is empty, in its own change. The
   benchmark's published figures were measured on localhost or from a click, so none of them
   change.
2. **islands loads 15 KB more JavaScript, 13 KB of it the engine's code.** Without the link,
   islands hydrates the page 53 to 64 ms after `rsc` at 1.6 Mbit/s. 15 KB takes 75 ms at
   200 KB/s, and part of it overlaps the page's other work. With bandwidth to spare, the two are
   within noise of each other (3 to 33 ms).

The benchmark's own servers hide part of the second cost: `rsc`'s Node server sends its scripts
as gzip (about 77 KB), and islands sends brotli 11. Served that way, the gap at 1.6 Mbit/s is
21 ms. A CDN that sends brotli to both shows the numbers above.

The main thread differs less than the bytes. On localhost with 4x CPU (5 traces), the load task
is 146 ms for `rsc` and 155 to 159 ms for islands. islands evaluates less module code (5.5 ms of
`v8.evaluateModule` against 34.3 ms) but spends more time in tasks the trace does not break down
(61.6 ms of `RunTask` self time against 25.5 ms).

## Where islands' engine code goes

Minified bytes by source, from a source-mapped islands build of the benchmark app on 17605bd07.

The entry (42.6 KB raw, 13.2 KB br):

| Source                                                               | Raw     |
| -------------------------------------------------------------------- | ------- |
| The generated entry (`generateClientHydrationEntry`)                 | 17.6 KB |
| Client runtime: plugins, hydration sessions, link prefetch, triggers | 7.3 KB  |
| Chunk recovery                                                       | 2.5 KB  |
| Router helpers, route matcher, route specificity                     | 6.1 KB  |
| Page position, base path, route announcer, document head, other      | 5.6 KB  |
| Not mapped to a source (bundler glue)                                | 3.5 KB  |

The islands runtime (51.3 KB raw, 15.4 KB br):

| Source                                                                       | Raw     |
| ---------------------------------------------------------------------------- | ------- |
| islx `react/client`: hydration runtime, slots, streamed props, server trees  | 13.6 KB |
| islx island chunk                                                            | 9.3 KB  |
| islx codec: props decoding, and encoding for calls                           | 7.4 KB  |
| islx actions: value store, client hooks, call transport, references          | 7.3 KB  |
| islx wire and forms                                                          | 1.7 KB  |
| Farm's query cache (`client-cache.ts`), through the action interceptor       | 6.8 KB  |
| Farm's server query runtime, action client, cache invalidation, runtime glue | 3.9 KB  |

A page whose islands hydrate at load runs part of this. The entry starts the client runtime,
reads the route table, matches the route, revives the page's payload and hydrates the islands
(`hydrate()` in the generated entry). It does not hydrate a page or layout root
(`scheduleFarmRouteHydration`, `createMatchedHydrationRoute` and the tree layout helpers), render
a route slot, or call a server action unless the page does. Those paths load with the page today
because the entry and the islands runtime import them statically:

- `createFarmIsolatedHydrationRuntime` (`packages/farm/src/client/islands-runtime.ts`) registers
  `farmIslandsActionInterceptor`, which imports the server query runtime and, through it, the
  query cache.
- islx's `react/client` and island chunk import its actions chunk for the value store, the client
  hooks (`emit`) and `createServerReference`, and the chunk carries the call transport with them.
- The generated entry holds root hydration and route slots for every route, and exports them to
  the router chunk.

## Decision

Take the paths a page does not run off its load. No configuration and no public API change.

1. **The call path loads when a page can call.** Farm registers a small interceptor that imports
   the action client, the server query runtime and the query cache on the first call.
   `beginFarmServerQueryAction` reads the server query making a call synchronously; a query on the
   page imports that runtime itself, so the stand-in calls it synchronously when it has loaded,
   and finds no query when it has not. islx splits its actions chunk the same way: the value
   store, client hooks and `createServerReference` stay, and a reference imports the transport and
   the codec's encoder on its first call. `enhanceForms` keeps its submit listener and loads the
   transport on a submit.
2. **A page that holds a reference preloads the call path.** The server knows when it renders
   one: an action in an island's props (`{"$":"a",...}`) or a form that posts an action. Such a
   document lists the call path's chunks with its other modulepreloads, so its first call waits
   on no extra round trip. A reference that arrives later, in a navigation or an action's result,
   starts the import when it is decoded.
3. **Root hydration loads with the routes that hydrate a root.** Page and layout root hydration
   and route slots move from the generated entry to a chunk that the entry imports when the
   matched route hydrates a page or a layout, or has a slot, and that the router imports for a
   navigation to such a route. The renderer's chunks already load at that moment (RFC 0010), so
   the new chunk joins them.

Estimated savings on the probe, at brotli 11, from removing the mapped bytes of a built bundle and
compressing the rest:

| Change                                      | Package    | Saved            |
| ------------------------------------------- | ---------- | ---------------- |
| Call path on the first call (items 1 and 2) | core, islx | up to 4.5 KB     |
| Root hydration out of the entry (item 3)    | core       | about 2.1 KB     |
| Route slots out of the entry (item 3)       | core       | about 0.4 KB     |
| Total                                       |            | about 7 KB of 15 |

That closes about half the gap, roughly 35 ms at 1.6 Mbit/s. This RFC does not claim parity
from these changes alone; see Open questions.

### Why the contract holds

- **Calls.** A call before the transport arrives waits for it and keeps its order: references
  chain on one import. Results, invalidations, query cache entries and declared failures go
  through the same interceptor as today, which only loads later.
- **Server queries.** A page with a server query loads the query runtime with the query's module,
  so the interceptor sees the query that made a call, as today.
- **Forms.** A server-component form submitted before the runtime runs posts natively, as today.
  After that, the listener holds the submit until the transport has loaded.
- **Roots.** A route that hydrates a page or a layout loads root hydration with the renderer,
  before anything renders. A route of islands only never calls it.

## Costs

- A page that holds no reference and calls an action later, after a navigation, waits for the
  call path on that first call: one round trip if it is not cached.
- The generated entry gains a dynamic import and the router a third import, and the preload
  manifest a list for the call path.
- islx's chunk layout changes. Its tests cover the transport, and Farm's islands e2e suites cover
  calls, forms, server queries and invalidation end to end.

## Alternatives

- **Raise the modulepreloads' priority.** They are `fetchpriority="low"` (#2292, so they do not
  push CSS and fonts back). Measured on the probe with the attribute removed: 860 ms against 851,
  within noise. Not proposed.
- **Fewer, larger modules.** #2292 grouped the entry's imports into fewer chunks; it needed
  `strictExecutionOrder` and hydrated slower than preloads alone. Over HTTP/2 the eight requests
  share one connection. Not proposed.
- **Load the call path when the browser is idle.** Spends the bytes on every visit, including
  pages with no action, and still competes with hydration on a slow link. Rejected.
- **Hydrate at load later.** Changes what `load` means. Authors who want less at load already pick
  `idle`, `visible` or `interaction`. Rejected.

## Open questions

- **The other half.** Measured: neither the server tree split nor islx's call-path split is worth
  an islx release. See "What is left" under Results.
- **The untraced task time.** islands spends 36 ms more in `RunTask` self time on localhost. It
  may be the cost of instantiating eight modules instead of three; that is not verified.
- **The probe is one page.** The verification plan below adds it to the benchmark, so the
  numbers above can be reproduced and every change measured on it.

## Verification plan

- Add a `dash` section to `benchmarks/server-components-payload`: the probe page, built by both
  engines.
- Add a hydration measure to the benchmark: the time until every island on the page has hydrated
  and the first contentful paint, over the HTTP/2 proxy `first-navigation.mjs` uses, with an option
  to serve every script at brotli 11 so both engines are compressed alike.
- Each change above lands as its own pull request with before and after numbers on the `dash`
  section, at 150 ms latency, unlimited and at 1.6 Mbit/s, interleaved with an A/A run of the
  build before.
- No change may regress the other four sections' first load, first navigation or bytes, or the
  islands contract e2e suites in production and in `farm dev`.

## Results

**Item 1, and Farm's half of item 2 (#3143).**

What changed:

- Islands mode registers a stub interceptor that takes the server query making a call and sends
  the call. It imports the action client, the server query runtime and the query cache on the
  first call.
- A document whose markup holds an action reference (`"$":"a"`, or a server form's `$F_REF_`
  field) lists them with its other modules.
- A client module's server function reference starts the import when it is created.
- islx's half (the transport and the codec's encoder) is dropped: it saves 370 bytes. See "What
  is left" below.

Measured on the probe (`hydration.mjs`, added to the benchmark with the `dash` section), 150 ms
latency, 4x CPU throttling, interleaved, medians of 11 rounds in ms:

| Network                | `rsc` | `islands`, before | `islands` |
| ---------------------- | ----- | ----------------- | --------- |
| 1.6 Mbit/s             | 801   | 876               | 860       |
| 1.6 Mbit/s, second run |       | 891               | 864       |
| Unlimited              | 457   | 540               | 529       |

- **Control:** an A/A copy of the build before had the same median in the second run.
- **Unlimited:** the 11 ms is within that run's spread.
- **Bytes:** the islands runtime chunk went from 15.4 KB to 13.1 KB at brotli 11, close to the
  2.3 KB estimated above. Scripts on the wire went from 82.3 KB to 80.0 KB.
- **Other sections:** unchanged in bytes and page errors (`measure.mjs`); their pages load the
  runtime only on an interaction.
- **Remaining gap:** 59 ms to `rsc` at 1.6 Mbit/s.

**Item 3 (#3148).**

What changed:

- Page and layout root rendering moves from the generated entry to a `farm-client-root` chunk. The
  entry imports it when a route's root hydration is due, and the router imports it for a
  navigation to a route that hydrates its page or a layout.
- The preload manifest lists that chunk, and a document that hydrates a root preloads it. A route
  of islands only never requests it.

Measured against `main`, interleaved with an A/A copy of `main`, 150 ms latency, 4x CPU
throttling:

- **Bytes:** the entry went from 13.2 KB to 11.4 KB at brotli 11, and the root chunk is 2.5 KB.
  First-load script on the other four sections went from 27.8 KB to 26.0 KB.
- **Probe at 1.6 Mbit/s,** medians of 21: 876 ms before, 864 after, 876 for the A/A copy.
- **First navigation,** medians of 7, in ms. No section is slower than both `main` and its A/A
  copy:

| Section | `main` | #3148 | A/A |
| ------- | ------ | ----- | --- |
| docs    | 76     | 78    | 79  |
| shop    | 105    | 95    | 107 |
| blog    | 155    | 150   | 165 |
| guide   | 154    | 151   | 152 |

**The three together.** #3136 (no stylesheet link when the client CSS is empty), #3143 and #3148
merged on `main` locally, interleaved with an A/A copy of `main`, medians of 21, in ms:

| Network                  | `rsc` | `islands`, before | `islands`, after | A/A |
| ------------------------ | ----- | ----------------- | ---------------- | --- |
| 1.6 Mbit/s, all hydrated | 809   | 885               | 856              | 899 |
| 1.6 Mbit/s, first paint  | 264   | 408               | 260              | 416 |
| Unlimited, all hydrated  | 483   | 578               | 506              | 563 |
| Unlimited, first paint   | 276   | 420               | 284              | 416 |

- **Scripts on the wire:** 66.9 KB for `rsc`, 82.3 KB before, 78.2 KB after.
- **First paint** does not move with #3148 alone (392 ms before, 396 after). The change comes
  from #3136 and #3143, which this run does not measure apart.
- **Remaining gap:** 47 ms at 1.6 Mbit/s, down from 76. Unlimited, 23 ms, down from 95; the A/A
  pair differed by 15 there.

**What is left.** On the probe the whole difference is script: 81.4 KB on the wire for islands
against 69.7 KB, with documents within 0.4 KB. Measured with esbuild and brotli 11: the server
tree helpers on islx 0.0.25's published build, the call path on a split of islx `main` (v0.0.27):

- **Server tree helpers:** `createServerTreeElement` and what only it reaches cost 235 bytes. A
  split is not worth it.
- **islx's call path:** moving the transport, the revival of returned elements and the codec's
  `encode` to a module the first call imports takes 370 bytes off the first load. The decoding
  they share stays, and the split adds a chunk.
- **Engine code besides React and the page's components:** 25.2 KB for islands (the entry 11.5 KB,
  the islands runtime 13.2 KB, the Rolldown runtime 0.5 KB). For `rsc`, its entry is 7.6 KB and
  its runtime 0.5 KB, and about 5.8 KB of its main chunk is the Flight client and its glue. That
  last figure is by difference: it assumes React, React DOM and the components cost `rsc` what
  they cost islands (53.0 KB).
- **The largest piece left** is islx's hydration runtime (`src/react/hydrate.ts`, 1,039 source
  lines). Every page receives its hot module `update`, the `carryOver` of island state across
  navigations, streamed props (`islandPromise`) and the reviver for elements an action returns.
  Loading those on use is islx work and needs an islx release. Its size is not measured.
