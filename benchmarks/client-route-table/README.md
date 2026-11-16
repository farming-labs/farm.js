# Client route table benchmark

This benchmark measures what the production client's route table costs a page: the size of the
client entry every page loads before it hydrates, the time from a cold page load to hydration, and
the latency of the first client navigation, at several route counts.

The production client used to keep its whole route table in the hashed client entry, about 147
bytes a route: 282 KB of entry at 100 routes and 414 KB at 1,000 on the `dev-scale` docs app. Every
first visit, and every deploy that changed any route, downloaded and parsed all of it. The table is
now its own chunk, which the entry imports on the first prefetch or navigation, and each document
names the table entries its own page boots with.

## Fixture

The docs workspace from [`dev-scale`](../dev-scale/README.md), built with
`farm build --preset node-server`: 80% of the routes are MDX docs pages and 20% are TSX guides
(`--routes 100` builds 80 docs pages, 20 guides and the home page). `--modes` builds it in islands
mode, classic mode (no server components), or both. Each checkout builds its own copy, linked to
its own `@farm.js/core` and `@farm.js/cli`.

## Metrics

For each mode, route count and checkout:

- **Entry size:** the hashed client entry (`farm-client-h<hash>.js`), raw, gzip (level 9) and
  brotli, and the route table chunk (`chunks/farm-client-routes-h<hash>.js`) when the build has one.
- **Hydrated:** a new browser context with the cache disabled loads `/guides/page-3`; the time from
  navigation start until React has attached its props to the page's `PlatformBadge` button.
  `bootJsTransfer` is the JavaScript the page downloaded by then (encoded bytes), and
  `tableFetchedAtLoad` whether loading the page fetched the route table.
- **First navigation:** right after hydration, a sidebar link (a plain `<a>`, so nothing prefetches
  it) to `/guides/page-4` is clicked with no pointer before it, the worst case for a table that loads
  on the first navigation; the time until that page has hydrated. `secondNavigationMs` is the next
  navigation, to `/guides/page-6`. Back and forward must stay in the same document.
- **First navigation after hover:** a new context loads the page again, rests the pointer on the
  link for 100 ms, then clicks it, as a person does.

Every navigation must stay in the same document, and a console error about hydration, a missing
provider or the route table fails the run. Each round runs every checkout once, rotating which
goes first, and the report gives medians and every sample. The `desktop` profile (default) is
Lighthouse's: 40 ms round trip, 10 Mbps, no CPU slowdown; `mobile` is 150 ms, 1.6 Mbps down and a 4x
CPU slowdown. Compare runs from the same machine only.

## Run

Build `@farm.js/core` and `@farm.js/cli` in each checkout first, then:

```sh
node benchmarks/client-route-table/run.mjs \
  --farm base=../farm-main --farm change=. --routes 100,1000 --samples 7 --out report.json
```

Pass one path under two labels for an A/A control. Options: `--routes` (default `100,1000`),
`--modes` (default `islands,classic`), `--samples` (default 7), `--profile` (`desktop` or
`mobile`), `--out` to also write the JSON report, and `--keep` to leave the built apps in place.
Set `FARM_BENCH_CHROMIUM` to a Chromium executable when the one `@playwright/test` expects is not
installed.
