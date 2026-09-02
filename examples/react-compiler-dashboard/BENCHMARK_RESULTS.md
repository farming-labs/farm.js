# Complex dashboard and 21,000-row peak result

Date: 2026-08-29

## Runtime delete-count exact-window follow-up — 2026-09-02

The full bracketed production-browser run changed the existing 10,000-row exact-window workload
from a literal delete count to `deleteCount = replacements.length`. The concise setter passes that
runtime value to `toSpliced(position, deleteCount, ...replacements)`, while the block-bodied
compiled control performs the same native array and DOM work without the hint. Both compiler builds
emitted all 15 expected `keyedArrayPositionHints` sites, preserved both surrounding DOM anchors,
disconnected the complete removed interval, mounted the 64 replacement rows, and produced zero
owner executions.

| Mode   | React median | Runtime count | Compiled control | vs React | vs control |
| ------ | -----------: | ------------: | ---------------: | -------: | ---------: |
| Static |     110.95 ms |       7.60 ms |         19.90 ms |   14.60x |      2.62x |
| Hybrid |     110.95 ms |       7.80 ms |         18.90 ms |   14.22x |      2.42x |

The unchanged gate requires at least 4x versus React and 1.5x versus the equivalent block-bodied
compiled control. Every correctness, performance, persistence, and scalability gate passed. The
stacked queued grow/shrink workload also remained above its existing floors: 7.27x/7.78x versus
React and 2.03x/2.05x versus its control in static/hybrid modes.

Compiler tests accept identifiers, property reads, arithmetic, conditionals, and safe `Math` calls
as count expressions while rejecting calls, assignments, and update expressions. Runtime coverage
proves native count coercion occurs exactly once and that zero or fractional evaluated counts keep
their native result through complete reconciliation. The full 615-test ordinary suite and all
three isolated stress controls pass, as do packaged React 18.3.1 and 19.2.8 compatibility. The
optional keyed-window runtime remains unchanged at a 14,173 B gzip compiler premium, and the
compiler-disabled core premium remains 3,766 B gzip. The measured environment was Chrome
145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS arm64.

## Queued disjoint variable-length window follow-up — 2026-09-02

The full bracketed production-browser run added a 10,000-row workload that queues two disjoint
updates before one compiler flush. The first window grows from 64 to 80 rows while the second
shrinks from 64 to 48, so the final table remains at 10,000 rows. Both updates reverse and refresh
locally retained keys, retire old rows, and add globally fresh rows. Static and hybrid builds
emitted all 15 expected `keyedArrayPositionHints` sites, preserved surrounding anchors and retained
DOM identities, disconnected retired rows, mounted only fresh rows, and produced zero owner
executions.

| Mode   | React median | Queued resize | Compiled control | vs React | vs control |
| ------ | -----------: | ------------: | ---------------: | -------: | ---------: |
| Static |      72.25 ms |      13.60 ms |         25.40 ms |    5.31x |      1.87x |
| Hybrid |      72.25 ms |      13.40 ms |         25.40 ms |    5.39x |      1.90x |

The independent gate requires at least 4x versus React and 1.5x versus the equivalent block-bodied
compiled control in both modes. One initial full run passed correctness and every specialized
compiler gate but caught a non-reproducing broad hybrid table-creation outlier. An unchanged second
full run passed every correctness, performance, persistence, and scalability gate; the queued
resize result remained above both required floors in both runs.

Package coverage separately queues a 32-to-40-row grow and a 32-to-24-row shrink across a
4,096-row table. It proves 64 key and binding reads, 24 fresh descriptors, exact local LIS moves,
retained identity, retired-row cleanup, and stable anchors without rerunning the owner. Tests also
cover high-window-first coordinate normalization, adjacent empty windows, preparation of every
window before the first DOM write, overlap and cross-window-key fallback, controlled-input focus
and selection, delegated event indexes, hydration, Strict Mode, unmount-before-flush cleanup, and
1,000 randomized queued variable-length updates against normal React. Packaged React 18.3.1 and
19.2.8 compatibility both pass.

The isolated optional window runtime has a 14,173 B gzip compiler premium, 416 B above the previous
record after reducing the initial implementation by 206 B. The compiler-disabled core runtime
premium remains unchanged at 3,766 B gzip and still removes 82.5% of the full compatibility
runtime. The measured environment was Chrome 145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS
arm64.

## Variable-length local-key window reuse follow-up — 2026-09-02

The full bracketed production-browser run added a separate 10,000-row workload that grows one
64-row window to 80 rows. The update reverses and refreshes 48 keys retained from that interval,
retires 16 old keys, adds 32 globally fresh keys, and shifts the untouched suffix without
recreating either surrounding anchor. Both compiler builds emitted all 13 expected
`keyedArrayPositionHints` sites, produced zero owner executions, and passed every existing
correctness, performance, persistence, and scalability gate without lowering a threshold.

| Mode   | React median | Variable local window | Compiled control | vs React | vs control |
| ------ | -----------: | --------------------: | ---------------: | -------: | ---------: |
| Static |    114.75 ms |              15.90 ms |         31.90 ms |    7.22x |      2.01x |
| Hybrid |    114.75 ms |              19.10 ms |         34.80 ms |    6.01x |      1.82x |

The independent gate requires at least 4x versus React and 1.5x versus the equivalent block-bodied
compiled control in both modes. Package tests separately grow a 4,096-row table from a 64-row
window to 80 rows and shrink it to 40, requiring exact local LIS moves, retained DOM identity,
fresh-row-only descriptor work, retired-row cleanup, and preserved surrounding anchors. Another
1,000 deterministic randomized variable-length updates match normal React. Atomic preparation,
outside-window and duplicate-key fallback, controlled-input focus and selection, delegated event
indexes, hydration, Strict Mode, unmount cleanup, and packaged React 18.3.1/19.2.8 compatibility
also pass. The isolated exact-window runtime grows by 13 B gzip to a 13,757 B compiler premium,
inside the unchanged 256 B allowance; the compiler-selected core still removes 82.2% of the full
compatibility runtime. The measured environment was Chrome 145.0.7632.6, Node.js 23.11.0, and
Apple M1 macOS arm64.

## Mixed local-key exact-window replacement follow-up — 2026-09-01

The full bracketed production-browser run added a separate 10,000-row workload for one fixed
64-row window. The update reverses and changes 48 keys reused from inside that removed interval,
retires 16 old keys, and inserts 16 globally new keys. Both compiler builds emitted all 12 expected
`keyedArrayPositionHints` sites, retained all 48 reused DOM rows, disconnected all 16 retired rows,
created all 16 fresh rows without borrowing any of the 10,000 pre-update DOM nodes, preserved both
surrounding anchors, produced zero owner executions, and passed every existing correctness,
performance, persistence, and scalability gate without lowering a threshold.

| Mode   | React median | Mixed local window | Compiled control | vs React | vs control |
| ------ | -----------: | -----------------: | ---------------: | -------: | ---------: |
| Static |     57.70 ms |           10.80 ms |         22.50 ms |    5.34x |      2.08x |
| Hybrid |     57.70 ms |           10.80 ms |         23.10 ms |    5.34x |      2.14x |

The independent gate requires at least 4x versus React and 1.5x versus the equivalent block-bodied
compiled control in both modes. Package tests separately prove bounded work across 4,096 rows: 64
key reads, 64 binding snapshots, 16 fresh descriptors, 47 local LIS moves, and one fragment mount.
They also cover complete preparation before mutation, duplicate and outside-window key fallback,
1,000 deterministic differential updates, controlled-input focus and selection, delegated events,
hydration, Strict Mode, React 18/19 compatibility, and unmount cleanup. The isolated exact-window
fixture has a 13,744 B gzip compiler premium, 219 B above the previous result and inside the
unchanged 256 B allowance. Sharing the LIS/focus mover with ordinary keyed reconciliation also
reduces the other hinted keyed fixtures by up to 49 B gzip. The measured environment was Chrome
145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS arm64.

## Overlapping fresh-key exact-window replacement follow-up — 2026-09-01

The full bracketed production-browser run changed the 10,000-row queued replacement workload to
two overlapping 32-row windows. Their final union contains 48 rows: the later update wins in the
16-row overlap, intermediate identities are never mounted, both surrounding anchor rows retain
their DOM identity, and all 48 committed rows receive fresh keys. Both compiler builds emitted all
11 expected `keyedArrayPositionHints` sites, produced zero owner executions, and passed every
existing correctness, performance, persistence, and scalability gate without lowering a threshold.

| Mode   | React median | Overlapping replacement | Compiled control | vs React | vs control |
| ------ | -----------: | ----------------------: | ---------------: | -------: | ---------: |
| Static |     53.35 ms |                 8.80 ms |         20.00 ms |    6.06x |      2.27x |
| Hybrid |     53.35 ms |                 8.40 ms |         20.10 ms |    6.35x |      2.39x |

The independent gate still requires at least 4x versus React and 1.5x versus the block-bodied
compiled control in both modes. Package tests separately prove exact final-union work, committed-key
restoration, final-state validation after an intermediate collision, preparation before the first
DOM replacement, existing-key move and duplicate-key fallback, 1,000 deterministic differential
updates, controlled-input focus and selection, delegated events, hydration, Strict Mode, React
18/19 compatibility, and unmount cleanup. The isolated exact-window fixture has a 13,517 B gzip
compiler premium, 8 B smaller than the preceding disjoint-window result and inside the unchanged
runtime-size limit. Every unrelated size fixture remains within its existing budget; the isolated
full-runtime bundle still removes 81.8% when the compiler is disabled. The measured environment was
Chrome 145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS arm64.

## Queued fresh-key exact-window replacement follow-up — 2026-09-01

The full bracketed production-browser run added a separate 10,000-row workload that queues two
disjoint 32-row fresh-key replacements before one compiler flush. Both compiler builds emitted all
11 expected `keyedArrayPositionHints` sites, preserved the four surrounding anchor rows,
disconnected all 64 replaced rows, mounted 64 rows with new keys, produced zero owner executions,
and passed every existing correctness, performance, persistence, and scalability gate without
lowering a threshold.

| Mode   | React median | Queued replacement | Compiled control | vs React | vs control |
| ------ | -----------: | -----------------: | ---------------: | -------: | ---------: |
| Static |     68.15 ms |           10.00 ms |         21.10 ms |    6.81x |      2.11x |
| Hybrid |     68.15 ms |            9.80 ms |         21.10 ms |    6.95x |      2.15x |

The independent gate requires at least 4x versus React and 1.5x versus the block-bodied compiled
control in both modes. Package tests separately prove exact 64-row preparation work across 4,096
rows, mixed same-key patches and fresh-key replacements, complete preparation before the first DOM
replacement, existing-key, duplicate-key, overlapping-window, and failed-validation fallback,
1,000 deterministic differential updates, controlled-input focus and selection, delegated events,
hydration, Strict Mode, React 18/19 compatibility, and unmount cleanup. The isolated exact-window
fixture has a 13,525 B gzip compiler premium, 167 B above the previous result and inside its
unchanged 256 B allowance. Every unrelated runtime-size fixture remains byte-for-byte unchanged;
the isolated full-runtime bundle still removes 81.8% when the compiler is disabled. The measured
environment was Chrome 145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS arm64.

## Queued same-key exact-window refresh follow-up — 2026-08-31

The full bracketed production-browser run added a separate 10,000-row workload that queues two
32-row same-key refreshes before one compiler flush. Both compiler builds emitted all nine expected
`keyedArrayPositionHints` sites, preserved every one of the 64 touched DOM rows, updated the changed
label and amount in both windows, produced zero owner executions, and passed every existing
correctness, performance, persistence, and scalability gate without lowering a threshold.

| Mode   | React median | Queued refresh | Compiled control | vs React | vs control |
| ------ | -----------: | -------------: | ---------------: | -------: | ---------: |
| Static |     60.70 ms |       14.00 ms |         28.30 ms |    4.34x |      2.02x |
| Hybrid |     60.70 ms |        9.20 ms |         18.30 ms |    6.60x |      1.99x |

The independent gate requires at least 4x versus React and 1.5x versus the block-bodied compiled
control in both modes. Package tests additionally compare 1,000 deterministic queued updates with
normal React and cover disjoint and overlapping windows, last-update-wins behavior, complete-chain
preparation before mutation, structural and key-changing fallback, controlled-input focus and
selection, delegated events, hydration, Strict Mode, and unmount cleanup. The isolated exact-window
fixture has a 13,358 B gzip compiler premium, 254 B above the previous result and inside its
unchanged 256 B allowance. Direct, core-only, and unrelated hint fixtures remain unchanged. The
measured environment was Chrome 145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS arm64.

## Same-key exact-window refresh follow-up — 2026-08-31

The full bracketed production-browser run added a separate 10,000-row workload for refreshing 64
new row objects whose keys remain identical and in the same order. One visible row changes so the
run proves both data-to-DOM patching and the avoided 10,000-key scan. Both compiler builds emitted
all seven expected `keyedArrayPositionHints` sites, preserved every one of the 64 row elements,
updated the changed label and amount, produced zero owner executions, and passed every existing
correctness, performance, persistence, and scalability gate without lowering a threshold.

| Mode   | React median | Hinted refresh | Compiled control | vs React | vs control |
| ------ | -----------: | -------------: | ---------------: | -------: | ---------: |
| Static |     59.00 ms |        9.30 ms |         16.90 ms |    6.34x |      1.82x |
| Hybrid |     59.00 ms |        7.40 ms |         16.40 ms |    7.97x |      2.22x |

The package suite separately proves zero descriptors for a 64-row same-key refresh, retained DOM
identity for every row, changed text and controlled-input value bindings, focus and selection,
latest delegated event data, complete-window key/binding/target preparation before mutation,
mixed/reordered/duplicate-key fallback, 1,000 differential updates, hydration, Strict Mode,
queued-update fallback, unmount cleanup, native method behavior, and packaged React 18.3.1 and
19.2.8 compatibility. The isolated exact-window
fixture has a 13,104 B gzip compiler premium, 244 B above the previous recorded window runtime and
inside its unchanged 256 B limit; direct and core-only output remain unchanged. The measured
environment was Chrome 145.0.7632.6, Node.js 23.11.0, and Apple M1 macOS arm64.

## Exact-window keyed replacement follow-up — 2026-08-31

The full bracketed production-browser run added an isolated 10,000-row workload for concise native
`toSpliced(position, 64, ...replacements)` updates. Both compiler builds emitted all six expected
`keyedArrayPositionHints` sites, preserved retained DOM nodes on both sides, disconnected the exact
old window, produced zero owner executions, and passed every existing performance, persistence,
correctness, and scalability gate without lowering a threshold.

| Mode   | React median | Hinted window | Compiled control | vs React | vs control |
| ------ | -----------: | ------------: | ---------------: | -------: | ---------: |
| Static |     55.00 ms |       8.40 ms |         19.80 ms |    6.55x |      2.36x |
| Hybrid |     55.00 ms |       7.80 ms |         19.10 ms |    7.05x |      2.45x |

Package tests separately prove work proportional to the incoming window, preparation before live
DOM mutation, retained-row identity, empty-spread removal, native negative-position and clamped
count behavior, reused-key complete reconciliation, duplicate-key fallback, native custom-method
results and errors, queued-update fallback, controlled-input focus and selection, delegated event
indexes, 1,000 differential replacements, hydration, Strict Mode, and unmount cleanup. React
18.3.1 and 19.2.8 both pass the packaged compatibility suite. The isolated window fixture has a
12,860 B gzip compiler premium; direct and core-only fixtures remain unchanged, and single-row and
batch-only output do not retain the window runtime feature.

## Exact-position batch insertion follow-up — 2026-08-30

The full bracketed production-browser run added an isolated 10,000-row workload for concise native
`toSpliced(position, 0, ...incoming)` updates that insert 64 rows in the middle. Both compiler
builds emitted the fifth expected `keyedArrayPositionHints` site, preserved the DOM nodes on both
sides of the insertion, produced zero owner executions, and passed the independent 4x React and
1.5x compiled-control floors.

| Mode   | React median | Hinted batch | Compiled control | vs React | vs control |
| ------ | -----------: | -----------: | ---------------: | -------: | ---------: |
| Static |     71.70 ms |      8.50 ms |         20.80 ms |    8.44x |      2.45x |
| Hybrid |     71.70 ms |      8.50 ms |         21.80 ms |    8.44x |      2.56x |

Package tests separately verify one-fragment insertion, work proportional to the 64 incoming rows,
retained-row identity checks, duplicate and colliding key fallback before live DOM mutation, custom
method semantics and errors, queued-update fallback, 1,000 differential updates, controlled-input
focus and selection, delegated event indexes, hydration, Strict Mode, and unmount cleanup. The
batch-only runtime-size fixture has a 12,470 B gzip compiler premium. Direct and core-only bundles
remain unchanged, and modules that emit only the previous single-position operations do not retain
the batch helper or runtime capability.

## Native contiguous `toSpliced()` removal follow-up — 2026-08-30

The full bracketed production-browser run added one isolated 10,000-row workload for concise native
`toSpliced(position, 64)` updates. Both compiler builds emitted all four expected
`keyedArrayPositionHints` sites and passed DOM correctness, every existing performance and
optimization-persistence gate, and normalized scalability through the 21,000-row peak.

| Mode   | React median | Hinted range removal | Compiled control | vs React | vs control |
| ------ | -----------: | -------------------: | ---------------: | -------: | ---------: |
| Static |     66.75 ms |              8.40 ms |         21.50 ms |    7.95x |      2.56x |
| Hybrid |     66.75 ms |              7.10 ms |         20.60 ms |    9.40x |      2.90x |

Static and hybrid each added zero owner executions. Package tests separately prove exact range
cleanup, surrounding DOM identity, clamped native counts, unsafe-count fallback, 1,000 mixed
differential updates, focus and selection, delegated event indexes, hydration, Strict Mode, and
unmount cleanup. The optional known-position fixture grew by 84 B gzip, from a 12,201 B to a
12,285 B compiler premium; direct and core-only fixtures remain protected, and the isolated core
runtime reduction is 80.6%.

## Native `toSpliced()` replacement follow-up — 2026-08-30

The full bracketed production-browser run changed the exact-position replacement workload to the
concise native `toSpliced(position, 1, replacement)` form. Both compiler builds emitted the three
expected `keyedArrayPositionHints` sites and passed DOM correctness, every React-relative and
compiled-control persistence gate, and normalized scalability through the 21,000-row peak.

| Mode   | React median | Hinted replacement | Compiled control | vs React | vs control |
| ------ | -----------: | -----------------: | ---------------: | -------: | ---------: |
| Static |     47.35 ms |            3.80 ms |         13.40 ms |   12.46x |      3.53x |
| Hybrid |     47.35 ms |            3.70 ms |         13.80 ms |   12.80x |      3.73x |

Static and hybrid each added zero owner executions. Package tests separately prove same-key DOM
identity, one-row new-key replacement, the existing native `with()` path, 1,000 differential
updates, native clamping and errors, out-of-range and subclass fallback, focus and selection,
delegated events, hydration, Strict Mode, and unmount cleanup. The optional known-position fixture
grew by 13 B gzip, from a 12,188 B to a 12,201 B compiler premium; the isolated core runtime
reduction remains 80.5%.

## Compiler-safe runtime positions follow-up — 2026-08-30

The full bracketed production-browser run replaced the three literal position controls with
event-local runtime variables. Both compiler builds emitted all three `keyedArrayPositionHints`
sites and passed DOM correctness, the React-relative regression gate, every existing optimization
persistence gate, and normalized scalability.

| Operation   | Mode   | React median | Hinted update | Compiled control | vs React | vs control |
| ----------- | ------ | -----------: | ------------: | ---------------: | -------: | ---------: |
| Insert      | Static |     83.60 ms |       8.70 ms |         24.40 ms |    9.61x |      2.80x |
| Insert      | Hybrid |     83.60 ms |       8.10 ms |         25.30 ms |   10.32x |      3.12x |
| Remove      | Static |     83.70 ms |      10.30 ms |         23.90 ms |    8.13x |      2.32x |
| Remove      | Hybrid |     83.70 ms |       9.80 ms |         24.30 ms |    8.54x |      2.48x |
| Replace     | Static |     60.00 ms |       6.50 ms |         21.10 ms |    9.23x |      3.25x |
| Replace     | Hybrid |     60.00 ms |       5.10 ms |         17.00 ms |   11.76x |      3.33x |

Static and hybrid each added zero owner executions. The full suite retained its 4x React and 1.5x
compiled-control removal floors and every older append, prepend, slice, rolling-window, reverse,
sort, filter, keyed-update, key-directed, collection-delta, general regression, and scalability
floor. Because this follow-up broadens compiler eligibility and reuses the existing guarded runtime
unchanged, runtime-size fixtures stayed byte-for-byte identical: the known-position fixture remains
72,264 B gzip, direct and core-only premiums are unchanged, and core runtime reduction remains
80.5%.

## Known-position removal follow-up — 2026-08-30

The full default production run for concise `toSpliced(position, 1)` support passed correctness,
the React-relative regression gate, every existing optimization-persistence gate, and normalized
scalability. The new 10,000-row known-position removal comparison measured:

| Mode   | React median | Hinted removal | Compiled control | vs React | vs control |
| ------ | -----------: | -------------: | ---------------: | -------: | ---------: |
| Static |     64.95 ms |        7.00 ms |         17.00 ms |    9.28x |      2.43x |
| Hybrid |     64.95 ms |        7.00 ms |         16.80 ms |    9.28x |      2.40x |

The persisted gate requires at least 4x versus React and 1.5x versus the equivalent block-bodied
compiled control. All three paths execute the same native immutable array removal and disconnect
the same row. The hinted path preserves surrounding DOM identity, performs zero surviving key,
descriptor, or binding reads, and avoids rerunning the owner component. The compiler report emitted
three `keyedArrayPositionHints` sites—one insertion, one removal, and one replacement—in each
compiled build. Both compiler modes added zero owner executions, while all existing append,
prepend, slice, rolling-window, reverse, sort, filter, keyed-update, key-directed,
collection-delta, general regression, and scalability gates remained green. The optional
known-position package fixture grew by 58 B gzip; direct and core-only premiums were unchanged and
the core runtime reduction remained 80.5%.

## Native keyed sort follow-up — 2026-08-30

The full default production run for native `toSorted()` support also passed correctness, the
React-relative regression gate, every existing optimization-persistence gate, and normalized
scalability. The new 10,000-row sort comparison measured:

| Mode   | React median | Hinted sort | Compiled control | vs React | vs control |
| ------ | -----------: | ----------: | ---------------: | -------: | ---------: |
| Static |    154.25 ms |    26.70 ms |         42.00 ms |    5.78x |      1.57x |
| Hybrid |    154.25 ms |    25.40 ms |         40.10 ms |    6.07x |      1.58x |

The gate requires at least 4x versus React and 1.25x versus the equivalent block-bodied compiled
control. Both paths execute the same native sort and move the same keyed DOM rows; the hint avoids
key, descriptor, and binding reads and moves only rows outside the LIS. The compiler report emitted
one `keyedArraySortHints` site in each compiled build, both compiler modes added zero owner
executions, and all existing append, prepend, slice, rolling-window, known-position, reverse,
filter, keyed-update, key-directed, collection-delta, and scalability gates remained green. The
hybrid page chunk was 21,791 B gzip; the direct-only and isolated core package-size fixtures stayed
byte-for-byte unchanged.

Result: **PASS.** Correctness, React-relative performance, keyed update, keyed append, keyed prepend,
keyed filter, scalar selection, Set-membership, Map-lookup, collection-delta, and normalized
scalability gates all pass.
The production run compares two bracketing React baselines with static and hybrid compiler builds
from the exact same component source. Append, prepend, filter, and dense Set/Map operations also
compare each new handoff with an unhinted compiled snapshot control.

## Environment and method

- Apple M1, 8 logical CPUs, macOS arm64
- Google Chrome 151.0.7922.175, Node.js 23.11.0
- Four production builds: React baseline A, static compiler, hybrid compiler, React baseline B
- Dashboard: 60 measured samples x 10 updates, after 5 warmup samples
- Standard table: 10 measured samples per operation, after 5 warmup samples
- Scale profile: 3 complete cycles peaking at 21,000 rich rows
- Timing boundary: event dispatch through an asserted DOM mutation
- Baseline values average the medians from the two bracketing React trials
- Performance gate: more than 10% and 0.25 ms slower than the bracketed baseline
- Keyed-update persistence gate: at least 8x faster than React at both 10,000 and 20,000 rows
- Keyed-append persistence gate: at least 4x faster than React at both 10,000 and up to 20,000 rows,
  and at least 1.25x faster than the equivalent compiled snapshot path
- Keyed-prepend persistence gate: at least 3x faster than React at both 10,000 and 20,000 existing
  rows, and at least 1.25x faster than the equivalent compiled snapshot path at 10,000 rows
- Keyed-filter persistence gate: at least 3x faster than React at both 1,000 and 20,000 rows, and
  at least 1.25x faster than the equivalent compiled snapshot path
- Key-directed selection gate: at least 10x faster than React at 20,000 rows and no more than 2x
  normalized growth
- Key-directed Set-membership gate: at least 10x faster than React at 20,000 rows and no more than
  2x normalized growth
- Key-directed Map-lookup gate: at least 10x faster than React at 20,000 rows and no more than 2x
  normalized growth
- Keyed collection-delta gate: at least 2x faster than React, at least 1.5x faster than the
  equivalent compiled snapshot path, and no more than 2x normalized growth at 20,000 entries
- No CPU throttling

Every trial passed DOM assertions and browser-error checks. The compiler report proved that both
workloads compiled, delegated keyed rows were present only in compiler builds, exactly two scalar
key-directed bindings, two Set-membership bindings, two Map-lookup bindings, 19 Set/Map mutation
sites, one mutation-aware keyed-map update site, one keyed-array append site, one keyed-array
prepend site, and one keyed-array filter site were emitted. Hybrid/static added zero owner
executions. The two React baselines added 1,430 dashboard and 558 table owner executions each.

## Complex dashboard

The dashboard contains metrics, branch-sensitive panels, interactive controls, and 96 chart
bindings.

| Interaction                 | React median | Hybrid median | Hybrid vs React |
| --------------------------- | -----------: | ------------: | --------------: |
| Active live pulse           |      0.10 ms |       0.10 ms |          parity |
| Inactive branch update      |     0.075 ms |       0.02 ms |    3.75x faster |
| Switch live/snapshot branch |     0.100 ms |      0.100 ms |          parity |

## Standard table operations

| Operation               |             Rows | React median | Hybrid median | Hybrid vs React |
| ----------------------- | ---------------: | -----------: | ------------: | --------------: |
| Create                   |            1,000 |     12.60 ms |      10.80 ms |    1.17x faster |
| Replace all              |            1,000 |     16.20 ms |      11.50 ms |    1.41x faster |
| Create many              |           10,000 |    297.70 ms |     124.20 ms |    2.40x faster |
| Append                   | 10,000 -> 11,000 |     69.45 ms |      13.20 ms |    5.26x faster |
| Append snapshot control  | 10,000 -> 11,000 |     69.10 ms |      27.10 ms |    2.55x faster |
| Prepend                  | 10,000 -> 11,000 |     70.75 ms |      15.40 ms |    4.59x faster |
| Prepend snapshot control | 10,000 -> 11,000 |     71.60 ms |      29.00 ms |    2.47x faster |
| Update every 10th        |           10,000 |     41.80 ms |       3.10 ms |   13.48x faster |
| Select                   |            1,000 |      3.50 ms |       0.10 ms |   35.00x faster |
| Mark two rows            |            1,000 |      3.45 ms |       0.00 ms | near timer floor |
| Queue two rows           |            1,000 |      3.85 ms |       0.10 ms |   38.50x faster |
| Dense Set delta          |            1,000 |      3.70 ms |       0.10 ms |   37.00x faster |
| Dense Map delta          |            1,000 |      3.70 ms |       0.20 ms |   18.50x faster |
| Swap rows 2 / 999        |            1,000 |      7.10 ms |       1.30 ms |    5.46x faster |
| Remove one row           |            1,000 |      4.05 ms |       0.90 ms |    4.50x faster |
| Remove snapshot control  |            1,000 |      4.05 ms |       1.60 ms |    2.53x faster |
| Clear                    |           10,000 |     48.65 ms |      11.20 ms |    4.34x faster |

`Append` is the new keyed-array suffix path. The application still allocates the next array and
creates 1,000 required DOM rows, but the generated hint lets Farm skip all 10,000 existing keys and
bindings. Hybrid measured `13.20 ms`, **5.26x faster than React** and **2.05x faster than the
equivalent `27.10 ms` compiled snapshot control**. Repeated batches through 20,000 rows remained
6.30x faster than React. The gate requires at least 4x versus React and 1.25x versus the control in
both compiler modes.

`Prepend` is the corresponding keyed-array prefix path. The application still allocates the next
array and creates and inserts 1,000 required DOM rows. The generated hint proves that the existing
10,000 items form an unchanged suffix, so Farm evaluates only the new prefix and updates stored
event indexes without rebuilding old descriptors or bindings. Hybrid measured `15.40 ms`,
**4.59x faster than React** and **1.88x faster than the equivalent `29.00 ms` compiled snapshot
control**. With 20,000 existing rows it measured `20.20 ms`, **6.60x faster than React**. Static
mode measured 5.02x and 7.80x versus React, so both modes clear the 3x persistence floor.

`Update every 10th` is the targeted mutation-aware path. The application still executes its native
immutable `map()` over 10,000 items and creates 1,000 replacement objects. The generated hint lets
the keyed runtime validate and patch those 1,000 rows without a second scan of all 10,000 keys and
bindings. The 8x persistence floor leaves substantial headroom below this run's 13.48x-17.03x
result across compiler modes and row counts while still rejecting a silent return to the older
roughly 5x full-reconciliation path.

`Remove one row` is the keyed-array filter path. The application still executes native `filter()`
over the collection. The generated hint carries removed positions into the keyed runtime, which
validates surviving identities and keys, removes only rejected DOM rows, and skips descriptor and
binding reads for every survivor. Hybrid measured `0.90 ms`, **4.50x faster than React** and
**1.78x faster than the equivalent `1.60 ms` compiled snapshot control**. At 20,000 rows it
measured `16.10 ms`, **6.92x faster than React**. The gate requires at least 3x versus React and
1.25x versus the compiled control in both compiler modes.

`Select` is the key-directed path added by this result. When a primitive state value is compared
strictly with the exact row key, the compiler records that identity proof. The runtime then reads
and patches only the previous and next keyed instances instead of evaluating that binding for every
row. Package tests deterministically require no more than two row-binding reads per transition; the
browser boundary still includes event dispatch, style invalidation, and DOM observation.

`Mark two rows` is the Set-membership path. For `markedIds.has(row.id)`, the runtime compares the
previous and next native Set snapshots and evaluates only row keys in their symmetric difference.
Package tests require the binding-read count to equal the changed primitive keys that exist in the
table. The browser result includes event dispatch and the asserted DOM mutation; sub-millisecond
values are timer-quantized, so the exact read-count test is the stronger proof of bounded row work.

`Queue two rows` is the Map-lookup path. For `queueById.get(row.id)`, the runtime compares native
Map snapshots and evaluates only row keys whose mapped primitive value changed. Package tests
require the exact present-key read count across 2,000 randomized queued updates and verify that
custom Maps or identity-bearing values return to React before compiled binding reads.

The dense operations isolate this result's producer-side delta metadata. Both start with 20,000
primitive entries and immutably clone the collection, so the application's required `new Set()` or
`new Map()` work remains in both paths. A proven updater records only the native mutation keys that
actually execute. The runtime validates those keys and extends a bounded persistent snapshot,
instead of iterating every previous and next entry again. At 20,000 entries, the Set delta measured
`0.30 ms` versus `2.30 ms` for the equivalent compiled snapshot control (**7.67x faster**); the Map
delta measured `1.10 ms` versus `5.20 ms` (**4.73x faster**) in hybrid mode. These direct
compiler-to-compiler comparisons are the evidence for this PR's incremental win.

## Repeated 21,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, prepends
1,000 rows, restores the 20,000-row working set, updates 2,000 rows, performs two distant
selections, replaces two marked Set members and two mapped queue values, swaps rows, removes a
middle row, and clears. Lower time is better.

| Operation at scale       | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------ | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000    |    321.95 ms | 353.35 ms |     134.10 ms |  139.70 ms |    2.40x |
| Append a 1,000-row batch |     90.70 ms | 117.10 ms |      14.40 ms |   20.60 ms |    6.30x |
| Prepend 1,000 at 20k     |    133.40 ms | 142.45 ms |      20.20 ms |   22.30 ms |    6.60x |
| Update every 10th at 20k |    112.40 ms | 142.20 ms |       7.70 ms |    8.30 ms |   14.60x |
| Select at 20k            |    101.00 ms | 137.85 ms |       4.90 ms |    7.60 ms |   20.61x |
| Mark two rows at 20k     |    103.65 ms | 106.25 ms |       0.20 ms |    0.20 ms |  518.25x |
| Queue two rows at 20k    |    111.75 ms | 135.50 ms |       0.20 ms |    0.20 ms |  558.75x |
| Dense Set delta at 20k   |    106.55 ms | 141.60 ms |       0.30 ms |    0.30 ms |  355.17x |
| Dense Set snapshot       |    101.10 ms | 119.00 ms |       2.30 ms |    2.30 ms |   43.96x |
| Dense Map delta at 20k   |    105.65 ms | 113.50 ms |       1.10 ms |    1.10 ms |   96.05x |
| Dense Map snapshot       |    109.75 ms | 141.80 ms |       5.20 ms |    5.30 ms |   21.11x |
| Swap at 20k              |    114.15 ms | 139.20 ms |      35.60 ms |   36.00 ms |    3.21x |
| Remove middle row at 20k |    111.35 ms | 127.55 ms |      16.10 ms |   17.80 ms |    6.92x |
| Clear 20k                |    176.05 ms | 224.55 ms |      23.40 ms |   24.20 ms |    7.52x |

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path                 | Row growth | Timing growth | Normalized growth |
| -------------------- | ---------: | ------------: | ----------------: |
| Create 10k repeat    |      1.00x |         1.08x |             1.08x |
| Prepend 10k -> 20k   |      2.00x |         1.31x |             0.66x |
| Update 10k -> 20k    |      2.00x |         2.48x |             1.24x |
| Select 1k -> 20k     |     20.00x |        19.60x |             0.98x |
| Mark Set 1k -> 20k   |     20.00x |         0.80x |             0.04x |
| Read Map 1k -> 20k   |     20.00x |         0.80x |             0.04x |
| Dense Set delta      |     20.00x |         1.20x |             0.06x |
| Dense Map delta      |     20.00x |         4.40x |             0.22x |
| Dense Set snapshot   |     20.00x |         9.20x |             0.46x |
| Dense Map snapshot   |     20.00x |        17.33x |             0.87x |
| Swap 1k -> 20k       |     20.00x |        27.38x |             1.37x |
| Remove 1k -> 20k     |     20.00x |        17.89x |             0.89x |
| Clear 10k -> 20k     |      2.00x |         2.09x |             1.04x |

This demonstrates approximately linear rather than quadratic end-to-end growth. Key-directed
scalar selection performs constant row-binding work—at most the previous and next keyed
instances—while its complete event-to-DOM timing remains 20.61x faster than React at 20,000 rows.
Set membership and Map lookup evaluate bindings only for changed keys. Their 0.10-0.20 ms medians
are near browser timer resolution, so deterministic exact-read gates remain the primary complexity
evidence. The dense delta-versus-snapshot controls remain above that floor and independently prove
the removed collection scan. Structural swap/removal paths remain O(n), as expected for validating
keys and maintaining row indices.

## Bundle cost

| Build           | Page chunk raw | Page chunk gzip |
| --------------- | -------------: | --------------: |
| React baseline  |       22,710 B |         5,117 B |
| Static compiler |       94,700 B |        19,687 B |
| Hybrid compiler |       94,700 B |        19,686 B |

This deliberately broad page now pays a 14,569-byte hybrid gzip premium for the compiler runtime,
including keyed append and prepend, mutation-aware map, scalar key-directed, Set-membership,
Map-lookup, collection-delta, and keyed-filter paths. Smaller
direct-only applications retain less of the runtime; the package-level fixtures and persisted size
gate are documented in `packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 21,000-row peak mixed workload: all DOM
and event assertions pass, there are no browser errors or owner rerenders, every scale operation
beats the bracketed React baseline, and normalized growth stays at or below 1.37x for the measured
workload. Scalar selection performs at most two row-binding reads, while Set membership and Map
lookup evaluate only changed keys that map to rows. For dense collections, producer deltas were
7.67x faster for Set and 4.73x faster for Map than equivalent compiled snapshot scans. Keyed append
was 2.05x faster than its compiled snapshot control and 6.30x faster than React while scaling to
20,000 rows. Keyed prepend was 1.88x faster than its compiled snapshot control and 6.60x faster
than React with 20,000 existing rows. Keyed filter was 1.78x faster than its compiled snapshot
control at 1,000 rows and 6.92x faster than React at 20,000 rows. The evidence claims only measured
end-to-end behavior within this range—not unlimited constant-time browser work.

The machine-readable output is `/tmp/farm-react-dashboard-benchmark.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
