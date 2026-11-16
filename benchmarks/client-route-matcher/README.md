# Client route matcher benchmark

The production client loads its route table as its own chunk on the first prefetch, pointer or
navigation (see [`client-route-table`](../client-route-table/README.md)). Building the matchers
over that table (`createFarmRouter`) then runs on the first navigation. A navigation with no
pointer before it, such as `router.push` or a scripted click, waits for that work.

This benchmark measures that cost in Node, cold (the first call in a fresh process, as on a first
navigation) and warm, for each checkout passed with `--farm`. It bundles each checkout's
`packages/farm/src/router.ts` with esbuild, so no build is needed.

## Fixture

`routes.mjs` builds a client route table shaped like a docs-heavy app: 60% docs pages
(`/docs/section-n/page-n`), 15% content pages under a route group, and 25% app routes with
`[param]`, `[...catchAll]`, `[[...optional]]` and route groups, plus `/docs/[[...slug]]`. Each
sample builds both matchers the generated client runtime builds: every route, and the app pages
without docs routes.

## Metrics

Each sample is a fresh Node process:

- **coldBuildMs:** the first construction of both matchers.
- **coldFirstMatchMs:** the first `match()` after it, a path that no exact route holds, so it scans
  every route to `/docs/[[...slug]]`.
- **warmBuildMs:** the median of 40 constructions after 20 warmups.
- **warmMatchMs:** the median time per `match()` over 19 probe paths (hits of every kind, misses,
  escapes), after warmup.

The report gives the median of every metric over the samples, and every sample. Each round runs
every checkout once, rotating which goes first. It also reports each router minified for the
browser, raw, gzip (level 9) and brotli.

Before any timing, every checkout must order the routes and match every probe path, and the first
200 patterns as paths, the same way. A difference fails the run.

## Run

```sh
node benchmarks/client-route-matcher/run.mjs \
  --farm base=../farm-main --farm change=. --routes 100,1000,5000 --samples 15 --out report.json
```

Pass one path under two labels for an A/A control. Options: `--routes` (default `100,1000,5000`),
`--samples` (default 15) and `--out` to also write the JSON report. Do not run builds or tests
alongside it, and compare runs from the same machine only.

## Results

Linux x64, 4 vCPU Intel Xeon @ 2.10 GHz, Node 22.23.4. The host was shared with other workloads
(1-minute load 2-5 during the run), so the A/A pair (`main` twice) shows the noise. Main is
`99c308a7c`; the change compiles each pattern in one pass, sorts by a specificity key and decodes
a path once per match. 15 fresh processes per cell, medians in ms:

| Routes | Variant | Cold build | Cold first match | Warm build | Warm match |
| -----: | ------- | ---------: | ---------------: | ---------: | ---------: |
|    100 | main    |       7.66 |            0.365 |       1.66 |     0.0335 |
|    100 | main-aa |       7.00 |            0.379 |       1.77 |     0.0342 |
|    100 | change  |       2.02 |            0.371 |       0.41 |     0.0050 |
|  1,000 | main    |       44.3 |             1.15 |       16.4 |      0.331 |
|  1,000 | main-aa |       42.1 |             0.99 |       16.5 |      0.329 |
|  1,000 | change  |       12.6 |             0.72 |       2.44 |     0.0174 |
|  5,000 | main    |      159.4 |             2.79 |       86.5 |       1.66 |
|  5,000 | main-aa |      164.8 |             3.21 |       91.0 |       1.67 |
|  5,000 | change  |       46.3 |             1.75 |       14.5 |      0.117 |

The router minified for the browser is 6,702 → 6,022 bytes, 2,544 → 2,448 gzip.

In a browser, [`client-route-table`](../client-route-table/README.md) on the same host (Chromium
1208 headless shell, 7 samples, 1-minute load 2-9 from other workloads), medians in ms of the
first navigation with no pointer before it, at 1,000 routes:

| Profile | Mode    |  main | main-aa | change |
| ------- | ------- | ----: | ------: | -----: |
| desktop | islands | 164.9 |   165.9 |  134.5 |
| desktop | classic | 170.1 |   169.2 |  141.2 |
| mobile  | islands | 515.2 |   508.7 |  468.5 |
| mobile  | classic | 538.6 |   518.2 |  470.1 |

At 100 routes and in load-to-hydrated time, the change is within the A/A spread.
