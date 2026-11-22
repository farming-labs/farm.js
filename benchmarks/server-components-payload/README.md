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
client entry loading React DOM lazily (RFC 0010). Averages; KB = 1024 bytes.

Four sections of the app:

- **docs**: a server layout whose client components are islands. Segment navigation applies.
- **shop**: a layout that hydrates as one root around a client cart provider; product pages pass
  a shared 150-product catalog to a client list that reads the cart. Pages rebuild from a server
  tree payload, and segments do not apply.
- **blog**: long posts, mostly server-rendered prose and highlighted code (a span per token, about
  2,400 per post), with one small client component. The shape of most content sites.
- **guide**: the blog's posts under a layout that hydrates as one root around a client theme
  provider, as many docs and blog themes do. In islands mode a post rebuilds from a server tree
  payload, whose static elements carry no copy of their HTML (`f-html`).

### Bytes (`measure.mjs`)

| Section | Engine    | Document, br (raw) | First-load JS, br | Navigation data, br (raw) | Navigation JS, br |
| ------- | --------- | ------------------ | ----------------- | ------------------------- | ----------------- |
| docs    | `rsc`     | 16.3 KB (76.4 KB)  | 71.0 KB           | 12.0 KB (37.5 KB)         | 0                 |
| docs    | `islands` | 16.1 KB (70.1 KB)  | 2.2 KB            | 2.7 KB (7.6 KB)           | 9.6 KB            |
| shop    | `rsc`     | 5.5 KB (33.2 KB)   | 71.0 KB           | 3.8 KB (13.2 KB)          | 0                 |
| shop    | `islands` | 5.9 KB (30.9 KB)   | 2.2 KB            | 2.0 KB (5.2 KB)           | 9.7 KB            |
| blog    | `rsc`     | 17.9 KB (379.5 KB) | 71.0 KB           | 10.8 KB (203.7 KB)        | 0                 |
| blog    | `islands` | 9.1 KB (127.6 KB)  | 2.2 KB            | 9.2 KB (127.7 KB)         | 9.6 KB            |
| guide   | `rsc`     | 18.0 KB (379.8 KB) | 71.0 KB           | 10.9 KB (203.9 KB)        | 0                 |
| guide   | `islands` | 9.5 KB (129.1 KB)  | 2.2 KB            | 9.5 KB (129.2 KB)         | 9.7 KB            |

An islands page whose client components only react to clicks starts with the boot entry (RFC 0003,
sections 10 and 11). The client runtime, about 95 KB, arrives with the first navigation or click;
"Navigation JS" spreads it over the ten navigations. Since RFC 0010 it comes in two parts: the
entry and router (about 27 KB), then React DOM and islx (about 69 KB), which a navigation that
streams its page does not wait for. That made it 2.3 KB larger: about 0.4 KB of code that loads
the renderer and holds clicks meanwhile, and the rest compression lost to three files instead of
one.

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

- A first load sends 2.2 KB of JavaScript instead of 71.0 KB, does about half the main-thread work
  and runs 3 to 5 ms of script instead of 67 to 91 ms: nothing on these pages hydrates at load.
- Navigations carry a fifth of RSC's data on docs pages and half on shop pages. On a
  content page (blog) Flight sends every token twice, as HTML and as rows: islands sends half the
  document, and its server renders 7.2 times as many pages per second.
- guide: the same posts under a hydrating layout still send half of RSC's document and navigation
  data, as a server tree leaves out its static HTML, and the server renders 3.4 times as many pages.
- After the first, navigations paint within a millisecond of RSC on docs and shop pages, 5 ms
  sooner on blog posts and 4 ms later on guide posts, within this machine's noise.
- From a server on the same machine, the first navigation is slower than RSC's: by 15 ms on docs,
  5 ms on blog, 36 ms on guide and 66 ms on shop. It loads what the first load left out, the
  client runtime (81.5 KB br, with React DOM) and the router. On shop and guide the click is also
  the layout's first React render, which RSC does during the first load. Over a network the
  picture changes; see below.
- A docs navigation request takes 0.58 ms on the server against 0.66 to 0.69 ms for RSC's `.rsc`
  request (medians of 1,495 requests alternating between the engines, `accept-encoding: identity`
  for both, so neither pays for compression), and returns 7.3 KB instead of 37.3 KB.
- docs: a navigation names the values the browser holds (`F-Values`) and the layouts on screen
  (`F-Layouts`, keyed by pattern and params); the server leaves both out.
- shop: the catalog travels once, and a navigation leaves it out. The browser rebuilds a shop
  page in the layout's React tree from its payload, so a navigation carries only that payload,
  not the page's HTML (`F-Render: tree`). That holds from the first navigation, before the
  layout has hydrated: the router creates the layout's root with the next page. A click made
  before the runtime runs is the exception: its request goes out with the click, before the
  browser holds the catalog, so that one response carries it again (the shop row's 2.0 KB).

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

Measured 2026-11-21 with the client entry loading React DOM lazily (RFC 0010), interleaved with a
build from before it, on a machine shared with other work (load average 8 to 55):

| Section | Engine    | 50 ms, hover | 50 ms, instant tap | 150 ms, hover | 150 ms, 80 ms tap | 150 ms at 1.6 Mbit/s, 80 ms tap |
| ------- | --------- | ------------ | ------------------ | ------------- | ----------------- | ------------------------------- |
| docs    | `rsc`     | 90           | 124                | 197           | 214               | 266                             |
| docs    | `islands` | 44           | 137                | 160           | 191               | 316                             |
| shop    | `rsc`     | 97           | 121                | 192           | 201               | 225                             |
| shop    | `islands` | 70           | 216                | 139           | 238               | 776                             |
| blog    | `rsc`     | 144          | 169                | 252           | 247               | 290                             |
| blog    | `islands` | 78           | 162                | 210           | 222               | 389                             |
| guide   | `rsc`     | 154          | 226                | 254           | 248               | 307                             |
| guide   | `islands` | 99           | 250                | 194           | 273               | 826                             |

- RSC fetches the page after the click. With a 100 ms hover, islands has started the runtime and
  the router and requested the page by then: a half to three quarters of RSC's time on a fast
  network, and 37 to 60 ms sooner with 150 ms of latency.
- A click made before the runtime runs is held by the boot entry, which requests the page with
  the click. Since RFC 0010 the router renders a page that streams in (docs, blog) before React DOM
  and islx arrive; they load beside it and hydrate its islands, which hold a click until then. A
  page under a layout that hydrates as one root (shop, guide) renders in the layout's React root,
  so it still waits for them.
- On a slow connection that decides it. At 1.6 Mbit/s a first tap on docs and blog took 715 and
  801 ms before RFC 0010 and takes 316 and 389 ms, against RSC's 266 and 290, whose first load
  already brought its 71.0 KB. On shop and guide it is still 776 and 826 ms (819 and 871 before).
- An instant tap on a fast network got 26 to 73 ms faster everywhere (from 163, 249, 213 and
  323 ms). docs is 13 ms behind RSC and blog ahead; shop and guide are 24 to 95 ms behind, as the
  click is also the layout's first React render, which RSC does during the first load.
- With 150 ms of latency and unlimited bandwidth an 80 ms tap is faster than RSC's on docs and
  blog and slower on shop and guide, about as before RFC 0010 (194, 241, 237 and 252 ms). guide
  measured 21 to 29 ms slower than before in two runs; a 15-round rerun of shop and guide alone put
  them at 246 to 240 and 269 to 255 ms, so that is within this machine's noise.

`results/latest.json` has the per-page numbers of the last run.
