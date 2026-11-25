# A smaller islands runtime for pages that hydrate at load

Status: Implemented (islands mode) in #3143, #3148, #3153, #3155, #3162 and #3166, released in
0.1.83 and 0.1.85 except #3166. islx's half of item 1 was not done. On the probe, islands now
hydrates before `rsc` at 1.6 Mbit/s and without a bandwidth limit (see Results).

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
4. **The route matcher loads with the route table.** At load, a page matches only its own path.
   The document names that path's route, params and layouts, which the server finds with the
   client's matcher and layout selection over the same tables. The matcher (`createFarmRouter`,
   pattern parsing and its checks, `isFarmRouteActive`) moves to the table's chunk, which the
   router loads before it matches another path.
5. **Reviving code loads with the first value that needs it.** islx 0.0.28 splits its React
   runtime by module: the code that revives slots, server trees, actions, promises, streams and
   tagged values loads with the first island, form state or action result that needs it (islx
   #89). Farm's islands runtime imports islx's server trees with a page's first one, and a
   document whose markup holds one preloads them with the renderer, as it does the action client.

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
- **Server trees.** A document that holds one preloads their code with the renderer, so its root
  hydrates as before. A navigation's response that holds one lists them with its modules. After a
  failed import, the next tree imports them again.

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

- **The other half.** Closed by items 6 and 7 rather than by bytes: islands still sends more
  script than `rsc` on the probe (68.5 KB against 66.9) and hydrates it first. Neither the server
  tree split nor islx's call-path split was worth an islx release; see "What is left" under
  Results.
- **The untraced task time.** Mostly closed by item 7. Traced at 150 ms latency without a
  bandwidth limit (4x CPU, medians of 9, after #3166), the main thread is busy for 221 ms before
  every island has hydrated, against 217 ms for `rsc` and 236 ms for the build before #3166 (A/A
  244). Islands spends less of it than `rsc` parsing and compiling, and more running script: 13 ms
  more in microtasks (19 against 6) and 8 ms more in function calls, not broken down further. The
  localhost `RunTask` self time was not measured again.
- **The probe is one page.** It is now the benchmark's `dash` section, measured by
  `hydration.mjs` (#3143), and every change was measured on it.

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

**Item 4 (#3153).**

What changed:

- The route table's chunk re-exports the matcher, and the entry no longer imports it.
- `getFarmClientBootRoutes` names the route's `params` and `layouts` as well. Until the table
  loads, `matchRoute` and `getApplicableLayouts` answer for the document's own path from them.
  Another path throws instead of matching against part of the table.

Measured against `main`, interleaved with an A/A copy of `main`, 150 ms latency, 4x CPU
throttling, medians of 21, in ms:

| Network                  | `rsc` | `main` | this change | A/A |
| ------------------------ | ----- | ------ | ----------- | --- |
| 1.6 Mbit/s, all hydrated | 777   | 819    | 814         | 823 |
| Unlimited, all hydrated  | 419   | 431    | 428         | 431 |

- **Bytes:** the entry went from 11.4 KB to 9.7 KB at brotli 11 (11,423 to 9,738 bytes). The
  table's chunk, which loads with the router, grew to 2.3 KB. Scripts on the wire went from
  78.2 KB to 76.6 KB.
- **Unlimited:** the 3 ms is within the A/A pair's spread.
- **First navigation:** at 150 ms latency and 1.6 Mbit/s, medians of 11, no section is slower than
  both `main` and its A/A copy after a tap. After a hover, guide is 162 ms against 161 and 152.
  At 50 ms latency and unlimited, medians of 15, guide after a hover is 63 ms against 62 and 62,
  so the matcher costs that navigation about 1 ms. It now parses and runs there instead of at
  boot.
- **A page that navigates** loads 440 bytes more over its first load and first navigation (the
  table's chunk went from 143 to 2,268 bytes). A page that doesn't navigate loads 1,685 fewer.
- **Remaining gap:** 37 ms at 1.6 Mbit/s, with islx 0.0.25 as `main` pins it.

**Item 5 (#3155).**

What changed:

- islx 0.0.28 (#89 and #91) loads its reviving code on demand. `main` has since moved to 0.0.30.
- The islands runtime imports islx's server trees from `internal/islands-server-tree` with a
  page's first one. The preload manifest lists that entry's chunks (`serverTrees`), and a
  document whose markup holds a `<script type="f/tree">` preloads them with the renderer.

Measured against `main`, interleaved with an A/A copy of `main`, 150 ms latency, 4x CPU
throttling, medians of 21, in ms:

| Network                  | `rsc` | `main` | this change | A/A |
| ------------------------ | ----- | ------ | ----------- | --- |
| 1.6 Mbit/s, all hydrated | 776   | 816    | 789         | 817 |
| Unlimited, all hydrated  | 414   | 422    | 423         | 424 |

- **Bytes on the probe:** scripts on the wire went from 76.6 KB to 69.6 KB (`rsc`: 66.9 KB). The
  islands runtime's chunk went from 13.1 KB to 4.9 KB at brotli 11, plus islx's element reviver
  (1.2 KB).
- **Unlimited:** within the A/A pair's spread.
- **Remaining gap:** 13 ms at 1.6 Mbit/s, down from 40.
- **After `main` moved to islx 0.0.30,** 41 rounds at 1.6 Mbit/s: `rsc` 778, `main` 814, this
  change 783, A/A 813. This change was faster than `main` in all 41 rounds, and the gap went from
  36 ms to 5. Unlimited, medians of 21: 418, 428, 429, 427. `main` still sends 76.5 KB of script:
  islx's split alone changes nothing while the islands runtime imports the server trees up front.
  First-load script on the other four sections is 26.6 KB in both builds.
- **The other four sections:**
  - First-load script went from 26.5 KB to 26.6 KB: the entry names one more chunk (33 bytes),
    and Rolldown's runtime gains the namespace helper islx's actions chunk needs (55 bytes).
  - Docs and blog hold no server tree; their renderer's islx code went from 13.1 KB to 6.1 KB.
  - Shop and guide hold server trees and preload them with the renderer: 14.0 KB, 842 bytes more
    than the one chunk before, from islx's split.
  - First navigation at 1.6 Mbit/s, medians of 11: no section is more than 1 ms slower than both
    `main` and its A/A copy, after a hover or a tap. The A/A pair differs by up to 4 ms.

**Item 6 (#3162): React in one chunk.** The probe's timeline (`hydration.mjs --timeline`, 1.6
Mbit/s, medians of 11) shows what the page waits for. Both engines request their scripts 173 ms in.
`rsc`'s main chunk, React and React DOM included, arrives at 678 ms, and the page has hydrated at 794. Islands' React DOM chunk arrives at 709 ms and the page has hydrated at 791: islands runs less
once its last script is in (82 ms against 116), but gets that script later. Chrome's throttling
shares the link among a page's requests, and islands made ten of them to `rsc`'s three, three for
React alone: React, its JSX runtime and React DOM. Taking 810 bytes off the entry (#3159) moved
neither React DOM's arrival nor the page.

What changed:

- In islands mode with React, the client build puts React, its JSX runtime, React DOM and the
  scheduler in one chunk, with a Rolldown `codeSplitting` group. They load together anyway: the
  entry imports React and React DOM when an island is due (RFC 0010), and island modules import
  React and its JSX runtime.
- When an entry imports any of them statically, as the mobile client's and an app's with client
  route slots do, the build keeps the bundler's split, since one chunk would load React DOM with
  every page. So does an app whose own Vite config splits chunks.

Measured against `main`, interleaved with an A/A copy of `main`, 150 ms latency, 4x CPU
throttling, all hydrated, in ms:

| Network                   | `rsc` | `main` | this change | A/A |
| ------------------------- | ----- | ------ | ----------- | --- |
| 1.6 Mbit/s, medians of 41 | 783   | 787    | 771         | 790 |
| Unlimited, medians of 21  | 425   | 433    | 432         | 432 |

- **1.6 Mbit/s:** paired by round, this change was faster than `main` in 34 of the 41 rounds, by a
  median of 15 ms (bootstrap 95% interval 12 to 21), and faster than `rsc` in 30, by 12 ms (7 to
  16). The A/A pair differs by 3 ms (-6 to 8).
- **Bytes:** the page loads eight scripts instead of ten, 68.5 KB of them instead of 69.6 KB: one
  chunk compresses better than three.
- **Unlimited:** within the A/A pair's spread. `rsc` is still 5 ms ahead (1 to 13).
- **The other four sections:** first-load script went from 26.6 KB to 26.5 KB; their documents and
  navigation data are unchanged. First navigation at 1.6 Mbit/s, medians of 11: after a tap, no
  section is more than 1 ms slower than both `main` and its A/A copy, and no section's cold visit
  paints later than both. After a hover, shop and blog measured 2 and 1 ms slower than both. Rerun
  with 21 rounds and paired with `main`, shop is -1 ms (-7 to 8) and blog +4 ms (-2 to 10), where
  blog's A/A pair alone is -1 ms (-8 to 14).
- **Remaining gap:** none at 1.6 Mbit/s; 5 ms without a bandwidth limit.

**Item 7: React compiled as it streams in.** Without a bandwidth limit the gap is main-thread time,
not network: both engines request every script about 162 ms in and have them all by about 320 ms
(resource timing, medians of 15 visits). A trace of the visit (Chrome tracing, medians of 9, wall clock
under 4x CPU throttling) has islands' main thread busy for 243 ms before the page has hydrated,
against `rsc`'s 208, and both spend close to 28 ms of it in V8's lazy compilation, which parses and
compiles each function on the main thread the first time it runs. Most of what hydration runs is
React DOM, and since item 6 it is a chunk that loads only when an island is due and runs as soon as
it arrives.

What changed:

- The React chunk starts with `//# allFunctionsCalledOnLoad`, V8's explicit compile hint: Chrome
  compiles every function of the script on a background thread while it streams in. Other engines
  ignore it as a comment.
- It goes in with Rolldown's `postBanner`, after minification, so it stays the chunk's first line and
  the chunk's source map accounts for it, and only where item 6's chunk exists. Every other chunk is
  unchanged: Rolldown adds a line after any `postBanner` string, an empty one too, so other chunks
  get none.

With the hint, the trace's main thread spends 19.2 ms parsing functions instead of 27.4, and
3.8 ms compiling bytecode instead of 11.5. Measured against `main`, interleaved with an A/A copy of
`main`, 150 ms latency, 4x CPU throttling, all hydrated, in ms:

| Network                   | `rsc` | `main` | this change | A/A |
| ------------------------- | ----- | ------ | ----------- | --- |
| 1.6 Mbit/s, medians of 41 | 797   | 789    | 773         | 789 |
| Unlimited, medians of 31  | 425   | 434    | 417         | 433 |

- **1.6 Mbit/s:** paired by round, this change was faster than `main` in 35 of the 41 rounds, by a
  median of 18 ms (bootstrap 95% interval 15 to 22), and faster than `rsc` in 37, by 25 ms (17 to
  30). The A/A pair differs by 2 ms (-7 to 3).
- **Unlimited:** faster than `main` in 27 of the 31 rounds, by 13 ms (9 to 23), and faster than
  `rsc` in 23, by 7 ms (6 to 12). The A/A pair differs by 1 ms (-6 to 8).
- **Bytes:** the hint is 29 bytes raw and nothing at brotli; the other four sections' documents,
  first-load script and navigation data are unchanged (`measure.mjs`).
- **The other four sections' first navigation,** 1.6 Mbit/s, paired by round with `main`: after a
  tap (21 rounds), every section is within 2 ms and every interval includes zero. After a 100 ms
  hover (11 rounds), only shop measured later than both `main` and its A/A copy, by 1 ms (paired -2
  ms, -32 to 3), and no section's cold visit painted later than both.
- **Remaining gap:** none on this page. Islands hydrates it first on both networks.
- **Cost:** Chrome also compiles the React functions hydration never runs, on a background thread,
  and keeps their bytecode. Measured after #3166 merged, without a bandwidth limit:
  - **Memory:** after a forced garbage collection, the page's JS heap is 2,899 KB with the hint
    against 2,756 KB for `main` and its A/A copy (medians of 21; every visit with the hint held
    at least 116 KB more than every visit without): 143 KB of bytecode. `rsc` holds 2,309 KB.
  - **Background work:** parsing and compiling on the page renderer's other threads went from
    7.1 ms per visit (A/A 6.0) to 12.5 ms (Chrome tracing, medians of 9). Chrome throttles only the
    main thread, so this ran at the M1's full speed; a slow phone's other cores take longer, which
    was not measured on a phone.

**What is left,** as measured before item 1. On the probe the whole difference was script: 81.4 KB
on the wire for islands against 69.7 KB, with documents within 0.4 KB. Measured with esbuild and
brotli 11: the server tree helpers on islx 0.0.25's published build, the call path on a split of
islx `main` (v0.0.27):

- **Server tree helpers:** `createServerTreeElement` and what only it reaches cost 235 bytes on
  0.0.25's one-chunk build. With 0.0.28's split, the server trees reach islx's reviving code, and
  loading them with the first one is item 5.
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
  Removing the update, the carry-over and the reviver outright saves 454 bytes, so loading them
  on use is not worth an islx release either.
