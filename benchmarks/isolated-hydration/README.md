# Isolated hydration cost benchmark

This benchmark compares the standard React renderer's route-wide and experimental isolated
hydration plans. Representative fixtures run both plans with and without Farm's experimental React
compiler, and also include Farm's RSC renderer as a separate control. All variants render the same
static layout, client counters, and two-page navigation flow.

## Shapes

- `leaf`: one client summary with 64 static detail nodes inside a 768-node server layout.
- `siblings`: four independent client summaries with 16 static detail nodes each inside a 384-node
  server layout.
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
root count; warm SPA navigation time; and repeated state-update latency. The update measurement runs
ten sequential counter changes per sample after hydration. Latency metrics retain every raw sample
and report p50, p95, and a deterministic bootstrap 95% confidence interval for the median.
Each variant runs in a separate fresh browser process, and the runner rotates mode order for every
cold-sample round. Code caches, accumulated heap, JIT state, and short host-load changes therefore
cannot systematically favor a later mode.

The run fails if the representative JavaScript and confidence-interval improvement disappears, if
an accepted isolated fixture exceeds the route-wide or RSC hydration/interaction budget, or if the
checked guard no longer matches the first measured crossover.

The initial page check also proves the server-layout sentinel is absent from isolated and RSC client
assets, every counter is interactive, and layout state survives warm navigation. Compiler variants
must list every counter in `.farm/react-compiler.json`; a silent fallback fails the run. The steady
update control also records component-owner executions. Ordinary React must rerun the owner, while
the compiled variant must leave that count unchanged as it patches the state binding.

The combined control checks both parts of the optimization independently. Isolated hydration must
preserve its transfer and hydration budget with the compiler enabled, and the compiler must improve
steady state updates inside the isolated root with separated confidence intervals.

## Running

Build the workspace packages first, then run the benchmark from the repository root:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @farm.js/core build
pnpm --filter @farm.js/cli build
pnpm --filter @farm.js/plugin build
BENCH_ITERATIONS=40 BENCH_WARMUPS=10 BENCH_SERVER_ITERATIONS=25 BENCH_SERVER_WARMUPS=5 pnpm benchmark:isolated-hydration
```

The checked-in report uses 40 measured browser samples after 10 warmups and 25 measured server
samples after five warmups.
`BENCH_ITERATIONS` defaults to 25 samples and `BENCH_WARMUPS` defaults to five for a quicker local
diagnostic run.
`FARM_BENCH_CHROME_PATH` can point to a Chrome or Chromium executable. The runner otherwise uses
Playwright's Chromium, or native Chrome on macOS when available.

`BENCH_SHAPES` and `BENCH_MODES` can narrow a local diagnostic run. Filtered runs write only to
`.generated/partial-results.json`; they never replace or validate the canonical report.

Verify the checked-in samples and source guard without rebuilding the fixtures:

```bash
node benchmarks/isolated-hydration/run.mjs --verify-results
```
