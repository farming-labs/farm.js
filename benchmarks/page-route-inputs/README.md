# Production page-route input preparation

The production page manifest is immutable. Its pattern routes now retain split pattern segments,
and a request pathname is split/decoded once after the existing exact-route lookup misses. Matching
still uses the same algorithm, original route order and per-attempt params/backtracking state.
The generic string matcher remains available for redirects, rewrites, metadata, errors and slots.
No request paths/results are cached, and client/development routing is unchanged.

## Reproduce

From the repository root, with dependencies installed:

```sh
pnpm --filter @farm.js/core exec vitest run src/__tests__/production-page-route-inputs.test.ts src/__tests__/universal-build-router-runtime.test.ts src/__tests__/route-matcher-parity.test.ts src/__tests__/guard-pathname-canonicalization.test.ts
node benchmarks/page-route-inputs/run.mjs > /tmp/page-route-inputs-first.json
node benchmarks/page-route-inputs/run.mjs > /tmp/page-route-inputs-second.json
```

The diagnostic executes the actual emitted matcher, page table and selector. Its baseline restores
the old preparation boundary without changing the algorithm; it removes the new wrapper boundary
as well so an extra function call is not charged to the baseline. No package build is needed for
these generated-source measurements. Real built-runtime verification is separate.

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
startup now does the split work once. Exact static hits and empty/static-only misses still do no
request splitting or decoding.

## Isolated runner

Manually dispatch the existing `CI` workflow with `page-route-inputs-benchmark` enabled. The
`Page Route Inputs Diagnostic` job runs focused correctness tests, then two full timing comparisons
sequentially without other work in that job. Artifact `page-route-inputs-<commit>` retains both JSON
files for 14 days. This optional job is skipped on ordinary PR/push runs. The workflow also runs its
normal CI jobs. A successful diagnostic means it ran and its controls passed; inspect distributions,
static/generic controls and setup costs before claiming a speedup.

Do not run builds/tests beside local timings. An initial shared-M1 run at load 19.60 → 55.41 produced
mixed static/single-route timings; it is not sufficient for a merge-time performance claim. That
exploratory run combined valid/malformed misses; the final runner separates those workloads and adds
the generic matcher control. Performance evidence belongs in the PR and raw artifacts, not published
framework benchmark charts. This is not a full SSR, HTTP latency, throughput, hydration or
cross-framework benchmark, and it does not establish an improvement for a root-only static app.

## Correctness controls

The preparation tests fail without the optimization: a two-segment late hit/miss over 100 dynamic
routes performs 200 splits and 200 decodes instead of one split and two decodes. They also verify
one-time preparation, zero request preparation on static paths, first-match order, descriptor
identity, fresh params, single decoding, malformed escapes, and hidden catch-all captures.
Existing tests retain memoized backtracking and redirect/rewrite/guard parity checks. The built Node
fixture additionally exercises optional catch-alls, double-encoded IDs, repeated requests, the
adapter's malformed-escape rejection, and a subsequent 404.

No public API, configuration, deployment target, renderer, generated fixture source, release version
or published benchmark result is changed.
