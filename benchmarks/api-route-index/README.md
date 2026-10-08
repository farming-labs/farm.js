# Built API route index benchmark

```sh
pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/api-route-index.bench.ts --run
```

The control is the unchanged public `matchAPIRoute` live-Map matcher. The new
internal matcher owns a fixed snapshot of the generated production API table
and indexes candidates by their decoded static prefix. It shares parameter
matching and specificity code with the public matcher; benchmark fixtures and
tests require both to produce the same matches before timing.

Only generated production bundles use this index. The public Map API, development
discovery/HMR and client route-manifest matching remain live and unchanged. No
user-owned Map is cached or frozen. Copies of the built route descriptors are
frozen so route-path mutations cannot silently invalidate the private index.

Observed on macOS arm64, Node 24.21.0, Vitest 3.2.7. Each lookup sample is a
three-request batch: first dynamic match, last dynamic match, and miss.

| Routes / layout                  | Live Map mean ms/batch | Index mean ms/batch |
| -------------------------------- | ---------------------: | ------------------: |
| 50 / distinct static prefixes    |                 0.0095 |              0.0047 |
| 500 / distinct static prefixes   |                 0.0789 |              0.0018 |
| 2,000 / distinct static prefixes |                 0.2900 |              0.0017 |
| 500 / shared dynamic prefix      |                 0.2560 |              0.0949 |

The 500/2,000 distinct-prefix cases had 0.3–6.8% relative margin of error. The
50-route indexed case and shared-prefix cases were noisier (10–40%); their precise
ratios should not be relied on. These are warmed CPU measurements, not request
latency or whole-framework claims. A single shared dynamic prefix can still
require a full candidate scan; this is not a general constant-time route matcher.

Preparing 500 routes at startup measured 0.0281 ms for the old Map versus 0.4452 ms
for the snapshot/index (RME 1.5–1.9%). The old path deferred metadata parsing to
requests. The new path retains one descriptor and compiled metadata per route,
plus prefix tree nodes; this is an explicit startup/memory tradeoff. Applications
without API routes do not generate the factory call or import.

Minified esbuild bundle measurements:

- Node ESM `src/api/runtime.ts`: 66,402 → 67,315 bytes; gzip 21,919 → 22,238.
- Browser ESM `src/api/client-routes.ts`: 4,211 → 4,211 bytes; gzip 1,828 → 1,830.

The browser check replaces only `route-pattern.ts` with the `1307b964` source for
the control. The unused index is tree-shaken. These are isolated bundle sizes,
not the size of a complete Farm app. No dependencies or user configuration are
added.
