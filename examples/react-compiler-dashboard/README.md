# Farm React compiler dashboard benchmark

This standalone example measures the experimental Farm React compiler against the ordinary React
update path in a realistic dashboard and a standard keyed-table workload.

The table operation set is adapted from
[`js-framework-benchmark`](https://github.com/krausest/js-framework-benchmark): create and replace
1,000 rows, create 10,000, append or prepend 1,000, update every 10th row, select, swap, remove,
reverse, sort, and clear.

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

Keyed array slices have an independent retained-window comparison. A concise `slice(1_000)` is
measured against bracketed React and an equivalent block-bodied compiled snapshot control. Both
compiler modes must remain at least 3x faster than React while trimming 10,000- and 21,000-row
arrays, and at least 1.25x faster than the compiled control at 10,000 rows. The report must contain
a nonzero `keyedArraySliceHints` count; deterministic package tests separately require zero
surviving key, descriptor, and binding reads while preserving surviving DOM identity.

Rolling windows have a separate 10,000-row persistence gate. A concise
`[...current.slice(1_000), ...incoming]` update is measured against bracketed React and an
equivalent block-bodied compiled control. Both compiler modes must remain at least 2x faster than
React and 1.25x faster than the compiled control. The report must contain a nonzero
`keyedArrayRollingWindowHints` count; package tests separately require retained DOM identity and
work proportional only to the incoming suffix.

Exact-position insertions, removals, and replacements have separate 10,000-row comparisons. Concise
native `toSpliced(position, 0, item)`, `toSpliced(position, 0, ...items)`, `toSpliced(position, 1)`,
`toSpliced(position, 64)`, `toSpliced(position, 1, replacement)`, and
`toSpliced(position, 64, ...replacements)` and `with(position, replacement)` updates use event-local
runtime position variables and are measured against bracketed React and equivalent block-bodied
compiled controls. The compiler report must contain every dashboard `keyedArrayPositionHints` site;
package tests separately require zero
surviving key/descriptor/binding reads for removal, surrounding DOM identity, randomized
differential correctness, runtime-position and count fallback, hydration, and cleanup. Both the
single-row and 64-row removal gates must remain at least 4x faster than React and 1.5x faster than
their compiled controls.

The batch insertion case mounts 64 new rows at the middle of a 10,000-row table. It must preserve
both surrounding DOM nodes, add no owner executions, remain at least 4x faster than React, and stay
at least 1.5x faster than the equivalent block-bodied compiled control. This gate is independent of
the older single-row position gates, so a batch regression cannot hide inside their aggregate.

The exact-window replacement case swaps 64 rows in the middle of a 10,000-row table. It must
preserve both retained boundary nodes, disconnect both removed boundaries, add no owner
executions, remain at least 4x faster than React, and stay at least 1.5x faster than the equivalent
block-bodied compiled control. Package tests require work proportional only to the 64 incoming
rows and cover empty spreads, negative positions, clamped counts, reused and duplicate keys,
native custom-method behavior, queued fallback, controlled-input focus and selection, delegated
events, 1,000 differential replacements, hydration, Strict Mode, and unmount cleanup.

Same-key exact-window refresh has a separate 10,000-row gate. The benchmark replaces a 64-row
snapshot with 64 new objects carrying the same keys in the same order and changes one visible row,
which isolates the avoided full-list key scan without hiding the required binding update. All 64
DOM rows must keep their identity and the changed label and amount must reach the DOM. Static and
hybrid modes must remain at least 4x faster than React and 1.5x faster than the block-bodied
compiled control. Package tests also require zero descriptors for a 64-row refresh, latest event
data, focused-input selection, atomic preparation before mutation, hydration, Strict Mode, and
mixed/reordered/duplicate-key fallback.

Queued same-key exact-window refresh has its own 10,000-row gate. One event queues two separate
32-row refreshes before the compiler flushes, and the benchmark requires all 64 DOM rows to retain
identity while both changed labels and amounts reach the DOM. Static and hybrid modes must remain
at least 4x faster than React and 1.5x faster than the equivalent block-bodied compiled control.
Together with the existing position workloads, the compiler report must contain all nine dashboard
`keyedArrayPositionHints`. Package tests compare 1,000 deterministic queued updates with React and
cover disjoint windows, overlap with last-update-wins semantics, atomic preparation, structural and
key-changing fallback, controlled-input selection, events, Strict Mode hydration, and cleanup.

Native keyed-array reversal has a separate 10,000-row comparison. Concise `toReversed()` is
measured against bracketed React and an equivalent block-bodied compiled control. Both compiler
modes must remain at least 8x faster than React and 1.25x faster than the compiled control. The
report must contain a nonzero `keyedArrayReorderHints` count; package tests separately require the
minimum `n - 1` connected DOM moves, zero key/descriptor/binding reads, randomized differential
correctness, hydration, and cleanup.

Native keyed-array sorting has its own 10,000-row comparison. Concise `toSorted()` is measured
against bracketed React and an equivalent block-bodied compiled control. Both compiler modes must
remain at least 4x faster than React and 1.25x faster than the compiled control. The report must
contain a nonzero `keyedArraySortHints` count; package tests separately require the minimum
`n - LIS` DOM moves, zero key/descriptor/binding reads, native method semantics, randomized
differential correctness, focus and selection preservation, hydration, and cleanup.

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
- The slice snapshot control retains the same 9,000-row suffix through an unsupported block-bodied
  updater. It isolates the saved survivor scan while both paths remove the same 1,000 DOM rows.
- The exact-position controls pass event-local runtime variables to concise native
  `toSpliced()` updates and compare them with equivalent block-bodied compiled controls. Package
  tests cover the equivalent `with()` replacement path too.
  They verify surrounding DOM identity and isolate the saved full keyed scan for one insertion,
  one replacement, or a single/contiguous-range removal.
- The queued same-key control issues two concise native window replacements before one flush. Its
  block-bodied pair performs the same array and DOM-visible work through complete reconciliation,
  isolating the benefit of combining both validated windows into one targeted refresh.
- The reverse control compares concise native `toReversed()` with an equivalent block-bodied
  compiled update. Both paths move the same keyed DOM rows; the hint isolates the saved key,
  descriptor, binding, and generic LIS work.
- The sort control compares concise native `toSorted()` with an equivalent block-bodied compiled
  update. Both paths run the same native sort and move the same keyed DOM rows; the hint isolates
  the saved key, descriptor, and binding work while retaining only the required LIS moves.
- This is an operation-compatible local benchmark, not an official `js-framework-benchmark`
  submission or a score comparable to its published result table. This app has richer rows and
  measures event dispatch through an asserted DOM result without CPU throttling.
- Microbenchmarks are sensitive to CPU load and browser version. Compare medians, p95, execution
  counts, and bundle cost together rather than treating one run as a universal score.
