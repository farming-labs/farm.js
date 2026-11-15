# Nested keyed stable-order reconciliation

This diagnostic compares the pre-change runtime at `752f17c17531ef7ac6bc19fbe50b274d9504a1a4`
with the working-tree runtime, using the same compiler and production build settings. It measures
one outer keyed row containing a 10,000-row inner list, both alone and beside a conditional range.
The updater is opaque to the compiler so specialized array-operation hints cannot skip this path.

From the repository root:

```sh
pnpm --filter @farm.js/react build
node packages/farm-react/scripts/benchmark-nested-stable-order.mjs \
  --baseline-ref 752f17c17531ef7ac6bc19fbe50b274d9504a1a4 \
  --samples 35 --warmups 5 --rows 10000 \
  --executable-path '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

Omit `--executable-path` to use Playwright's installed Chromium. Repeat the command for an independent
run; do not run other builds or tests concurrently. Output includes all raw samples, runtime source
hashes, baseline commit, candidate HEAD, machine/browser versions, system load, and bundle sizes.
The candidate source is read from the working tree, not necessarily from its HEAD commit.

## Method and correctness controls

- Each sample starts from a fresh navigation. After five discarded rounds, 35 measured rounds
  alternate baseline/candidate order. These are first-update measurements, not steady-state JIT
  throughput measurements.
- The metric is programmatic click to MutationObserver delivery. It includes the updater and DOM
  patch, but excludes startup, layout, and paint; it is not a page-interactivity or framework-ranking
  benchmark.
- Every sample checks all keys and labels, every surviving row's DOM identity, focused-row identity,
  and static/conditional neighbors. A compiler-disabled React build passes the same correctness
  checks, but is not used to make a speed claim.
- Separate untimed probes count position-map and replacement-row-table writes. Stable updates go
  from 10,000 writes to zero for each map. Reorders retain both maps and the existing structural path.
- Swapping the final two rows controls for a mismatch at the end of the key-order scan. Rotating the
  first row to the end controls for an immediate mismatch. Neither may skip structural work.

## Local results

Two independent runs on macOS arm64 / Apple M1, Node 24.21.0, Chrome 154.0.8037.99. Values are median
milliseconds, **baseline → candidate**; percentages are reductions in the median, not confidence
bounds.

| Workload                 |               Run 1 |               Run 2 |
| ------------------------ | ------------------: | ------------------: |
| Update one label, keyed  |   8.9 → 5.5 (38.2%) |   9.0 → 5.8 (35.6%) |
| Update one label, mixed  |   9.5 → 6.0 (36.8%) |   9.3 → 5.9 (36.6%) |
| Update all labels, keyed | 19.8 → 16.1 (18.7%) | 19.4 → 15.3 (21.1%) |
| Update all labels, mixed | 21.1 → 15.9 (24.6%) | 19.4 → 17.2 (11.3%) |
| Swap final two, keyed    |           9.0 → 8.8 |         11.2 → 11.5 |
| Swap final two, mixed    |          10.1 → 9.4 |         11.2 → 11.1 |
| Rotate, keyed            |           8.9 → 9.2 |         10.8 → 10.9 |
| Rotate, mixed            |           9.5 → 9.8 |         13.5 → 13.3 |

Same-order updates improved in both runs. Structural controls varied slightly in both directions;
these samples do not establish a structural speedup or guarantee zero overhead on every workload.
All browser correctness and allocation checks passed. Nested fixture payloads grew by 355 raw bytes,
125 gzip bytes for keyed-only and 123 gzip bytes for mixed ranges (gzip level 9, React included
equally in both variants).

The diagnostic also asserts byte-for-byte identical baseline/candidate output for the direct-binding
and plain-keyed fixtures. The helper is removed from both unused-feature bundles, and the existing
runtime-size budgets pass without changing their limits or reference results.

## Regression coverage

`compiler-runtime-nested-stable-order.test.tsx` covers keyed/mixed ranges, static/hybrid reactivity,
mount/hydration under Strict Mode, parent-driven/direct nested updates, unchanged order, late-key
mismatches, reversals, clear/repopulate, queued updates, focus/selection, duplicate keys, and invalid
child scopes. All 32 cases pass with the optimization; with the baseline runtime, the 16 allocation
checks fail while the 16 fallback cases still pass. Child descriptors and bindings must still run
exactly once per row, including when the last keys differ.

The packed React 18/19 compatibility test also updates stable nested rows and deeper descendant
labels after a reorder, checking preserved DOM identity and static siblings.

Verification commands (Node 24.21.0 on the same macOS machine):

```sh
pnpm --filter @farm.js/react test
pnpm --filter @farm.js/react type-check
pnpm --filter @farm.js/react test:compat
pnpm --filter @farm.js/react test:runtime-size
pnpm docs:check-navigation
```

The main suite passed 1,551 tests (14 existing skips); the separately selected stress suite passed
23 tests. React 18.3.1 and 19.2.8 packed-package checks passed. The 64-row browser smoke run also
passed with the final harness and its unused-feature bundle assertions. Focused formatting and lint
checks passed. These checks do not constitute testing every application or every browser/platform.
