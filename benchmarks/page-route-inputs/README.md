# Production page-route input preparation

The production page manifest is immutable. Its pattern routes now retain split pattern segments,
and a request pathname is split/decoded once after the existing exact-route lookup misses. Fixed-length
patterns additionally retain parsed literal/parameter descriptors. They use a length check and a direct
segment walk; wildcard/catch-all patterns retain the complete existing backtracking matcher.
Both paths preserve original route order and fresh per-attempt params/captures.
The generic string matcher remains available for redirects, rewrites, metadata, errors and slots.
No request paths/results are cached, and client/development routing is unchanged.

## Reproduce

From the repository root, with dependencies installed:

```sh
pnpm --filter @farm.js/core exec vitest run src/__tests__/production-page-route-inputs.test.ts src/__tests__/universal-build-router-runtime.test.ts src/__tests__/route-matcher-parity.test.ts src/__tests__/guard-pathname-canonicalization.test.ts
node benchmarks/page-route-inputs/run.mjs > /tmp/page-route-inputs-first.json
node benchmarks/page-route-inputs/run.mjs > /tmp/page-route-inputs-second.json
```

By default, the diagnostic isolates the earlier split/decode optimization: fixed-length segment
preparation is disabled in both arms. Its baseline restores the old preparation boundary without
changing the algorithm; it removes the wrapper boundary as well so an extra function call is not
charged to the baseline. No package build is needed for these generated-source measurements.
Real built-runtime verification is separate.

To measure fixed-length pattern preparation against the already-shipped split-segment selector:

```sh
FARM_PAGE_ROUTE_BASELINE=segments node benchmarks/page-route-inputs/run.mjs > /tmp/page-route-segments-first.json
FARM_PAGE_ROUTE_BASELINE=segments node benchmarks/page-route-inputs/run.mjs > /tmp/page-route-segments-second.json
```

This mode uses the actual emitted matcher/table/selector as candidate. The baseline removes only
the fixed-length helpers and their registration/selection calls. It retains request decoding once
and pre-split pattern segments, so gains from earlier changes are not attributed to this follow-up.
Catch-all and generic matching algorithms are identical in both arms. The mode adds a valid-only
single-dynamic scenario (the original `singleDynamic` alternates valid and malformed inputs), early-hit and
wrong-length-miss scenarios over 100 patterns. `FARM_PAGE_ROUTE_BASELINE` accepts only `inputs`
(default) or `segments`; JSON records the mode. The controls below work with either mode.

Seven fresh-process pairs alternate baseline/candidate order, with 1,000 warmups and 10,000 measured
lookups per arm/scenario. Assertions outside timing compare route identity, params and the descriptors
of hidden catch-all segment captures. A checksum guards the measured loop. Setup work is measured
separately (20 warmups, 100 table creations), not included in lookup timings.

Scenarios cover static hits, static-only misses, one dynamic route, late hits and valid misses in a
100-pattern table, malformed misses, non-terminal catch-alls and a generic string-matcher control.
The malformed-input case is separate: repeatedly catching URI decoding errors can dominate that
workload and must not be presented as normal valid-URL performance.

JSON retains every pair, wall/CPU times, environment/load, generated runtime and runner hashes,
and isolated minified/gzip selector sizes. Sizes include the complete matcher/table/selector, not
an application bundle. Retained state is O(total pattern segments) per server-module instance;
startup does the split work once, plus descriptor preparation in `segments` mode. Preparation adds
server-side code, retained descriptors and startup work; inspect these costs alongside lookup gains.
Exact static hits and empty/static-only misses still do no
request splitting or decoding.

Optional diagnostic controls retain the default measurements and allow a separate investigation:

```sh
# Catch-all first in each fresh process, with the original short window:
FARM_PAGE_ROUTE_SCENARIO=catchAll node benchmarks/page-route-inputs/run.mjs
# A separate warmed comparison, not a replacement for the short samples:
FARM_PAGE_ROUTE_SCENARIO=catchAll FARM_PAGE_ROUTE_WARMUPS=100000 FARM_PAGE_ROUTE_ITERATIONS=1000000 node benchmarks/page-route-inputs/run.mjs
```

Scenario names must match those in the runner. Counts must be positive integers, and measured
iterations must cover complete input cycles. JSON records the selected scenarios and counts.
On Node versions supporting `process.threadCpuUsage`, it also records calling-thread CPU separately
from process-wide CPU. Process-wide CPU includes other threads; a difference alone does not identify
JIT, garbage collection or any other specific cause. Do not compare differently warmed samples as
if they were the same workload.

## Isolated runner

Manually dispatch the existing `CI` workflow with `page-route-inputs-benchmark` enabled. Select
`page-route-baseline: segments` for the fixed-length follow-up, or leave `inputs` for the earlier
split/decode comparison. The
`Page Route Inputs Diagnostic` job runs focused correctness tests, then two full timing comparisons,
two isolated short catch-all comparisons and two warmed catch-all comparisons sequentially without
other work in that job. Two warmed comparisons each also isolate the static-hit and generic-matcher
controls. Artifact `page-route-inputs-<commit>` retains all ten JSON
files for 14 days. This optional job is skipped on ordinary PR/push runs. The workflow also runs its
normal CI jobs. A successful diagnostic means it ran and its controls passed; inspect distributions,
static/generic controls and setup costs before claiming a speedup.

Do not run builds/tests beside local timings. An initial shared-M1 run at load 19.60 → 55.41 produced
mixed static/single-route timings; it is not sufficient for a merge-time performance claim. That
exploratory run combined valid/malformed misses; the final runner separates those workloads and adds
the generic matcher control. Performance evidence belongs in the PR and raw artifacts, not published
framework benchmark charts. This is not a full SSR, HTTP latency, throughput, hydration or
cross-framework benchmark, and it does not establish an improvement for a root-only static app.

## Initial short-window result

[CI run 37566405466](https://github.com/farming-labs/farm.js/actions/runs/37566405466)
measured revision `a71c0c68f1546f73d578e1b06e2e04f9ebe860f8` on Linux, Node 24.21.0,
AMD EPYC 9V45. One-minute load was 1.63 → 1.30 for the first repetition and
1.30 → 1.15 for the second. Each cell is the median baseline → candidate in microseconds.

| Scenario / metric               | First repetition | Second repetition |
| ------------------------------- | ---------------- | ----------------- |
| Late hit, 100 patterns / wall   | 42.660 → 10.756  | 42.182 → 11.097   |
| Valid miss, 100 patterns / wall | 41.758 → 10.330  | 40.944 → 10.336   |
| Non-terminal catch-all / wall   | 2.227 → 2.336    | 2.409 → 2.362     |
| Non-terminal catch-all / CPU    | 2.643 → 3.661    | 2.930 → 3.763     |

The large-table valid workloads used less wall time and CPU in all 14 pairs, but the catch-all
case used **more CPU in all 14 pairs** (median increases of approximately 39% and 28%). Its wall
times were mixed, as were static-hit and generic-matcher wall controls. The catch-all CPU result
initially held the PR back; passing correctness assertions or a successful CI job alone does not
clear this performance gate. The additional controls above isolate the catch-all scenario from
earlier workloads and separately measure warmed operation. Review all samples and the PR's
verification record before promotion. Do not discard the original samples or attribute them to
JIT/GC without evidence.

The 100-pattern late-hit table's median setup cost rose from 5.114 → 14.251 microseconds and
6.843 → 15.243 microseconds. Isolated selector size rose from 1,537 → 1,660 minified bytes and
829 → 866 gzip bytes. The artifact retains all eight scenarios, CPU and startup measurements,
and individual pairs, including malformed-input and unfavorable controls.

## Correctness controls

The input-preparation tests fail without the optimization: a two-segment late hit/miss over 100 dynamic
routes performs 200 splits and 200 decodes instead of one split and two decodes. They also verify
one-time preparation, zero request preparation on static paths, first-match order, descriptor
identity, fresh params, single decoding, malformed escapes, and hidden catch-all captures.
Existing tests retain memoized backtracking and redirect/rewrite/guard parity checks. The built Node
fixture additionally exercises optional catch-alls, double-encoded IDs, repeated requests, the
adapter's malformed-escape rejection, and a subsequent 404.

The fixed-length regression checks fail on the split-segment baseline: late hits and misses still
perform 606/600 regular-expression matches and 100 backtracking matcher calls. With fixed-length
preparation both counts are zero. Cross-product parity checks cover literal/bracket/colon segments,
duplicate and special parameter names, Unicode, encoded slashes, double encoding, malformed escapes,
repeated/trailing slashes and length mismatches. Hidden capture descriptors and their fresh objects
are checked independently. Unsupported/wildcard/catch-all forms explicitly exercise the fallback.

No public API, configuration, deployment target, renderer, generated fixture source, release version
or published benchmark result is changed.
