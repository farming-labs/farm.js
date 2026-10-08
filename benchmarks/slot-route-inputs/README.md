# Production slot-selector diagnostic

From the repository root, using the same supported Node version for both arms:

```sh
pnpm --filter @farm.js/core build:runtime
node benchmarks/slot-route-inputs/run.mjs > /tmp/slot-routes-first.json
node benchmarks/slot-route-inputs/run.mjs > /tmp/slot-routes-second.json
```

The candidate executes the actual emitted matcher, preparation table and selector
from `universal-build.ts`. The baseline retains the selector from `72cdabb6`, with
the same complete path matcher and real owner-prefix matcher. Unit tests import
the same diagnostic source loader and baseline. No source files are overwritten.

Seven alternating fresh-process pairs measure 5,000 lookups after 500 warmups
per scenario. The no-slot and fallback-only controls use 1,000,000 and 100,000
lookups respectively. Full results, params, hidden catch-all descriptors, and
frozen input descriptors are checked outside timing; a checksum is consumed in
the timed loop. Setup is timed separately over 100 creations after 20 warmups.
Raw process wall/CPU/thread-CPU samples, host load, source hashes, and medians of
process means are retained. `FARM_SLOT_ROUTE_SCENARIO`, `FARM_SLOT_ROUTE_WARMUPS`
and `FARM_SLOT_ROUTE_ITERATIONS` support focused investigations; the iteration
override applies to every scenario and must cover complete request cycles.

Controls cover empty/fallback manifests, excluded owners, catch-all backtracking,
interception, malformed encodings, and non-root owners. Repeated matching fixed
routes stress stable precedence and specificity scoring; distinct fixed routes
cover late hits and misses. The 100-candidate cases are deliberately slot-heavy,
not a claim about a typical app. Owner-prefix matching is not optimized here.

Preparation trades one-time server startup work and retained pattern records for
lower request work. Report setup costs alongside lookup gains. Helper minified
and gzip sizes include a standalone matcher/selector, not a complete app bundle;
the real server also shares the prepared matcher with page routes. This is
server-only routing work, not a React compiler or browser-runtime optimization.
Client assets and full production behavior need separate build/browser checks.

Run without concurrent tests/builds and inspect both repetitions, including
unchanged controls. These results do not measure SSR, HTTP latency, cold process
startup, or any framework ranking. The canonical framework fixture has no route
slots: do not infer a benefit for it or replace its published results.
