# Server components payload

What a docs-shaped app sends with each `experimental.serverComponents` engine: the HTML document
and JavaScript of a first visit, and the data of a client navigation (RFC 0003).

```bash
pnpm --filter @farm.js/core build && pnpm --filter @farm.js/cli build && pnpm --filter @farm.js/plugin build
node benchmarks/server-components-payload/measure.mjs            # builds app/ in both modes
node benchmarks/server-components-payload/measure.mjs --skip-build --modes islands
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

2026-10-28, Apple M1, macOS 26.2, Node 24.21.0, Chrome 156. Averages; KB = 1024 bytes.

Two sections of the app:

- **docs**: a server layout whose client components are islands. Segment navigation applies.
- **shop**: a layout that hydrates as one root around a client cart provider; product pages pass
  a shared 150-product catalog to a client list that reads the cart. Pages rebuild from a server
  tree payload, and segments do not apply.

| Section | Engine | Document, br (raw) | First-load JS, br | Navigation, br (raw) |
| --- | --- | --- | --- | --- |
| docs | `rsc` | 16.2 KB (76.2 KB) | 108.8 KB | 12.0 KB (37.4 KB) |
| docs | `islands` | 16.0 KB (103.5 KB) | 81.3 KB | 2.5 KB (7.9 KB) |
| shop | `rsc` | 5.5 KB (33.0 KB) | 108.8 KB | 3.8 KB (13.2 KB) |
| shop | `islands` | 5.6 KB (31.4 KB) | 80.3 KB | 1.5 KB (3.6 KB) |

How the docs navigation got there (same build, earlier runs): 15.7 KB (100.9 KB raw) before
content-addressed values, 12.3 KB (38.4 KB) with values, 2.5 KB (7.9 KB) with segment navigation.

- Islands ships 26% less JavaScript. Both sections now carry the server-tree runtime, which the
  shop pages need (docs alone measured 78.2 KB).
- The documents compress to the same size. Islands sends the tree twice (once per island) where
  Flight sends it once, but brotli removes the repeat; the browser parses each value once.
- docs: a navigation names the values the browser holds (`x-farm-values`) and the layouts on
  screen (`X-Farm-Layout-Chain`, keyed by pattern and params); the server leaves both out. What
  travels is the article and its islands, about a fifth of RSC's payload.
- shop: the catalog travels once, and a navigation leaves it out. The browser rebuilds a shop
  page in the layout's React tree from its payload, so a navigation carries only that payload,
  not the page's HTML (`X-Farm-Tree-Navigation`): 5.8 KB with the HTML and every value, 4.2 KB
  without the held values, 1.5 KB without the HTML, against RSC's 3.8 KB.

`results/latest.json` has the per-page numbers of the last run.
