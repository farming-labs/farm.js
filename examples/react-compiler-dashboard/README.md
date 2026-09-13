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
trial launches a clean process of the same browser version and uses the same viewport, DOM, data,
and user actions. It warms every scenario, reports
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

Keyed array appends have a separate persistence gate. A single-return block-bodied functional
append is measured against bracketed React and a compiled snapshot control whose updater block has
an extra local declaration. Both compiler modes must remain at least 4x faster than React at 10,000
and up to 20,000 rows, and at least 1.25x faster than the compiled control. The report must contain a
nonzero `keyedArrayAppendHints` count; deterministic package tests separately require work to equal
only the appended suffix.

Queued structural appends have an independent 10,000-row comparison. One concise setter removes a
row with `filter()` and the immediately adjacent setter appends one fresh row, while the
block-bodied pair remains the compiled fallback control. Both compiler modes must remain at least
2x faster than React and 1.25x faster than the compiled control. Every sample verifies the exact
9,999 survivor identities and order, the disconnected rejected row, and the fresh final row.
Package tests also cover bounded slices, multiple later appends, 2,000 randomized transitions,
controlled-input focus and selection, multi-boundary sharing, hydration, unmount cleanup, and
pre-mutation fallback.

A second structural-append comparison uses a bounded `slice()`, appends one row, and adds two
immediately following safe same-key maps. It verifies that the changed survivor keeps its DOM node
and receives its final label and amount, the sliced-away row disconnects, and the mapped incoming
suffix is newly mounted. Both compiler modes must remain at least 2x faster than React and 1.25x
faster than the equivalent block-bodied compiled control. Package tests compare 2,000 randomized
filter-or-slice, append, and map transitions with normal React. The suite also covers multiple maps,
mixed filter/slice chains, controlled-input selection, hydration, unmount, native method errors,
changed keys, external mutation, and pre-mutation fallback.

A separate filter-based comparison removes a middle row, appends one row, and runs the same two
safe maps. The filter's recorded survivor positions let the commit avoid a second key-and-binding
scan while still validating the complete native result before mutation. Both compiler modes must
remain at least 2x faster than React and 1.25x faster than the block-bodied compiled control.

The mapped-append comparison uses the other common order: filter one row, update a surviving row,
then append a fresh row. It verifies that the compiler retains the original survivor identity
through the intervening map instead of returning to complete keyed reconciliation. Both compiler
modes must remain at least 2x faster than React and 1.25x faster than the matching block-bodied
control.

Keyed array prepends have the same independent comparison. A single-return block-bodied functional
prepend is measured against bracketed React and a compiled snapshot control whose updater block has
an extra local declaration. Both compiler modes must remain at least 3x faster than React at 10,000
and 20,000 existing rows, and at least 1.25x faster than the compiled control at 10,000 rows. The
report must contain a nonzero `keyedArrayPrependHints` count; deterministic package tests separately
require key, descriptor, and binding work to equal only the new prefix while preserving every
existing DOM row.

Queued structural prepends have a separate 10,000-row gate. One concise setter drops the oldest row
with a bounded `slice()` and the adjacent setter prepends one fresh row; a block-bodied pair
performs the same native array and DOM work through complete reconciliation. Both compiler modes
must remain at least 2x faster than bracketed React and 1.25x faster than the compiled control.
Every sample checks all 9,999 survivor identities and order, the disconnected rejected row, and the
fresh first row.

Mapped structural prepends add a second 10,000-row gate. The concise path drops the oldest row,
prepends one row, updates one surviving row, and maps the new prefix across adjacent setters. The
matching block-bodied control performs the same native work without compiler lineage. Both compiler
modes must remain at least 2x faster than React and 1.25x faster than that control. Every sample
checks survivor identity and order, the changed survivor value, the final mapped prefix, and cleanup
of the removed row.

Keyed array slices have an independent retained-window comparison. A single-return block-bodied
`slice(trimCount)` uses an event-local runtime bound and is measured against bracketed React and a
compiled snapshot control whose updater block has an extra local declaration. Both compiler modes
must remain at least 3x faster than React while trimming 10,000- and 21,000-row arrays, and at least
1.25x faster than the compiled control at 10,000 rows. The report must contain a nonzero
`keyedArraySliceHints` count; deterministic package tests separately require zero surviving key,
descriptor, and binding reads, preserve surviving DOM identity, and cover safe and effectful bound
expressions plus unsafe evaluated-bound fallback.

Rolling windows have separate single-update and queued 10,000-row persistence gates. A concise
`[...current.slice(trimCount), ...incoming]` update uses an event-local runtime bound; the queued
case applies two 500-row rolls before one commit. Both are measured against bracketed React and
equivalent block-bodied compiled controls. Both compiler modes must remain at least 2x faster than
React and 1.25x faster than their compiled controls. The report must contain a nonzero
`keyedArrayRollingWindowHints` count; package tests separately require retained DOM identity, work
proportional only to the final incoming suffix, randomized dynamic and queued updates, and complete
fallback for unsafe evaluated bounds or broken chains.

Mapped rolling windows have another independent 10,000-row gate. The workload updates retained
row data, expires a 1,000-row prefix while appending 1,000 rows, and applies a second same-key map
before the commit. The concise path is measured against React and an equivalent compiled control
whose block-bodied rolling setter intentionally breaks lineage. Both compiler modes must remain at
least 2x faster than React and 1.25x faster than that control. Every sample verifies the retained
DOM identity, mapped value, exact row count, fresh suffix, and zero compiled owner executions.

Mapped rolling-window chains have a separate gate so the single-window result cannot hide a chain
regression. The 10,000-row workload runs one structured, fully returning `switch` map from a
single-return block-bodied setter, with safe local `const` aliases and two grouped case labels between
two queued 50-row rolls. Its control uses unsupported block-bodied rolling setters, so it performs
the same native work without retaining compiler lineage. Both compiler modes must remain at least 2x
faster than React and 1.25x faster than that control, and the compiler report must contain both mapped
rolling-chain steps. Every sample verifies both retained identities and mapped values plus the final
incoming suffix.

Exact-position insertions, removals, and replacements have separate 10,000-row comparisons. Concise
native `toSpliced(position, 0, item)`, `toSpliced(position, 0, ...items)`, `toSpliced(position, 1)`,
`toSpliced(position, 64)`, `toSpliced(position, 1, replacement)`, and
`toSpliced(position, runtimeCount, ...replacements)` and `with(position, replacement)` updates use
event-local runtime position and count variables and are measured against bracketed React and
equivalent block-bodied compiled controls. The compiler report must contain every dashboard
`keyedArrayPositionHints` site;
package tests separately require zero
surviving key/descriptor/binding reads for removal, surrounding DOM identity, randomized
differential correctness, runtime-position and count fallback, hydration, and cleanup. Both the
single-row and 64-row removal gates must remain at least 4x faster than React and 1.5x faster than
their compiled controls.

The batch insertion case mounts 64 new rows at the middle of a 10,000-row table. It must preserve
both surrounding DOM nodes, add no owner executions, remain at least 4x faster than React, and stay
at least 1.5x faster than the equivalent block-bodied compiled control. This gate is independent of
the older single-row position gates, so a batch regression cannot hide inside their aggregate.

The exact-window replacement case derives its delete count from the 64-row replacement array and
swaps that window in the middle of a 10,000-row table. It must
preserve both retained boundary nodes, disconnect both removed boundaries, add no owner
executions, remain at least 4x faster than React, and stay at least 1.5x faster than the equivalent
block-bodied compiled control. Package tests require work proportional only to the 64 incoming
rows and cover empty spreads, negative positions, clamped counts, reused and duplicate keys,
native custom-method behavior, queued fallback, controlled-input focus and selection, delegated
events, compiler-safe and effectful count expressions, unsafe evaluated-count fallback, 1,000
differential replacements, hydration, Strict Mode, and unmount cleanup.

Mixed local-key exact-window replacement has its own 10,000-row gate. The benchmark reverses 48
keys from inside one 64-row removed interval, changes their visible data, and adds 16 globally new
keys. All 48 reused DOM rows must move with their keys and retain identity, the 16 retired rows
must disconnect, the 16 fresh rows must be new, and both surrounding anchors must remain attached.
Static and hybrid modes must remain at least 4x faster than React and 1.5x faster than the
equivalent block-bodied compiled control. Package tests independently require window-local key and
binding work, descriptors only for fresh rows, exact local LIS moves, preparation before the first
DOM write, controlled-input focus and selection, current delegated event data, hydration, Strict
Mode, cleanup, and 1,000 randomized differential updates.

Variable-length local-key reuse has a separate 10,000-row gate. It grows one 64-row interval to 80
rows while reversing and refreshing 48 retained keys and adding 32 fresh keys. The benchmark
requires every retained DOM row to keep its identity, every retired row to disconnect, every fresh
row to be globally new, and both surrounding anchors to remain attached after the untouched suffix
shifts. Static and hybrid modes must remain at least 4x faster than React and 1.5x faster than the
equivalent block-bodied compiled control. Package tests additionally cover shrinking windows,
exact local LIS moves, atomic preparation, delegated event indexes, focused-input selection,
Strict Mode hydration, and 1,000 randomized grow/shrink differential updates.

Queued variable-length windows have their own 10,000-row gate. One event grows an early 64-row
interval to 80 rows and then shrinks a later 64-row interval to 48 rows using the position after
the first length change. The benchmark requires every locally retained row to keep its identity,
every retired row to disconnect, every fresh row to be globally new, and all four surrounding
anchors to remain attached. Static and hybrid modes must remain at least 4x faster than React and
1.5x faster than the equivalent block-bodied compiled control. Package tests additionally cover
both source orders, adjacent and empty intervals, exact local LIS moves, atomic preparation,
delegated event indexes, controlled-input selection, Strict Mode hydration and cleanup, overlap
and cross-window key-move fallback, and 1,000 randomized queued differential updates.

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
That workload contributes two of the dashboard `keyedArrayPositionHints`. Package tests compare
1,000 deterministic queued updates with React and cover disjoint windows, overlap with
last-update-wins semantics, atomic preparation, overlapping structural fallback, controlled-input selection,
events, Strict Mode hydration, and cleanup.

Queued fresh-key exact-window replacement has a separate 10,000-row gate. One event replaces two
overlapping 32-row windows with globally new final keys; their 16-row overlap leaves one 48-row
final union. The benchmark requires the 48 old rows to disconnect, both surrounding anchors to
retain identity, both final labels to reach the DOM, and zero compiled owner executions. Static and
hybrid modes must remain at least 4x faster than React and 1.5x faster than the equivalent
block-bodied compiled control. Together with the existing position workloads, the compiler report
must contain all fifteen dashboard `keyedArrayPositionHints`. Package tests also cover disjoint and
overlapping fresh-key commits, mixed same-key/fresh-key commits, atomic preparation,
existing-key-move fallback, events, controlled-input selection, Strict Mode hydration, cleanup,
and 1,000 differential overlapping updates.

Native keyed-array reversal has a separate 10,000-row comparison. Concise `toReversed()` is
measured against bracketed React and an equivalent block-bodied compiled control. Both compiler
modes must remain at least 8x faster than React and 1.25x faster than the compiled control. The
report must contain a nonzero `keyedArrayReorderHints` count; package tests separately require the
minimum `n - 1` connected DOM moves, zero key/descriptor/binding reads, randomized differential
correctness, hydration, and cleanup.

Queued native reorders have another independent 10,000-row comparison. One event queues two
concise `toReversed()` setters, so the final order equals the committed order. Farm must validate
that exact identity once without building the generic item map or running LIS, retain every DOM
node, perform no intermediate DOM moves, and remain
at least 2x faster than React and 1.25x faster than the equivalent block-bodied compiled control.
Package tests also cover queued sorts, mixed sort/reverse chains, thousands of randomized batches,
unsafe fallback, focus and selection, hydration, and cleanup.

Native reorder pipelines have a separate 10,000-row comparison. One functional setter evaluates
`current.toReversed().toReversed()`, so the final order again equals the committed order without
using two queued React updates. Farm must preserve both native calls, validate exact identity
without the generic item map or LIS, retain every DOM node, and remain at least 2x faster than React
and 1.25x faster than the equivalent block-bodied compiled control. Package tests compile mixed
sort/reverse pipelines and compare 2,000 deterministic two-to-four-step pipelines with normal
React.

Structural reorder pipelines add an independent 10,000-row comparison. One concise setter filters
one row and then evaluates two native reversals, while the block-bodied version remains the compiled
fallback control. Farm must validate membership and final order before touching the DOM, preserve
all 9,999 surviving row identities, remove only the rejected row, and remain at least 2x faster than
React and 1.25x faster than the compiled control. Package tests also cover filter/slice/sort/reverse
composition, queued filter-then-sort updates, 2,000 randomized removals, controlled-input focus and
selection, hydration, cleanup, and conservative fallback.

Consecutive same-order maps have their own 10,000-row comparison. One concise setter updates the
label and amount of every tenth row in two native `map()` stages. The block-bodied form performs the
same JavaScript and DOM-visible work through complete compiled reconciliation. Both compiler modes
must remain at least 8x faster than React and 2x faster than that compiled control. After every
sample the assertion verifies all 10,000 final values, row positions, connections, and DOM
identities. Package tests separately cover one committed-to-final identity comparison, one final
patch per row, changed keys, custom methods, subclassed arrays, native errors, queued updates,
Strict Mode hydration, and unmount-before-flush cleanup.

Same-key map-and-reorder pipelines have their own 10,000-row comparison. One concise setter
reprices a single row through `map()` and immediately restores amount order with `toSorted()`; the
block-bodied form performs the same JavaScript and DOM-visible work through complete compiled
reconciliation. Both compiler modes must remain at least 4x faster than React and 1.2x faster than
that compiled control. The assertion retains all 10,000 row elements, moves the edited row to its
exact final position, and verifies its text and amount. Package tests separately cover queued
edits, map/sort/reverse composition, changed-key and custom-method fallback, delegated events,
controlled-input focus and selection, 2,000 differential updates, Strict Mode hydration, and
unmount-before-flush cleanup.

Direct mapped reversal has a separate 10,000-row comparison. Two concise native maps change one
row's label and amount before `toReversed()`; the block-bodied control performs the same native
calls and DOM-visible work through complete reconciliation. Both compiler modes must remain at
least 4x faster than React and 1.2x faster than the compiled control. The assertion checks the full
reversed order, every original DOM identity and connection, and the changed row values. The hinted
path validates mirrored row lineage and uses the minimum `n - 1` moves without a source-item map or
LIS pass.

Reorder-then-map has its own 10,000-row comparison. The concise setter calls `toReversed()` first
and then changes one row through two safe native maps. Its block-bodied control performs the same
native work through complete keyed reconciliation. Both compiler modes must remain at least 4x
faster than React and 1.2x faster than the compiled control. The assertion checks the complete
reversed order, every existing DOM identity and connection, and the changed row values. Package
tests also cover sort-before-map permutation reconciliation, maps on both sides of a reorder,
changed-key and custom-method fallback, React 18/19, Strict Mode hydration, cleanup, and 2,000
differential updates.

Queued reorder-then-map has a separate 10,000-row comparison. One concise setter reverses the
rows, and two immediately adjacent setters change one row's label and amount through native maps.
The block-bodied control performs the same three queued updates through complete reconciliation.
Both compiler modes must remain at least 4x faster than React and 1.2x faster than the compiled
control. The assertion verifies complete reversed order, every original DOM identity and
connection, and both changed values. Package tests also compare 2,000 deterministic queued
reverse-or-sort/map sequences with normal React and cover Strict Mode hydration and
unmount-before-flush cleanup.

Queued map/reorder chains have a separate 10,000-row comparison. Two concise map setters update
one row, followed by two adjacent concise reverse setters. The block-bodied control performs the
same four native updates through complete reconciliation. Both compiler modes must remain at least
4x faster than React and 1.2x faster than the compiled control. The assertion verifies the complete
final committed order, every original DOM identity and connection, and both changed values. Package tests
also cover mixed reverse/sort chains, chain boundaries, and 2,000 randomized differential updates.

Queued structural, map, and reorder updates have a separate 10,000-row comparison. One concise
setter filters out a row, an immediately adjacent safe map changes a survivor, and two adjacent
native reverses restore survivor order. The block-bodied control performs the same four queued
updates through complete keyed reconciliation. Both compiler modes must remain at least 2x faster
than React and 1.25x faster than the compiled control. The assertion checks the changed values,
rejected-row cleanup, full survivor order, and every surviving DOM identity. Package tests cover
maps before, between, and after filter/slice steps; structural, map, and reorder work across adjacent
setters; multiple reorder steps; controlled-input focus and selection; changed-key and
custom-method fallback; Strict Mode hydration; cleanup; and separate 2,000-row differential runs.
The benchmark lifecycle rebuilds `@farm.js/react` first and then verifies the emitted hint counts,
so local source changes cannot be silently measured through stale package output.

Mapped reverse parity has an independent 10,000-row comparison. Two safe native maps update one
row, then two native reversals restore committed order. Farm must patch the changed row without
moving any DOM row or constructing the generic source-item map/LIS sequence. Both compiler modes
must remain at least 8x faster than React and 1.5x faster than the equivalent block-bodied compiled
control. A second operation splits the same proof across queued setters: one setter reverses the
rows, then another applies two safe maps and reverses again. It has the same independent 8x React
and 1.5x compiled-control floors. Both assertions check all final values, positions, identities,
and connections. Package tests compare one to four reversals across 2,000 deterministic updates,
run another 2,000 separately queued reverse/map/reverse updates against normal React, and cover
changed-key and subclass fallback, Strict Mode hydration, and cleanup.

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
  an updater block with an extra local declaration, isolating the saved full key-and-binding scan.
- The queued structural-append control removes one keyed row and appends one fresh row across
  adjacent setters. Its block-bodied pair performs the same native array and DOM-visible work
  through complete reconciliation; the hinted path reuses survivor positions and reads only the
  appended suffix.
- The queued structural-prepend control performs the mirror operation. Its hinted path reuses the
  exact slice interval, creates only the new prefix, and shifts delegated event indexes while its
  block-bodied pair uses complete reconciliation.
- The queued structural-append-map control follows that pair with a same-key native map. Its
  block-bodied control reaches the same DOM through complete reconciliation; the hinted path
  validates the final positional lineage once, patches only changed survivors, and mounts the final
  incoming suffix without recreating unchanged rows.
- The filter-map-append control maps one retained row before adding the new suffix. Its block-bodied
  control performs the same native operations through complete reconciliation; the hinted path
  carries the changed survivor back to its committed row, then removes and appends atomically.
- The prepend snapshot control does the same work at the beginning of the array through an updater
  block with an extra local declaration. It isolates the saved suffix scan while the hinted path
  still creates and inserts every required new DOM row.
- The slice snapshot control retains the same 9,000-row suffix through an updater block with an
  extra local declaration. It isolates the saved survivor scan while both paths remove the same
  1,000 DOM rows.
- The exact-position controls pass event-local runtime position and delete-count variables to concise native
  `toSpliced()` updates and compare them with equivalent block-bodied compiled controls. Package
  tests cover the equivalent `with()` replacement path too.
  They verify surrounding DOM identity and isolate the saved full keyed scan for one insertion,
  one replacement, or a single/contiguous-range removal.
- The queued same-key control issues two concise native window replacements before one flush. Its
  block-bodied pair performs the same array and DOM-visible work through complete reconciliation,
  isolating the benefit of combining both validated windows into one targeted refresh.
- The queued fresh-key control replaces two distant windows before one flush. Its block-bodied pair
  creates the same 64 rows through complete reconciliation, isolating the saved untouched key,
  descriptor, binding, and generic keyed-diff work.
- The reverse control compares concise native `toReversed()` with an equivalent block-bodied
  compiled update. Both paths move the same keyed DOM rows; the hint isolates the saved key,
  descriptor, binding, and generic LIS work.
- The queued-reverse control executes two native reversals in one commit. Both controls end at the
  same original order; the hinted path validates one final identity permutation and avoids the
  complete keyed scan without exposing either intermediate order to the DOM.
- The reorder-pipeline control executes two native reversals inside one functional setter. Its
  block-bodied equivalent stays on complete reconciliation, isolating the build-time lowering of
  native sort/reverse-only call chains.
- The map-reorder control changes one item identity and then sorts the same keyed rows. Its
  block-bodied equivalent rereads the complete keyed snapshot; the hinted path isolates the saved
  descriptor and unchanged-binding work while both paths run the same native map, sort, and LIS
  movement.
- The multi-map update control changes every tenth row in two same-order native maps. Its
  block-bodied equivalent rereads all 10,000 keys and bindings; the hinted path compares the
  committed and final arrays once and patches each final changed row once.
- The multi-map reorder control changes one row's label and amount in two consecutive native maps,
  then sorts the same keyed rows. Its block-bodied equivalent keeps complete reconciliation, while
  the hinted path checks each native call, scans only the committed and final arrays for lineage,
  and patches the final row once.
- The multi-map reverse control changes the same row through two native maps and then reverses all
  rows. Its block-bodied equivalent performs the same maps and connected DOM moves, while the
  hinted path validates mirrored lineage directly and skips the temporary source map and LIS pass.
- The reorder-then-map control reverses all rows before changing one row through two native maps.
  Its block-bodied equivalent loses the reorder proof; the hinted path retains exact reverse order,
  patches one row, and skips the generic source map and LIS pass.
- The queued reorder-then-map control performs the same reverse and two maps in three adjacent
  setter calls. Its block-bodied equivalent keeps complete reconciliation; the hinted path carries
  one committed reorder token through both queued maps and patches only the changed row.
- The queued map-then-reorder control performs two maps and a reverse in three adjacent setter
  calls. Its block-bodied equivalent keeps complete reconciliation; the hinted path records safe
  replacements from the committed rows and carries them into the final exact reverse.
- The queued map/reorder-chain control performs two maps and two reversals in four adjacent
  setter calls. Its block-bodied equivalent drops to complete reconciliation; the hinted path
  carries one committed replacement proof through both reversals, patches the changed row, and
  moves no DOM row when the reversals cancel.
- The multi-map reverse-parity control changes the same row through two native maps and then
  reverses twice. Its block-bodied equivalent keeps complete reconciliation; the hinted path
  validates exact committed order, patches the row once, and performs no generic item-map, LIS, or
  DOM-movement work.
- The sort control compares concise native `toSorted()` with an equivalent block-bodied compiled
  update. Both paths run the same native sort and move the same keyed DOM rows; the hint isolates
  the saved key, descriptor, and binding work while retaining only the required LIS moves.
- This is an operation-compatible local benchmark, not an official `js-framework-benchmark`
  submission or a score comparable to its published result table. This app has richer rows and
  measures event dispatch through an asserted DOM result without CPU throttling.
- Microbenchmarks are sensitive to CPU load and browser version. Compare medians, p95, execution
  counts, and bundle cost together rather than treating one run as a universal score.
