# Client chunking benchmark

This benchmark measures how a large app's production client build splits into chunks, how many
`<link rel="modulepreload">` tags each page gets, how much JavaScript each route downloads, and
how fast pages load and hydrate over HTTP/1.1. A docs site ported from Next.js (about 1,100 MDX
pages) built into 2,276 client chunks with a median of 3.4 KB, and each page listed about 585
modulepreload links. Over HTTP/1.1 the browser fetches six at a time, so page loads were two to
seven times slower than on Next.js.

## Fixture

`fixture.mjs` generates a deterministic React app (seeded PRNG) and links the given
`@farm.js/core`, `@farm.js/cli`, React and React DOM into it:

- 337 page routes: a home page and 12 sections of 28 docs pages. Each page renders three to six
  shared client components, mostly from its own section, so it hydrates as a whole.
- 120 client components (`"use client"`), each with a counter button. They import ui-kit
  widgets and icon-kit icons. A few import `chart-kit` statically. Every seventh renders a
  `CodeBlock` with `React.lazy`, which imports `highlight-kit` dynamically. Every sixth imports a
  stylesheet shared with one other component, which leaves a CSS-only chunk in the bundle graph.
- `ui-kit`: 260 ES modules shaped like a component library, each importing a few lower-level
  modules of the same package, behind a side-effect-free barrel. `icon-kit`: 600 icon modules
  behind a barrel.
- A root layout with a hydrating client header and a navigation list.

Left to automatic chunking, Rolldown emits one chunk per distinct set of entries that reach a
module, so this app builds into about 630 chunks. Most are under 2 KB, and a route's static
closure is 20 to 90 chunks.

`analyze.mjs` reads a build's public client output and the client preload manifest. It counts the
chunks and their sizes, and walks each route's static imports in the emitted JS (the entry, then
the page's chunk) to get the route's static JS (gzip level 9 per file). It also checks the
manifest against that closure: preloads outside it, closure chunks not preloaded, and preloaded
files that do not exist.

The original app (`apps/docs` in assistant-ui/assistant-ui) has no Farm port upstream; its
branches were checked on 2026-11-14. Porting a 1,100-page Next.js docs site was out of scope, so
the fixture stands in for it. It reproduces the same mechanism at a smaller scale: hundreds of
sub-2 KB chunks, dozens of preloads per page, and a preloaded stylesheet-only chunk that 404s.

## Run

Build `@farm.js/core` and `@farm.js/cli` in this checkout and in a baseline checkout (for
example a `git worktree` of `main` after `pnpm install` and
`pnpm --filter "@farm.js/cli..." build`), then:

```sh
node benchmarks/client-chunking/run.mjs --baseline ../farm-main --app-groups --out result.json
```

`--baseline-core` and `--baseline-cli` take the two package directories instead of a checkout.
Without a baseline both builds use this checkout. Other options: `--runs` (default 10),
`--warmups` (default 2), `--profiles` (default `desktop,mobile`), `--skip-load` (builds and the
correctness check only), and `--keep` to leave the generated apps in place.

The script:

1. Builds the fixture with `farm build --preset node-server` using the baseline (`before`) and
   this checkout (`after`). `--app-groups` adds `after-app-groups`, this checkout with the
   `codeSplitting` groups from the original report set in the app's `vite` config (React at
   priority 30, `node_modules` shared by two or more entries, and any module shared by two or more
   entries, each capped at 500 KB).
2. Analyzes every build and compares each route's static JS against `before`.
3. Starts each build with `farm start`, plus a second server of the `before` build as an A/A
   control.
4. Checks correctness on five routes (home, the two timed routes, a route with `chart-kit`,
   a route with the lazy `CodeBlock`): the same `main` text in every variant, the lazy block
   rendered, a counter that increments after hydration, and no console errors or failed requests.
5. Times page loads in Chromium (Playwright) over HTTP/1.1 against the `farm start` servers. It
   times two routes: the one with the most preloads in `before`, and the one at the median. Each
   sample uses a new browser context with the cache disabled. Profiles are applied through the
   DevTools protocol: `desktop` is 40 ms RTT, 10 Mbps and no CPU slowdown; `mobile` is 150 ms
   RTT, 1.6 Mbps down, 750 Kbps up and a 4x CPU slowdown. Every round runs each profile, route and
   variant once and rotates which variant goes first, so all variants share the host's load. The
   first `--warmups` rounds are discarded.

Each page-load sample records DOMContentLoaded and load (navigation timing), LCP, the time the
first counter button has hydrated (React has attached its props to it), total blocking time (long
tasks between first contentful paint and the later of load and hydration), JS request count and
JS transfer bytes. The report gives the median, p95, minimum and maximum of each, the host's load
average before and after, and the HTTP protocol the pages used.

DOMContentLoaded waits for the client entry and its static imports only. The page's own chunks
load from a dynamic import, so the hydration time is the measure of a page becoming interactive.

## Results

Linux x64, 4 vCPUs, Node 22.23.4, Chromium from Playwright 1.58.2 (headless shell), on 2026-11-14.
Other builds and test runs shared the machine (load average about 15). Baseline: `main` at
1057dd1ff. 2 warmup rounds and 10 measured rounds per variant, profile and route.

The raw report is in `results/2026-11-14-linux-4vcpu.json`. `before` is `main`; `after` is this
change with default settings; `after-app-groups` is this change with the report's
`codeSplitting` groups set in the app config, which `main` ignored.

- `after` builds the same chunks as `before` and the same per-route JS on all 337 routes. The two
  preloaded files that `before` lists but never wrote (`chunks/shared-0-*.js` and
  `chunks/shared-2-*.js`, stylesheet-only chunks) are gone, along with their 404s.
- Page loads of `after` are within the A/A spread of `before`. For example, mobile hydration on the
  route with the most preloads is 3,220 ms against 3,233 ms, while the A/A server measured
  3,215 ms. TBT is the noisiest metric on this loaded host (mobile, heaviest route: 122 ms for
  `after`, 31 ms and 27 ms for the two `before` servers). The JS served is identical.
- `after-app-groups` cuts each route to 8 JS requests. Hydration on mobile drops from 3,233 ms
  to 1,708 ms (-47%) on the heaviest route and from 2,388 ms to 1,724 ms (-28%) on the median
  route. DOMContentLoaded is about 200 ms later, because React and the shared vendor code become
  static imports of the entry. 316 of 337 routes download more JS (median +15.6 KB gzip, up to
  +49.5 KB), so the trade-off is left for each app to opt into.

#### Build output

| Variant          | Chunks | Median chunk | Under 2 KB | Under 10 KB | `chunks/` gzip | Preloads per route (median / p95 / max) | Route static JS gzip (median / p95 / max) | Missing preloaded files |
| ---------------- | -----: | -----------: | ---------: | ----------: | -------------: | --------------------------------------: | ----------------------------------------: | ----------------------: |
| before           |    629 |       0.8 KB |        562 |         625 |       396.6 KB |                            62 / 80 / 93 |            188.6 KB / 205.2 KB / 218.7 KB |                       2 |
| after            |    629 |       0.8 KB |        562 |         625 |       396.6 KB |                            62 / 79 / 92 |            188.6 KB / 205.2 KB / 218.7 KB |                       0 |
| after-app-groups |    345 |       0.7 KB |        339 |         339 |       315.8 KB |                               8 / 8 / 8 |            204.2 KB / 204.2 KB / 204.2 KB |                       0 |

Per-route static JS against `before`, all routes:

| Variant          | Routes increased | Routes decreased | Largest increase | Median change |
| ---------------- | ---------------: | ---------------: | ---------------: | ------------: |
| after            |         0 of 337 |                0 |              0 B |           0 B |
| after-app-groups |       316 of 337 |               21 |          50650 B |       15936 B |

#### Page loads

Protocols: http/1.1. Load average 17.53 / 16.58 / 16.34 before, 7.04 / 11.69 / 14.89 after. Median (p95) in ms; spread is min to max of hydration.

| Profile | Route        | Variant          |         DCL |        Load |       LCP |       TBT |    Hydrated | Hydrated min to max | JS requests | JS transfer | 4xx |
| ------- | ------------ | ---------------- | ----------: | ----------: | --------: | --------: | ----------: | ------------------: | ----------: | ----------: | --: |
| desktop | /docs/s0/p12 | before           |   297 (360) |   297 (360) | 140 (180) |     0 (0) |  933 (1011) |         863 to 1025 |          93 |    247.5 KB |   2 |
| desktop | /docs/s0/p12 | after            |   316 (345) |   316 (345) | 144 (175) |     0 (6) |  927 (1173) |         859 to 1219 |          92 |    247.2 KB |   0 |
| desktop | /docs/s0/p12 | after-app-groups |   325 (384) |   325 (385) | 146 (204) |    0 (10) |   368 (430) |          343 to 431 |           8 |    208.0 KB |   0 |
| desktop | /docs/s0/p12 | before-aa        |   306 (339) |   306 (339) | 136 (176) |     0 (0) |  922 (1011) |         881 to 1054 |          93 |    247.5 KB |   2 |
| desktop | /docs/s1/p27 | before           |   301 (333) |   301 (333) | 150 (169) |     0 (0) |   641 (675) |          614 to 678 |          62 |    211.7 KB |   0 |
| desktop | /docs/s1/p27 | after            |   298 (338) |   298 (338) | 134 (194) |     0 (4) |   652 (692) |          612 to 700 |          62 |    211.7 KB |   0 |
| desktop | /docs/s1/p27 | after-app-groups |   311 (398) |   311 (398) | 140 (242) |     0 (0) |   335 (417) |          316 to 450 |           8 |    207.9 KB |   0 |
| desktop | /docs/s1/p27 | before-aa        |   290 (342) |   290 (342) | 134 (170) |     0 (3) |   653 (700) |          621 to 702 |          62 |    211.7 KB |   0 |
| mobile  | /docs/s0/p12 | before           | 1379 (1490) | 1379 (1490) | 414 (457) |   31 (56) | 3233 (3383) |        3191 to 3461 |          93 |    247.5 KB |   2 |
| mobile  | /docs/s0/p12 | after            | 1465 (1584) | 1466 (1586) | 432 (577) | 122 (184) | 3220 (3323) |        3155 to 3376 |          92 |    247.2 KB |   0 |
| mobile  | /docs/s0/p12 | after-app-groups | 1576 (1637) | 1576 (1637) | 440 (487) | 100 (171) | 1708 (1810) |        1621 to 1815 |           8 |    208.0 KB |   0 |
| mobile  | /docs/s0/p12 | before-aa        | 1366 (1448) | 1368 (1450) | 408 (468) |   27 (54) | 3215 (3369) |        3180 to 3396 |          93 |    247.5 KB |   2 |
| mobile  | /docs/s1/p27 | before           | 1423 (1519) | 1423 (1519) | 458 (523) | 107 (148) | 2388 (2434) |        2306 to 2440 |          62 |    211.7 KB |   0 |
| mobile  | /docs/s1/p27 | after            | 1450 (1572) | 1450 (1575) | 428 (586) |  93 (208) | 2351 (2457) |        2291 to 2484 |          62 |    211.7 KB |   0 |
| mobile  | /docs/s1/p27 | after-app-groups | 1609 (1676) | 1610 (1677) | 450 (521) |  85 (206) | 1724 (1814) |        1558 to 1833 |           8 |    207.9 KB |   0 |
| mobile  | /docs/s1/p27 | before-aa        | 1454 (1499) | 1454 (1499) | 416 (462) |  92 (163) | 2354 (2432) |        2302 to 2438 |          62 |    211.7 KB |   0 |

#### Correctness

- `/`: same content true, lazy block true, counter true; console errors before: 2; before-aa: 2; failed requests before: 404 /chunks/shared-0-h6f464f64.js; before-aa: 404 /chunks/shared-0-h6f464f64.js
- `/docs/s0/p12`: same content true, lazy block true, counter true; console errors before: 2; before-aa: 2; failed requests before: 404 /chunks/shared-0-h6f464f64.js; before-aa: 404 /chunks/shared-0-h6f464f64.js
- `/docs/s1/p27`: same content true, lazy block true, counter true; console errors none; failed requests none
- `/docs/s0/p0`: same content true, lazy block true, counter true; console errors before: 1; before-aa: 2; failed requests before: 404 /chunks/shared-0-h6f464f64.js; before-aa: 404 /chunks/shared-0-h6f464f64.js
- `/docs/s0/p2`: same content true, lazy block true, counter true; console errors before: 2; before-aa: 2; failed requests before: 404 /chunks/shared-0-h6f464f64.js; before-aa: 404 /chunks/shared-0-h6f464f64.js

## Default chunking that was not adopted

Farm's client build keeps Rolldown's automatic chunking. These defaults were measured on this
fixture against automatic chunking (`routes increased` counts routes whose static JS grew):

| Grouping                                                                          |                Chunks | Preloads per route (median) |             Routes increased |              Worst route |                 `chunks/` JS |
| --------------------------------------------------------------------------------- | --------------------: | --------------------------: | ---------------------------: | -----------------------: | ---------------------------: |
| Automatic (current)                                                               |                   629 |                          62 |                          n/a |                      n/a |                       948 KB |
| The report's groups (React, shared `node_modules`, shared code)                   |                   345 |                           8 |                   316 of 337 |                     +32% |                      1.05 MB |
| One group, `minShareCount: 2`, `entriesAware`, merge threshold 0 / 4 / 16 / 64 KB | 633 / 415 / 361 / 345 |            66 / 64 / 24 / 8 | 337 / 337 / 337 / 331 of 337 | +4% / +58% / +50% / +36% | 1.23 / 1.13 / 1.06 / 0.98 MB |
| `experimentalInlineCommonChunks`, max size 1 / 4 / 32 KB                          |       587 / 366 / 346 |                 58 / 12 / 6 |           337 / 0 / 0 of 337 |          +4% / -6% / -8% |   1.5 MB / 18.8 MB / 36.7 MB |

Every grouping that merges chunks shared by different routes makes some routes download code
only other routes use, which is what Rolldown's per-entry-set chunking avoids. Inlining common
chunks avoids that by copying them into each reader, but it multiplies the total output (and the
bytes a client-side navigation downloads), forces `strictExecutionOrder`, and is experimental in
Rolldown. An app that accepts one of these trade-offs can set it in
`vite.build.rolldownOptions.output.codeSplitting` (see the configuration docs).
