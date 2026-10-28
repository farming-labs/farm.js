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

2026-10-27, Apple M1, macOS 26.2, Node 24.21.0, Chrome 156. Averages; KB = 1024 bytes.

| Engine | Document, br (raw) | First-load JS, br | Navigation, br (raw) |
| --- | --- | --- | --- |
| `rsc` | 16.2 KB (76.2 KB) | 108.5 KB | 12.0 KB (37.4 KB) |
| `islands`, before content-addressed values | 15.8 KB (100.8 KB) | 77.2 KB | 15.7 KB (100.9 KB) |
| `islands`, values without segment navigation | 16.0 KB (103.5 KB) | 77.9 KB | 12.3 KB (38.4 KB) |
| `islands` | 16.0 KB (103.5 KB) | 78.2 KB | 2.5 KB (8.0 KB) |

- Islands ships 28% less JavaScript: no Flight client, and only the islands' code.
- The documents compress to the same size. Islands sends the tree twice (once per island) where
  Flight sends it once, but brotli removes the repeat; the browser parses each value once.
- Navigation in production fetches the next document. Content-addressed values took the tree out of
  it: the browser names the values it holds (`x-farm-values`) and the server leaves them out.
- Segment navigation took out the layout: the browser names the layouts on screen
  (`X-Farm-Layout-Chain`, keyed by pattern and params) and the server renders only the page and
  the layouts that changed. A navigation is then the article and its islands, about five times
  smaller than RSC's payload, which carries the layout's tree again.

## Ideas measured and not built

`what-if.mjs` simulates two RFC 0003 ideas on the HTML the islands build sends:

```bash
node benchmarks/server-components-payload/what-if.mjs
```

| Idea | Result |
| --- | --- |
| Island manifest: all islands' props in one script | 0 to +12 bytes per response after brotli. Brotli already removes the repeated script tags, and one script at the end of the body would hold back islands in streamed chunks. |
| Shared value files: values on 2+ pages as a cached `/_farm/v/<hash>.json` | First visit 16.0 KB to 23.0 KB (+43%), plus a request before islands hydrate. A later full load with the file cached: 16.0 KB to 12.6 KB (-21%). Break-even at 2 cached full loads per first visit. |

The value file loses because the values repeat text the HTML already has (the sidebar renders
the same titles and links): inside the document brotli stores the tree for about 3.5 KB, alone it
takes 10.4 KB. Client navigations already leave held values out, so cached full loads only come
from new tabs, reloads and return visits. A value file could still pay for a large value the
HTML does not render (a search index, chart data); nothing here measures one yet.

`results/latest.json` has the per-page numbers of the last run.
