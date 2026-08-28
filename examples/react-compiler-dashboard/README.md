# Farm React compiler dashboard benchmark

This standalone example measures the experimental Farm React compiler against the ordinary React
update path in a realistic dashboard and a standard keyed-table workload.

The table operation set is adapted from
[`js-framework-benchmark`](https://github.com/krausest/js-framework-benchmark): create and replace
1,000 rows, create 10,000, append or prepend 1,000, update every 10th row, select, swap, remove, and
clear.

The page contains two independently measured components:

- `OperationsDashboard`: a dense operational dashboard with metrics, activity, controls, and 96
  branch-sensitive chart bindings. Its inactive-branch action distinguishes static scheduling from
  default hybrid scheduling without changing the visible chart.
- `StandardTableBenchmark`: the common 1,000/10,000-row create, replace, append, update-every-10th,
  select, swap, remove, and clear operations used by browser framework benchmarks, plus an
  equivalent 1,000-row prepend case.

After the standard operation set, the production runner also performs three mixed scale cycles.
Each cycle creates 10,000 rows, appends to 20,000, prepends 1,000 rows, restores the 20,000-row
working set, updates every 10th row, selects two distant rows, swaps, removes a middle row, and
clears the table. A normalized-growth gate fails if the compiled paths grow more than 2x beyond the
expected row-count growth, guarding against quadratic drift.
The calculation floors sub-millisecond reference timings at 0.25 ms to avoid browser timer
quantization turning a one-tick difference into a false scalability failure.

## Run it

From the repository root:

```bash
pnpm --filter @farm.js/react build
pnpm --filter farm-react-compiler-dashboard-example dev
```

The default is the compiler with hybrid reactivity. To inspect another mode:

```bash
FARM_REACT_COMPILER=false pnpm --filter farm-react-compiler-dashboard-example dev
FARM_REACTIVITY=static pnpm --filter farm-react-compiler-dashboard-example dev
```

## Run the production benchmark

```bash
pnpm --filter farm-react-compiler-dashboard-example benchmark
```

The runner builds four production trials in this order: baseline React, static compiler, default
hybrid compiler, and a second baseline React trial. Two baseline trials bracket machine drift. Each
trial uses the same browser, viewport, DOM, data, and user actions. It warms every scenario, reports
median and p95 event-to-DOM timings, checks the compiler report and bundle markers, verifies final
DOM state and component execution counts, and fails on browser errors.

Correctness and performance are reported separately. A mode can preserve every DOM assertion while
still failing the performance gate when its median is both more than 10% and more than 0.25 ms
slower than the bracketed React baseline. The absolute tolerance keeps sub-millisecond browser timer
noise from failing the run while retaining the relative gate for meaningful operations.

The targeted keyed-update optimization has an additional persistence gate. Both compiler modes must
remain at least 8x faster than bracketed React for update-every-10th at 10,000 and 20,000 rows. This
is intentionally below the measured 16x-17x result for machine headroom, but above the older roughly
5x full-reconciliation path. Key-directed selection has its own browser gate: selection at 20,000
rows must remain at least 10x faster than React, and its normalized growth may not exceed 2x the 20x
row-count increase from 1,000 to 20,000 rows. The package unit suite separately requires at most two
row-binding reads, which is the deterministic guard against returning to a full row scan. A failed
performance, scalability, or persistence gate writes the JSON report and exits with a nonzero
status.

Keyed array appends have a separate persistence gate. A concise functional append is measured
against bracketed React and an equivalent block-bodied compiled snapshot control. Both compiler
modes must remain at least 4x faster than React at 10,000 and up to 20,000 rows, and at least 1.25x
faster than the compiled control. The report must contain a nonzero `keyedArrayAppendHints` count;
deterministic package tests separately require work to equal only the appended suffix.

Keyed array prepends have the same independent comparison. A concise functional prepend is
measured against bracketed React and an equivalent block-bodied compiled snapshot control. Both
compiler modes must remain at least 3x faster than React at 10,000 and 20,000 existing rows, and at
least 1.25x faster than the compiled control at 10,000 rows. The report must contain a nonzero
`keyedArrayPrependHints` count; deterministic package tests separately require key, descriptor, and
binding work to equal only the new prefix while preserving every existing DOM row.

Set membership has a separate operation and persistence gate. The table alternates two marked row
keys with `markedIds.has(row.id)` at 1,000 and 20,000 rows. Both compiler modes must remain at least
10x faster than React at 20,000 rows, normalized growth may not exceed 2x, and the compiler report
must contain a nonzero `keyedMembershipTargets` count. Differential unit tests separately require
the exact number of binding reads to equal the primitive-key symmetric difference.

Map lookup targeting has the same independent gate. The table replaces two queue values through
`queueById.get(row.id)` at 1,000 and 20,000 rows. Both compiler modes must remain at least 10x faster
than React at 20,000 rows, normalized growth may not exceed 2x, and the compiler report must contain
a nonzero `keyedMapLookupTargets` count. Differential unit tests require binding reads to equal the
present row keys whose mapped primitive values changed.

Dense Set and Map operations isolate producer-side collection deltas from those binding
optimizations. Each compiler build runs a proven immutable functional updater and an equivalent
unhinted snapshot control over the same dense collection. The hinted path must be at least 2x
faster than React, at least 1.5x faster than the compiled snapshot control, and stay within 2x
normalized growth at 20,000 entries. The report must contain a nonzero
`keyedCollectionUpdateHints` count. Deterministic unit tests separately compare 2,000 randomized
hinted Set mutations and 2,000 randomized hinted Map mutations with normal React.

Set `FARM_EXPERIMENT_BROWSER_PATH` to an installed Chrome/Chromium executable when Playwright's
bundled browser is unavailable. Sample counts are configurable:

```bash
FARM_DASHBOARD_SAMPLES=60 \
FARM_DASHBOARD_UPDATES=10 \
FARM_TABLE_SAMPLES=10 \
FARM_BENCHMARK_WARMUP=5 \
FARM_SCALE_CYCLES=3 \
pnpm --filter farm-react-compiler-dashboard-example benchmark
```

The default JSON report is `/tmp/farm-react-dashboard-benchmark.json`; change it with
`FARM_DASHBOARD_REPORT`.

## Reading the result

- Dashboard active updates measure the case where the visible chart and metrics really change.
- Dashboard inactive updates change only the hidden chart source and one visible counter. Hybrid
  should avoid scheduling inactive branch bindings; static mode still checks their fixed dependency
  lists.
- The table scenarios include unavoidable allocation and DOM insertion/removal work. The compiler
  can remove owner rerenders and reconcile prepared keyed rows, but it cannot make required DOM work
  disappear.
- The scale profile compares 20,000-row medians with their 1,000- or 10,000-row references and
  records both raw growth and growth normalized by the row-count increase.
- The dense collection controls show only the incremental delta benefit: both compiler paths keep
  the application's immutable collection copy, while the hinted path avoids the runtime's second
  complete entry scan.
- The append snapshot control creates the same 1,000 array items and DOM rows but intentionally uses
  an unsupported block-bodied updater, isolating the saved full key-and-binding scan.
- The prepend snapshot control does the same work at the beginning of the array. It isolates the
  saved suffix scan while the hinted path still creates and inserts every required new DOM row.
- This is an operation-compatible local benchmark, not an official `js-framework-benchmark`
  submission or a score comparable to its published result table. This app has richer rows and
  measures event dispatch through an asserted DOM result without CPU throttling.
- Microbenchmarks are sensitive to CPU load and browser version. Compare medians, p95, execution
  counts, and bundle cost together rather than treating one run as a universal score.
