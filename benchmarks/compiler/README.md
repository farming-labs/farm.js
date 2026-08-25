# Farm.js compiler benchmark

Measures the experimental AOT compiler against the normal React path using one fixture app built
twice from identical source: `FARM_BENCH_COMPILER=1` enables `react({ experimental: { compiler } })`
for the compiled variant, and nothing else differs between the builds.

## Workload

A js-framework-benchmark-style keyed table driven by `useState`: create 1,000 rows, update every
10th label, advance the selected row, swap two rows, clear. The component deliberately stays inside
the documented compiler contract (top-level state, synchronous handlers, keyed `map`, row-local
ternaries, no refs or effects) so the compiled variant exercises direct DOM patching rather than
falling back.

## Proof of compilation

The compiled build writes `.farm/react-compiler.json` (via the renderer's `report` option). The
runner fails hard unless the report shows the `Bench` component compiled, so the comparison can
never silently degrade into baseline-vs-baseline.

## Measurement

Production `node-server` builds served locally and driven by Playwright Chromium. Each action is
clicked through `warmup + N` iterations. A latency sample is the time from the click dispatch to the
MutationObserver callback for the resulting DOM writes; both variants finish their DOM work before
that callback runs, and unlike rAF-based timing it is not quantized to display frame boundaries.
The runner also reports CPU work (script + style + layout duration from the Chrome DevTools
Performance domain) per full action cycle, which captures runtime cost even when latencies sit well
under one frame. p50 and p95 are reported per action; raw samples are kept in
`results/latest.json`.

## Running

```bash
cd benchmarks/compiler
npm install
npm run bench
```

The fixture installs the published `@farm.js/*` beta packages (pinned as a matching trio, since
`@farm.js/react` peers on an exact core version) rather than linking the workspace, so results
describe what npm users actually get and reproduce outside this repo. `BENCH_ITERATIONS` overrides
the default 25 measured iterations.
