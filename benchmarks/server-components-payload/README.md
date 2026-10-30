# Server components payload

What a docs-shaped app sends with each `experimental.serverComponents` engine: the HTML document
and JavaScript of a first visit, and the data of a client navigation (RFC 0003).

```bash
pnpm --filter @farm.js/core build && pnpm --filter @farm.js/cli build && pnpm --filter @farm.js/plugin build
node benchmarks/server-components-payload/measure.mjs            # builds app/ in both modes
node benchmarks/server-components-payload/measure.mjs --skip-build --modes islands
node benchmarks/server-components-payload/timing.mjs                 # uses the builds above
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

2026-10-30, Apple M1, macOS 26.2, Node 24.21.0, Chrome 156. Averages; KB = 1024 bytes.

Three sections of the app:

- **docs**: a server layout whose client components are islands. Segment navigation applies.
- **shop**: a layout that hydrates as one root around a client cart provider; product pages pass
  a shared 150-product catalog to a client list that reads the cart. Pages rebuild from a server
  tree payload, and segments do not apply.
- **blog**: long posts, mostly server-rendered prose and highlighted code (a span per token, about
  2,400 per post), with one small client component. The shape of most content sites.

### Bytes (`measure.mjs`)

| Section | Engine    | Document, br (raw) | First-load JS, br | Navigation, br (raw) |
| ------- | --------- | ------------------ | ----------------- | -------------------- |
| docs    | `rsc`     | 16.2 KB (76.2 KB)  | 109.1 KB          | 12.0 KB (37.4 KB)    |
| docs    | `islands` | 15.9 KB (69.7 KB)  | 84.5 KB           | 2.5 KB (7.2 KB)      |
| shop    | `rsc`     | 5.5 KB (33.0 KB)   | 109.1 KB          | 3.8 KB (13.2 KB)     |
| shop    | `islands` | 5.6 KB (31.2 KB)   | 83.5 KB           | 1.5 KB (3.4 KB)      |
| blog    | `rsc`     | 17.8 KB (379.3 KB) | 109.1 KB          | 10.8 KB (203.7 KB)   |
| blog    | `islands` | 8.9 KB (127.1 KB)  | 83.5 KB           | 8.9 KB (127.3 KB)    |

### Time (`timing.mjs`)

Medians. Chrome with 4x CPU throttling (roughly a mid-range phone); first load is the main thread
of a cold visit until the network and the thread go quiet; navigation is a click on "Next" until
the new heading shows. Server: 16 concurrent document requests for 5 s on one Node process.

| Section | Engine    | First load, main thread (script) | Navigation | Server req/s (p50) |
| ------- | --------- | -------------------------------- | ---------- | ------------------ |
| docs    | `rsc`     | 155 ms (63 ms)                   | 60 ms      | 373 (37.6 ms)      |
| docs    | `islands` | 170 ms (65 ms)                   | 61 ms      | 405 (38.0 ms)      |
| shop    | `rsc`     | 140 ms (63 ms)                   | 62 ms      | 545 (25.3 ms)      |
| shop    | `islands` | 151 ms (64 ms)                   | 80 ms      | 692 (21.1 ms)      |
| blog    | `rsc`     | 211 ms (91 ms)                   | 78 ms      | 50 (280.2 ms)      |
| blog    | `islands` | 160 ms (55 ms)                   | 110 ms     | 376 (41.6 ms)      |

- Islands ships 23% less JavaScript, and its navigations carry a fifth of RSC's data on docs pages.
- On a content page (blog) Flight sends every token twice, as HTML and as rows, and React hydrates
  all of it: islands sends half the document, runs 40% less script on a first load, and its server
  renders 7.5 times as many pages per second.
- Where islands is behind: applying a navigation's HTML in the browser (blog, shop) costs more than
  React rendering Flight rows, and docs and shop first loads run the Farm router on top of React.
- docs: a navigation names the values the browser holds (`F-Values`) and the layouts on screen
  (`F-Layouts`, keyed by pattern and params); the server leaves both out.
- shop: the catalog travels once, and a navigation leaves it out. The browser rebuilds a shop
  page in the layout's React tree from its payload, so a navigation carries only that payload,
  not the page's HTML (`F-Render: tree`).

`results/latest.json` has the per-page numbers of the last run.
