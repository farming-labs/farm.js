# Isolated hydration cost benchmark

This benchmark compares the standard React renderer's route-wide and experimental isolated
hydration plans. The representative fixtures also include Farm's RSC renderer as a separate control.
All variants render the same static layout, client counters, and two-page navigation flow.

## Shapes

- `leaf`: one client leaf inside a 768-node server layout.
- `siblings`: four independent client leaves inside a 384-node server layout.
- `stress-*`: 8, 16, 32, and 64 independent client modules and roots inside a 128-node layout.

The stress series finds the point where independent-root overhead outweighs excluding the server
layout. The checked-in report records that crossover and the guard chosen from it.
The runner uses a benchmark-internal build marker scoped to its generated fixture directory for
those stress builds, so it can continue measuring past the normal fallback point. Application
builds use the measured limit and cannot select the stress plan by configuration.

## Measurements

Each production build reports raw, gzip, and Brotli client JavaScript; client chunks; initial
requests; executed script resources; HTML and isolated marker bytes; local server response time;
browser script, compile, and hydration work; first-interaction latency; post-hydration heap; React
root count; and warm SPA navigation time. Latency metrics retain every raw sample and report p50,
p95, and a deterministic bootstrap 95% confidence interval for the median.

The run fails if the representative JavaScript and confidence-interval improvement disappears, if
an accepted isolated fixture exceeds the route-wide or RSC hydration/interaction budget, or if the
checked guard no longer matches the first measured crossover.

The initial page check also proves the server-layout sentinel is absent from isolated and RSC client
assets, every counter is interactive, and layout state survives warm navigation.

## Running

Build the workspace packages first, then run the benchmark from the repository root:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @farm.js/core build
pnpm --filter @farm.js/cli build
pnpm --filter @farm.js/plugin build
BENCH_ITERATIONS=25 pnpm benchmark:isolated-hydration
```

`BENCH_ITERATIONS` defaults to 25 measured browser and server samples after five warmups.
`FARM_BENCH_CHROME_PATH` can point to a Chrome or Chromium executable. The runner otherwise uses
Playwright's Chromium, or native Chrome on macOS when available.

`BENCH_SHAPES` and `BENCH_MODES` can narrow a local diagnostic run. Filtered runs write only to
`.generated/partial-results.json`; they never replace or validate the canonical report.

Verify the checked-in samples and source guard without rebuilding the fixtures:

```bash
node benchmarks/isolated-hydration/run.mjs --verify-results
```
