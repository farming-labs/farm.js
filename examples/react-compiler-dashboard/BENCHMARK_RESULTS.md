# Complex dashboard and 20,000-row scale result

Date: 2026-08-28

Result: **PASS.** Correctness, React-relative performance, keyed update, keyed append, scalar
selection, Set-membership, Map-lookup, collection-delta, and normalized scalability gates all pass.
The production run compares two bracketing React baselines with static and hybrid compiler builds
from the exact same component source. Append and dense Set/Map operations also compare each new
handoff with an unhinted compiled snapshot control.

## Environment and method

- Apple M1, 8 logical CPUs, macOS arm64
- Google Chrome 151.0.7922.175, Node.js 23.11.0
- Four production builds: React baseline A, static compiler, hybrid compiler, React baseline B
- Dashboard: 60 measured samples x 10 updates, after 5 warmup samples
- Standard table: 10 measured samples per operation, after 5 warmup samples
- Scale profile: 3 complete cycles peaking at 20,000 rich rows
- Timing boundary: event dispatch through an asserted DOM mutation
- Baseline values average the medians from the two bracketing React trials
- Performance gate: more than 10% and 0.25 ms slower than the bracketed baseline
- Keyed-update persistence gate: at least 8x faster than React at both 10,000 and 20,000 rows
- Keyed-append persistence gate: at least 4x faster than React at both 10,000 and up to 20,000 rows,
  and at least 1.25x faster than the equivalent compiled snapshot path
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
sites, one mutation-aware keyed-map update site, and one keyed-array append site were emitted.
Hybrid/static added zero owner executions. The two React baselines added 1,430 dashboard and 462
table owner executions each.

## Complex dashboard

The dashboard contains metrics, branch-sensitive panels, interactive controls, and 96 chart
bindings.

| Interaction                 | React median | Hybrid median | Hybrid vs React |
| --------------------------- | -----------: | ------------: | --------------: |
| Active live pulse           |      0.10 ms |       0.10 ms |          parity |
| Inactive branch update      |      0.08 ms |       0.02 ms |    3.75x faster |
| Switch live/snapshot branch |     0.100 ms |      0.100 ms |          parity |

## Standard table operations

| Operation               |             Rows | React median | Hybrid median | Hybrid vs React |
| ----------------------- | ---------------: | -----------: | ------------: | --------------: |
| Create                  |            1,000 |     12.50 ms |      11.40 ms |    1.10x faster |
| Replace all             |            1,000 |     18.45 ms |      11.90 ms |    1.55x faster |
| Create many             |           10,000 |    284.00 ms |     157.20 ms |    1.81x faster |
| Append                  | 10,000 -> 11,000 |     71.55 ms |      13.30 ms |    5.38x faster |
| Append snapshot control | 10,000 -> 11,000 |     82.55 ms |      25.60 ms |    3.22x faster |
| Update every 10th       |           10,000 |     58.60 ms |       2.60 ms |   22.54x faster |
| Select                  |            1,000 |      3.75 ms |       0.10 ms |   37.50x faster |
| Mark two rows           |            1,000 |      3.85 ms |       0.10 ms |   38.50x faster |
| Queue two rows          |            1,000 |      4.15 ms |       0.10 ms |   41.50x faster |
| Dense Set delta         |            1,000 |      4.00 ms |       0.10 ms |   40.00x faster |
| Dense Map delta         |            1,000 |      4.20 ms |       0.10 ms |   42.00x faster |
| Swap rows 2 / 999       |            1,000 |      7.90 ms |       1.20 ms |    6.58x faster |
| Remove one row          |            1,000 |      4.70 ms |       2.10 ms |    2.24x faster |
| Clear                   |           10,000 |     48.00 ms |       9.10 ms |    5.27x faster |

`Append` is the new keyed-array suffix path. The application still allocates the next array and
creates 1,000 required DOM rows, but the generated hint lets Farm skip all 10,000 existing keys and
bindings. Hybrid measured `13.30 ms`, **5.38x faster than React** and **1.92x faster than the
equivalent `25.60 ms` compiled snapshot control**. Repeated batches through 20,000 rows remained
7.09x faster than React. The gate requires at least 4x versus React and 1.25x versus the control in
both compiler modes.

`Update every 10th` is the targeted mutation-aware path. The application still executes its native
immutable `map()` over 10,000 items and creates 1,000 replacement objects. The generated hint lets
the keyed runtime validate and patch those 1,000 rows without a second scan of all 10,000 keys and
bindings. The 8x persistence floor leaves substantial headroom below this run's 13.38x-22.54x
result across compiler modes and row counts while still rejecting a silent return to the older
roughly 5x full-reconciliation path.

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
`0.30 ms` versus `2.10 ms` for the equivalent compiled snapshot control (**7.00x faster**); the Map
delta measured `1.00 ms` versus `4.80 ms` (**4.80x faster**) in hybrid mode. These direct
compiler-to-compiler comparisons are the evidence for this PR's incremental win.

## Repeated 20,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, updates
2,000 rows, performs two distant selections, replaces two marked Set members and two mapped queue
values, swaps rows, removes a middle row, and clears. Lower time is better.

| Operation at scale       | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------ | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000    |    315.00 ms | 436.25 ms |     122.90 ms |  126.50 ms |    2.56x |
| Append a 1,000-row batch |     93.55 ms | 134.15 ms |      13.20 ms |   18.80 ms |    7.09x |
| Update every 10th at 20k |    108.35 ms | 140.25 ms |       8.10 ms |   19.80 ms |   13.38x |
| Select at 20k            |    100.45 ms | 145.10 ms |       3.40 ms |    6.50 ms |   29.54x |
| Mark two rows at 20k     |    117.05 ms | 123.80 ms |       0.20 ms |    0.20 ms |  585.25x |
| Queue two rows at 20k    |    104.20 ms | 112.15 ms |       0.20 ms |    0.30 ms |  521.00x |
| Dense Set delta at 20k   |    102.90 ms | 153.10 ms |       0.30 ms |    0.40 ms |  343.00x |
| Dense Set snapshot       |    117.70 ms | 122.45 ms |       2.10 ms |    2.20 ms |   56.05x |
| Dense Map delta at 20k   |    103.90 ms | 118.00 ms |       1.00 ms |    1.00 ms |  103.90x |
| Dense Map snapshot       |    103.30 ms | 111.50 ms |       4.80 ms |    4.80 ms |   21.52x |
| Swap at 20k              |    115.85 ms | 120.05 ms |      34.30 ms |   36.00 ms |    3.38x |
| Remove middle row at 20k |    114.00 ms | 127.80 ms |      41.70 ms |   41.70 ms |    2.73x |
| Clear 20k                |    200.00 ms | 234.05 ms |      20.00 ms |   20.80 ms |   10.00x |

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path               | Row growth | Timing growth | Normalized growth |
| ------------------ | ---------: | ------------: | ----------------: |
| Create 10k repeat    |      1.00x |         0.78x |             0.78x |
| Update 10k -> 20k    |      2.00x |         3.12x |             1.56x |
| Select 1k -> 20k     |     20.00x |        13.60x |             0.68x |
| Mark Set 1k -> 20k   |     20.00x |         0.80x |             0.04x |
| Read Map 1k -> 20k   |     20.00x |         0.80x |             0.04x |
| Dense Set delta      |     20.00x |         1.20x |             0.06x |
| Dense Map delta      |     20.00x |         4.00x |             0.20x |
| Dense Set snapshot   |     20.00x |         8.40x |             0.42x |
| Dense Map snapshot   |     20.00x |        16.00x |             0.80x |
| Swap 1k -> 20k       |     20.00x |        28.58x |             1.43x |
| Remove 1k -> 20k     |     20.00x |        19.86x |             0.99x |
| Clear 10k -> 20k     |      2.00x |         2.20x |             1.10x |

This demonstrates approximately linear rather than quadratic end-to-end growth. Key-directed
scalar selection performs constant row-binding work—at most the previous and next keyed
instances—while its complete event-to-DOM timing remains 29.54x faster than React at 20,000 rows.
Set membership and Map lookup evaluate bindings only for changed keys. Their 0.10-0.20 ms medians
are near browser timer resolution, so deterministic exact-read gates remain the primary complexity
evidence. The dense delta-versus-snapshot controls remain above that floor and independently prove
the removed collection scan. Structural swap/removal paths remain O(n), as expected for validating
keys and maintaining row indices.

## Bundle cost

| Build           | Page chunk raw | Page chunk gzip |
| --------------- | -------------: | --------------: |
| React baseline  |       21,888 B |         4,999 B |
| Static compiler |       89,156 B |        18,732 B |
| Hybrid compiler |       89,156 B |        18,731 B |

This deliberately broad page now pays a 13,732-byte hybrid gzip premium for the compiler runtime,
including keyed append, mutation-aware map, scalar key-directed, Set-membership, Map-lookup, and
collection-delta paths. Smaller
direct-only applications retain less of the runtime; the package-level fixtures and persisted size
gate are documented in `packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 20,000-row mixed workload: all DOM and
event assertions pass, there are no browser errors or owner rerenders, every scale operation beats
the bracketed React baseline, and normalized growth stays at or below 1.43x for the measured
workload. Scalar selection performs at most two row-binding reads, while Set membership and Map
lookup evaluate only changed keys that map to rows. For dense collections, producer deltas were
7.00x faster for Set and 4.80x faster for Map than equivalent compiled snapshot scans. Keyed append
was 1.92x faster than its compiled snapshot control and 7.09x faster than React while scaling to
20,000 rows. The evidence claims only measured end-to-end behavior within this range—not unlimited
constant-time browser work.

The machine-readable output is `/tmp/farm-react-dashboard-benchmark.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
