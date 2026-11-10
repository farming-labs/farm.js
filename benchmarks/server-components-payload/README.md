# Server components payload

What a docs-shaped app sends with each `experimental.serverComponents` engine: the HTML document
and JavaScript of a first visit, and the data of a client navigation (RFC 0003).

```bash
pnpm --filter @farm.js/core build && pnpm --filter @farm.js/cli build && pnpm --filter @farm.js/plugin build
node benchmarks/server-components-payload/measure.mjs            # builds app/ in both modes
node benchmarks/server-components-payload/measure.mjs --skip-build --modes islands
node benchmarks/server-components-payload/timing.mjs                 # uses the builds above
node benchmarks/server-components-payload/throughput.mjs             # uses the builds above
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

2026-11-08, Apple M1, macOS 26.2, Node 24.21.0, Chrome 156, on `main` at 55fb3580c. Averages; KB = 1024 bytes.

Three sections of the app:

- **docs**: a server layout whose client components are islands. Segment navigation applies.
- **shop**: a layout that hydrates as one root around a client cart provider; product pages pass
  a shared 150-product catalog to a client list that reads the cart. Pages rebuild from a server
  tree payload, and segments do not apply.
- **blog**: long posts, mostly server-rendered prose and highlighted code (a span per token, about
  2,400 per post), with one small client component. The shape of most content sites.

### Bytes (`measure.mjs`)

| Section | Engine    | Document, br (raw) | First-load JS, br | Navigation data, br (raw) | Navigation JS, br |
| ------- | --------- | ------------------ | ----------------- | ------------------------- | ----------------- |
| docs    | `rsc`     | 16.3 KB (76.2 KB)  | 69.9 KB           | 12.0 KB (37.4 KB)         | 0                 |
| docs    | `islands` | 15.9 KB (69.5 KB)  | 1.7 KB            | 2.5 KB (7.2 KB)           | 8.7 KB            |
| shop    | `rsc`     | 5.5 KB (33.1 KB)   | 69.9 KB           | 3.8 KB (13.2 KB)          | 0                 |
| shop    | `islands` | 5.7 KB (31.6 KB)   | 1.7 KB            | 2.0 KB (6.6 KB)           | 8.8 KB            |
| blog    | `rsc`     | 17.9 KB (379.4 KB) | 69.9 KB           | 10.8 KB (203.7 KB)        | 0                 |
| blog    | `islands` | 8.9 KB (127.0 KB)  | 1.7 KB            | 8.9 KB (127.3 KB)         | 8.7 KB            |

An islands page whose client components only react to clicks starts with the boot entry (RFC 0003,
sections 10 and 11). The client runtime, about 87 KB, arrives with the first navigation or click;
"Navigation JS" spreads it over the ten navigations.

### Time (`timing.mjs`)

Medians. Chrome with 4x CPU throttling (roughly a mid-range phone). First load is the main thread
of a cold visit until the network and the thread go quiet. Navigation is measured in the page, from
the click on "Next" to the second animation frame after the new heading is in the DOM, so the new
page has painted. Server (`throughput.mjs`): 16 concurrent document requests for 5 s on one Node
process, median and range of 8 rounds alternating between the engines, so both see the same load.
This run had other work on the machine (load average 5 to 9), so absolute numbers are a little low.

| Section | Engine    | First load, main thread (script) | Navigation | Server req/s (range) |
| ------- | --------- | -------------------------------- | ---------- | -------------------- |
| docs    | `rsc`     | 163 ms (65 ms)                   | 44 ms      | 434 (390-455)        |
| docs    | `islands` | 86 ms (4 ms)                     | 46 ms      | 458 (342-500)        |
| shop    | `rsc`     | 143 ms (64 ms)                   | 46 ms      | 682 (638-693)        |
| shop    | `islands` | 74 ms (4 ms)                     | 50 ms      | 769 (614-802)        |
| blog    | `rsc`     | 216 ms (92 ms)                   | 71 ms      | 48 (30-55)           |
| blog    | `islands` | 99 ms (4 ms)                     | 69 ms      | 349 (133-417)        |

- A first load sends 1.7 KB of JavaScript instead of 69.9 KB, does about half the main-thread work
  and runs 4 ms of script instead of 64 to 92 ms: nothing on these pages hydrates at load.
- Navigations carry a fifth of RSC's data on docs pages and half of it on shop pages. On a content
  page (blog) Flight sends every token twice, as HTML and as rows: islands sends half the document,
  and its server renders 7.3 times as many pages per second.
- Where islands is behind: shop navigations paint 4 ms later. The page is rebuilt from its payload
  in the layout's React root, then the router finishes its own work before the frame. Docs and blog
  navigations tie.
- docs: a navigation names the values the browser holds (`F-Values`) and the layouts on screen
  (`F-Layouts`, keyed by pattern and params); the server leaves both out.
- shop: the catalog travels once, and a navigation leaves it out. The browser rebuilds a shop
  page in the layout's React tree from its payload, so a navigation carries only that payload,
  not the page's HTML (`F-Render: tree`).

`results/latest.json` has the per-page numbers of the last run.
