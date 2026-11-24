# Server components payload

What a docs-shaped app sends with each `experimental.serverComponents` engine: the HTML document
and JavaScript of a first visit, and the data of a client navigation (RFC 0003).

```bash
pnpm --filter @farm.js/core build && pnpm --filter @farm.js/cli build && pnpm --filter @farm.js/plugin build
node benchmarks/server-components-payload/measure.mjs            # builds app/ in both modes
node benchmarks/server-components-payload/measure.mjs --skip-build --modes islands
node benchmarks/server-components-payload/timing.mjs                 # uses the builds above
node benchmarks/server-components-payload/throughput.mjs             # uses the builds above
node benchmarks/server-components-payload/first-navigation.mjs --latency 150 --tap-hold 80
node benchmarks/server-components-payload/first-navigation.mjs --latency 150 --down 1600 --tap-hold 80
```

## The app

`app/` is one Farm app built once per engine (`FARM_SERVER_COMPONENTS_MODE`). It borrows the
contract example's installed packages (`examples/server-components`), linked by real path.

- `/docs/[slug]`: 300 pages under a docs layout.
- The layout passes a 300-entry navigation tree (32 KB of JSON) to two client components, a
  sidebar and a mobile menu, as most docs sites do.
- Each page is a server-rendered article (about 6.5 KB of HTML) with a client table of contents,
  five copy buttons, and a link to the next page.
- Text comes from a seeded generator over English-like syllables, so it compresses about as much
  as real prose. A small fixed vocabulary would compress five times better and flatter every row.

## Method

`measure.mjs` serves each production build (`node-server` preset) and drives Chrome:

- first load: a cold visit to five pages; the document and the JavaScript it loads;
- navigation: ten client navigations through the "Next" link from `/docs/p0`; everything fetched.

Bodies are measured decoded and compressed by the script with brotli quality 5, what servers use
on the fly, so both engines are compared on the same encoding. Every navigation is checked to stay
a client navigation, and page errors are counted.

## Results

2026-11-20, Apple M1, macOS 26.2, Node 24.21.0, Chrome 157. Times on `main` at 33b402362 (Farm
0.1.77, islx 0.0.25); bytes and first navigations over a network measured 2026-11-21 on `main` at
5e9dfcbd9 with the boot entry requesting a held click's page, and again later that day with the
client entry loading React DOM lazily (RFC 0010). Bytes and first navigations over a network
again on 2026-11-22, with a layout root that waits kept waiting through a navigation (RFC 0011),
and bytes once more that day, with a navigation before islx loads naming the values the page holds,
again with React loading beside React DOM, and again with React DOM and islx waiting for an island
that is due. Bytes and first navigations over a network again on 2026-11-23, with the boot entry
fetching the client entry and router once the page is idle, and again that day with a `Link`'s
page requested on its press. Averages; KB = 1024 bytes.

Four sections of the app:

- **docs**: a server layout whose client components are islands. Segment navigation applies.
- **shop**: a layout that hydrates as one root around a client cart provider; product pages pass
  a shared 150-product catalog to a client list that reads the cart. Once the layout has hydrated,
  pages rebuild from a server tree payload; segments do not apply.
- **blog**: long posts, mostly server-rendered prose and highlighted code (a span per token, about
  2,400 per post), with one small client component. The shape of most content sites.
- **guide**: the blog's posts under a layout that hydrates as one root around a client theme
  provider, as many docs and blog themes do. In islands mode a post rebuilds from a server tree
  payload, whose static elements carry no copy of their HTML (`f-html`).

### Bytes (`measure.mjs`)

| Section | Engine    | Document, br (raw) | First-load JS, br | Navigation data, br (raw) | Navigation JS, br |
| ------- | --------- | ------------------ | ----------------- | ------------------------- | ----------------- |
| docs    | `rsc`     | 16.3 KB (76.4 KB)  | 71.0 KB           | 12.0 KB (37.5 KB)         | 0                 |
| docs    | `islands` | 16.2 KB (70.1 KB)  | 27.6 KB           | 2.7 KB (7.6 KB)           | 0                 |
| shop    | `rsc`     | 5.5 KB (33.2 KB)   | 71.0 KB           | 3.8 KB (13.2 KB)          | 0                 |
| shop    | `islands` | 5.9 KB (31.0 KB)   | 27.6 KB           | 4.4 KB (20.0 KB)          | 0                 |
| blog    | `rsc`     | 17.9 KB (379.5 KB) | 71.0 KB           | 10.8 KB (203.7 KB)        | 0                 |
| blog    | `islands` | 9.1 KB (127.6 KB)  | 27.6 KB           | 9.2 KB (127.7 KB)         | 0                 |
| guide   | `rsc`     | 18.0 KB (379.8 KB) | 71.0 KB           | 10.9 KB (203.9 KB)        | 0                 |
| guide   | `islands` | 9.5 KB (129.2 KB)  | 27.6 KB           | 9.6 KB (129.4 KB)         | 0                 |

An islands page whose client components only react to clicks starts with the boot entry (RFC 0003,
sections 10 and 11), 2.4 KB. Once the page is idle the boot fetches the client entry and router,
25.3 KB, without running them, so "First-load JS" counts them and the navigations fetch no code.
Until 2026-11-23 they arrived with the first navigation or click, and "Navigation JS" spread them
over the ten navigations (2.5 KB each). The client runtime, about 95 KB, comes in two parts since
RFC 0010: the entry and router (about 25 KB), then React, React DOM and islx (about 71 KB), which a
navigation that swaps its page in does not wait for. That made it 2.5 KB larger: about 0.4 KB of
code that loads the renderer and holds clicks meanwhile, and the rest compression lost to four
files instead of one. In every section a visit loads only the entry and router: React, React DOM
and islx load with the first island that is due, and the islands of these pages wait for a click
(on shop and guide so does the layout's root, RFC 0011), so they never load. Until 2026-11-22 they
loaded with the entry on docs and blog, 9.6 KB per navigation, more in total than `rsc`'s 71 KB.

### Time (`timing.mjs`)

Medians. Chrome with 4x CPU throttling (roughly a mid-range phone). First load is the main thread
of a cold visit until the network and the thread go quiet. Navigation is measured in the page, from
the click on "Next" to the second animation frame after the new heading is in the DOM, so the new
page has painted: the median of ten in a row. First navigation is the first of those after a cold
visit, with the pointer resting on "Next" for 100 ms before the click, the median of nine visits.
It pays for whatever the first load deferred. Server (`throughput.mjs`): 16 concurrent document
requests for 5 s on one Node process, median and range of 8 rounds alternating between the
engines, so both see the same load. This run had other work on the machine (load average 11 to
20), so absolute numbers are low and the server ranges are wide.

| Section | Engine    | First load, main thread (script) | First navigation | Navigation | Server req/s (range) |
| ------- | --------- | -------------------------------- | ---------------- | ---------- | -------------------- |
| docs    | `rsc`     | 168 ms (67 ms)                   | 42 ms            | 44 ms      | 246 (216-399)        |
| docs    | `islands` | 87 ms (3 ms)                     | 57 ms            | 45 ms      | 256 (223-390)        |
| shop    | `rsc`     | 162 ms (67 ms)                   | 40 ms            | 43 ms      | 564 (403-697)        |
| shop    | `islands` | 80 ms (5 ms)                     | 106 ms           | 44 ms      | 701 (494-742)        |
| blog    | `rsc`     | 216 ms (91 ms)                   | 85 ms            | 76 ms      | 31 (15-59)           |
| blog    | `islands` | 106 ms (3 ms)                    | 90 ms            | 71 ms      | 224 (144-378)        |
| guide   | `rsc`     | 216 ms (89 ms)                   | 84 ms            | 73 ms      | 52 (34-57)           |
| guide   | `islands` | 105 ms (3 ms)                    | 120 ms           | 77 ms      | 176 (122-205)        |

- A first load runs 2.4 KB of JavaScript instead of 71.0 KB (it fetches 27.6 KB once the page is
  idle), does about half the main-thread work and runs 3 to 5 ms of script instead of 67 to 91 ms:
  nothing on these pages hydrates at load.
- Navigations carry a fifth of RSC's data on docs pages and half on shop pages. On a
  content page (blog) Flight sends every token twice, as HTML and as rows: islands sends half the
  document, and its server renders 7.2 times as many pages per second.
- guide: the same posts under a hydrating layout still send half of RSC's document and navigation
  data, as a server tree leaves out its static HTML, and the server renders 3.4 times as many pages.
- After the first, navigations paint within a millisecond of RSC on docs and shop pages, 5 ms
  sooner on blog posts and 4 ms later on guide posts, within this machine's noise.
- A navigation that swaps the whole page in (guide and shop, while their layout waits) parsed
  the response, took the page's markup back out and parsed it again in the document. Since it
  moves the parsed nodes in (2026-11-23), a guide navigation paints in 68 ms instead of 75, against
  RSC's 71 (`timing.mjs` with a build from just before, `main` at a2406339f), and in 66 ms instead
  of 72 over five more rounds of ten, where that build against a copy of itself differed by 1 ms.
  docs and blog swap a segment, which already moved its nodes; shop's pages are too small to show.
- From a server on the same machine, the first navigation is slower than RSC's: by 15 ms on docs,
  5 ms on blog, 36 ms on guide and 66 ms on shop. It loads what the first load left out, the
  client runtime (81.5 KB br, with React DOM) and the router. On shop and guide the click was also
  the layout's first React render, which RSC does during the first load. Since RFC 0011 it swaps
  the page in and the layout keeps waiting: in two later runs (2026-11-22, engines one after
  another, load average 5 to 18) the first navigation there took 13 to 34 ms less than just before
  it. Those runs moved every engine's numbers by up to a factor of two, so this table keeps the
  earlier one. Over a network the picture changes; see below.
- The preload budget used to scan every islands document for preload links: the boot script's
  `data-farm-preload` attributes hold the word `preload`, so the budget walked the whole document
  up to them. Since it stopped (2026-11-22), the server spends 13% less CPU per docs page, 25% less
  per blog post and 22% less per guide post. Server CPU time per document, 600 requests 8 at a
  time, medians of 10 rounds alternating with a build from just before (`main` at fe3388c0f): docs
  3.95 to 3.42 ms, shop 2.00 to 1.78, blog 5.27 to 3.97, guide 6.93 to 5.40. An A/A run of one
  build against itself differed by 4 to 9%, and by 13% on shop in an earlier run, so shop's change
  is within noise. The table above predates it.
- A docs navigation request takes 0.58 ms on the server against 0.66 to 0.69 ms for RSC's `.rsc`
  request (medians of 1,495 requests alternating between the engines, `accept-encoding: identity`
  for both, so neither pays for compression), and returns 7.3 KB instead of 37.3 KB.
- docs: a navigation names the values the browser holds (`F-Values`) and the layouts on screen
  (`F-Layouts`, keyed by pattern and params); the server leaves both out. Before islx loads, the
  values it names are the value scripts the page holds, which the router's swap keeps.
- shop: until the layout hydrates (an "Add" click, say), a navigation swaps the next page's HTML
  in and the layout keeps waiting (RFC 0011), so it carries the page's HTML as well as its tree.
  The catalog stays out: islx has not loaded, so a navigation names the value scripts the page
  holds, and the swap keeps the ones the next page leaves out. That is 4.4 KB per navigation (6.0
  KB while it named only what islx held, and 2.0 KB when it rendered the page in the layout's React
  root), three quarters of it the page's HTML, and 2.5 KB of JavaScript instead of 9.7, as React,
  React DOM, islx and the layout's modules no longer load on the first hover. Once the layout has
  hydrated, the browser rebuilds a page in its React tree from the payload alone (`F-Render: tree`)
  and the catalog stays out.

### First navigation over a network (`first-navigation.mjs`)

A server on the same machine answers at once, which hides the round trips a first navigation
waits for. `first-navigation.mjs` adds a fixed latency to every response and can limit the
download bandwidth (`Network.emulateNetworkConditions`), serves the builds over HTTP/2 through a
local TLS proxy, and throttles Chrome's CPU 4x. Each round visits every section cold, alternating
the engines' order, and either hovers "Next" for 100 ms and clicks, taps it at once, or taps it for
80 ms (a tap usually lasts 50 to 120 ms). The time runs from the click's own timestamp, when the
browser received the input, to the second frame after the new heading is in the document. Medians
of 5 rounds, of 9 for the two 150 ms columns without a bandwidth limit, in ms.

The proxy brotli-compresses a text response the server left uncompressed, as a CDN would. The
`rsc` engine's Node server sends its pages and Flight responses uncompressed until #3053 (`islands`
compresses them), which at 1.6 Mbit/s makes an RSC blog navigation take over a second.

Measured 2026-11-22 with a layout root that waits kept waiting through a navigation (RFC 0011),
interleaved with `rsc` and a build from just before it (`main` at df6c467af), on a machine shared
with other work (load average 7 to 71). The 150 ms, 80 ms tap column is a rerun at load 7 to 13:
the first run stopped on one visit that loaded a document mid-measurement, in an engine it did not
record, and 156 visits of reruns with per-visit logging, 48 of them at 12x CPU throttling, showed
none.

| Section | Engine            | 50 ms, hover | 50 ms, instant tap | 150 ms, hover | 150 ms, 80 ms tap | 150 ms at 1.6 Mbit/s, 80 ms tap |
| ------- | ----------------- | ------------ | ------------------ | ------------- | ----------------- | ------------------------------- |
| docs    | `rsc`             | 85           | 124                | 199           | 246               | 267                             |
| docs    | `islands`, before | 31           | 115                | 205           | 217               | 317                             |
| docs    | `islands`         | 38           | 121                | 193           | 211               | 316                             |
| shop    | `rsc`             | 87           | 111                | 197           | 247               | 223                             |
| shop    | `islands`, before | 60           | 203                | 190           | 241               | 788                             |
| shop    | `islands`         | 47           | 126                | 193           | 213               | 350                             |
| blog    | `rsc`             | 139          | 162                | 231           | 269               | 303                             |
| blog    | `islands`, before | 66           | 168                | 189           | 227               | 390                             |
| blog    | `islands`         | 67           | 165                | 221           | 218               | 379                             |
| guide   | `rsc`             | 134          | 158                | 232           | 273               | 306                             |
| guide   | `islands`, before | 97           | 221                | 197           | 251               | 837                             |
| guide   | `islands`         | 77           | 170                | 212           | 235               | 397                             |

- RSC fetches the page after the click. With a 100 ms hover, islands has started the runtime and
  the router and requested the page by then: about half of RSC's time on a fast network, and 4 to
  20 ms less with 150 ms of latency, a noisy column where single samples fell far below the rest.
- A click made before the runtime runs is held by the boot entry, which requests the page with
  the click. Since RFC 0010 the router renders a page that streams in (docs, blog) before React DOM
  and islx arrive; they load beside it and hydrate its islands, which hold a click until then.
  Since RFC 0011 a page under a layout that hydrates as one root (shop, guide) does the same while
  the layout has not hydrated: the router swaps the page in and the layout keeps waiting.
- On a slow connection that decides it. At 1.6 Mbit/s a first tap on shop and guide took 788 and
  837 ms and takes 350 and 397, against RSC's 223 and 306, whose first load already brought its
  71.0 KB. docs and blog are unchanged within noise, 49 and 76 ms behind RSC.
- An instant tap on a fast network got 77 and 51 ms faster on shop and guide, 15 and 12 ms behind
  RSC. docs and blog are within a few ms of RSC either way.
- With 150 ms of latency and unlimited bandwidth an 80 ms tap is now faster than RSC's in all four
  sections, by 34 to 51 ms; shop and guide gained 28 and 16 ms.

Measured again 2026-11-22 once React loaded with React DOM and islx instead of with the entry,
which takes 2.6 KB off the 27.2 KB a first tap waits for. Interleaved with `rsc` and a build from
just before it (`main` at f28cc9ce0), load average 3 to 5, medians of 9 rounds in ms:

| Section | `rsc` | `islands`, before | `islands` |
| ------- | ----- | ----------------- | --------- |
| docs    | 263   | 312               | 300       |
| shop    | 217   | 333               | 321       |
| blog    | 291   | 375               | 361       |
| guide   | 298   | 381               | 360       |

That is 150 ms at 1.6 Mbit/s with an 80 ms tap: 12 to 21 ms faster in every section. An instant
tap and a 100 ms hover at 50 ms latency are unchanged within noise (7 rounds; a 21-round rerun of
docs and shop taps: 116 to 116 ms and 131 to 128 ms).

Measured again 2026-11-22 once a `node-server` build sent client scripts and stylesheets with
brotli at top quality instead of gzip. The proxy passes a response the server compressed through
as it is, so this is what a browser receives from the Node server: the app's seven scripts over
1 KB went from 102.2 KB of gzip to 90.2 KB of brotli. Interleaved with `rsc` and a build from just
before it (`main` at a8ce675d6), load average 4 to 9, medians of 9 rounds in ms:

| Section | `rsc` | `islands`, before | `islands` |
| ------- | ----- | ----------------- | --------- |
| docs    | 261   | 297               | 277       |
| shop    | 216   | 321               | 304       |
| blog    | 290   | 352               | 331       |
| guide   | 291   | 355               | 336       |

That is 150 ms at 1.6 Mbit/s with an 80 ms tap: 17 to 21 ms faster in every section, where an A/A
run of one build against a copy of it differed by 6 ms at most (5 rounds). With 150 ms of latency
and no bandwidth limit the two builds are within 4 ms (5 rounds). The `rsc` build did not
compress its static files then, so the proxy brotli-compressed its scripts at quality 5, as a CDN
would; its Node server alone sent them uncompressed until #3097.

Measured again 2026-11-23 once the boot entry fetched the client entry and router, 25.3 KB, as soon
as the page was idle, without running them. Before, a first tap waited for them: they started
downloading on the touch, and at 1.6 Mbit/s took longer than the page, which arrived first in
every section. Interleaved with `rsc` and a build from just before it (`main` at a2406339f), load
average 3 to 4, medians of 9 rounds in ms:

| Section | `rsc` | `islands`, before | `islands` |
| ------- | ----- | ----------------- | --------- |
| docs    | 265   | 267               | 218       |
| shop    | 218   | 294               | 239       |
| blog    | 280   | 326               | 283       |
| guide   | 281   | 332               | 294       |

That is 150 ms at 1.6 Mbit/s with an 80 ms tap: 38 to 55 ms faster in every section, and faster
than `rsc` on docs. An instant tap with 50 ms of latency (5 rounds, an A/A copy of the build from
before within 7 ms of it) went from 113, 133, 158 and 165 ms to 111, 116, 139 and 145 (`rsc`: 112,
112, 164, 161). What it costs: 25.3 KB more on a first load that never navigates (a connection that
asks to save data skips it), and 4 ms more script on the first load's main thread at 4x CPU
throttling, Chrome compiling the fetched modules while the page is idle (`timing.mjs`, 3 runs).

Measured again 2026-11-23 once the boot entry requested a `Link`'s page on its press instead of its
click: a primary, unmodified press on a `Link` that prefetches (any but `prefetch="none"`). The
router takes that response at the click, as it took the click's. Interleaved with `rsc` and the
build from just before it, load average 4 to 5, medians of 9 rounds in ms for an 80 ms tap with
150 ms of latency:

| Section | `rsc`, 1.6 Mbit/s | `islands`, before | `islands` | `rsc`, unlimited | `islands`, before | `islands` |
| ------- | ----------------- | ----------------- | --------- | ---------------- | ----------------- | --------- |
| docs    | 265               | 228               | 119       | 199              | 215               | 102       |
| shop    | 217               | 241               | 139       | 198              | 208               | 109       |
| blog    | 281               | 283               | 180       | 232              | 236               | 137       |
| guide   | 282               | 292               | 189       | 237              | 243               | 139       |

The time runs from the click, and the request now leaves at the press, the tap's 80 ms before it.
It gains 99 to 113 ms, likely because the time starts when the browser receives the click, which
a page busy running the runtime the press started (at 4x CPU throttling) handles later, and the
click's request waited for that. `islands` is now faster than `rsc` in every section on both
networks, by 78 to 146 ms. An instant tap with 50 ms of latency (7 rounds), where the press and the
click come together, went from 111, 115, 134 and 144 ms to 95, 105, 131 and 135 (`rsc`: 114, 112,
156, 155). What it costs: 0.1 KB more boot entry (2.3 to
2.4 KB), and a page request for a press that does not end in a click, such as a scroll that starts
on a link. `Link`'s own prefetch sends that request on a touch too, once the runtime runs.

Measured again 2026-11-23 once a document stopped linking the client stylesheet when the app has
no CSS. This app has none, but every `islands` document linked the empty `farm-client.css`, and
the browser waited a round trip for it before its first paint. The `rsc` engine links no
stylesheet here. First contentful paint of a cold visit (`first-navigation.mjs --paint`), 150 ms
of latency, interleaved with `rsc`, the build from just before it, and an A/A copy of that build,
medians of 9 rounds in ms:

| Section | `rsc`, unlimited | `islands`, before | `islands` | `rsc`, 1.6 Mbit/s | `islands`, before | `islands` |
| ------- | ---------------- | ----------------- | --------- | ----------------- | ----------------- | --------- |
| docs    | 280              | 396               | 268       | 236               | 420               | 288       |
| shop    | 240              | 384               | 240       | 256               | 412               | 248       |
| blog    | 280              | 404               | 264       | 264               | 440               | 268       |
| guide   | 272              | 404               | 276       | 276               | 432               | 272       |

The first paint comes 128 to 172 ms sooner, and level with `rsc` or ahead of it except docs at
1.6 Mbit/s. The A/A copy was within 4 ms of the build before on the unlimited network (load average
8 to 10) and within 16 ms at 1.6 Mbit/s, which ran under a load average of up to 56. An app with
CSS links its stylesheet as before.

`results/latest.json` has the per-page numbers of the last run.
