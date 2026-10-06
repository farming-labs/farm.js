# Production layout selection diagnostic

The production builder already sorts its private layout descriptors by depth, stably. The candidate
keeps the same matcher and fresh result array but removes the second sort on each request. Client
navigation and development layout ordering are unchanged.

From the repository root, using the same Node version for both arms:

```sh
pnpm --filter @farm.js/core build:runtime
node benchmarks/layout-order/run.mjs > /tmp/farm-layout-order.json
```

The runner extracts the actual generated production selector and uses the built Farm router. Its
baseline injects the previous depth comparator before returning results. Correctness controls compare
both outputs outside timing. Seven fresh-process pairs alternate arm order; each arm/scenario gets
1,000 warmups and 5,000 measured lookups. JSON retains every pair, wall/CPU measurements, revision,
environment, host load and isolated minified-selector sizes. This is not full SSR, HTTP latency,
hydration, throughput or a cross-framework comparison. Do not run builds/tests alongside it.

## Initial local evidence — inconclusive timing

macOS 26.2, Apple M1 (8 logical CPUs, 16 GB), Node 24.21.0, base `55e95f58` with this candidate:

| Layout table            | Baseline median wall time / lookup | Candidate median wall time / lookup |
| ----------------------- | ---------------------------------: | ----------------------------------: |
| Root only               |                        0.000141 ms |                         0.000128 ms |
| 16 nested layouts       |                        0.179231 ms |                         0.188410 ms |
| 100 layouts, nested hit |                        0.444855 ms |                         0.685915 ms |

One-minute host load rose from 16.59 to 40.89 during this run. The candidate was sometimes faster and
sometimes slower; these results **do not establish a speedup or rule out regression**. In particular,
the slower candidate medians must not be omitted from the evidence. Keep the optimization in draft
until an isolated-runner comparison establishes its value. No general application-performance claim
is made. The default one-layout benchmark is unlikely to benefit materially from removing this sort.

Deterministic evidence: one per-lookup sort is removed; matching, stable depth ties and fresh result
arrays are preserved. The isolated minified selector is 288 → 162 bytes, gzip 205 → 153 bytes; these
are helper sizes, not whole-application bundle sizes. There are no new runtime imports, client code,
cache invalidation rules or configuration flags.
