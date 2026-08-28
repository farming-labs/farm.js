# Complex dashboard and 20,000-row scale result

Date: 2026-08-29

Result: **PASS.** Correctness, React-relative performance, keyed update, keyed append, keyed filter, scalar
selection, Set-membership, Map-lookup, collection-delta, and normalized scalability gates all pass.
The production run compares two bracketing React baselines with static and hybrid compiler builds
from the exact same component source. Append, filter, and dense Set/Map operations also compare each new
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
sites, one mutation-aware keyed-map update site, one keyed-array append site, and one keyed-array
filter site were emitted. Hybrid/static added zero owner executions. The two React baselines added
1,430 dashboard and 492 table owner executions each.

## Complex dashboard

The dashboard contains metrics, branch-sensitive panels, interactive controls, and 96 chart
bindings.

| Interaction                 | React median | Hybrid median | Hybrid vs React |
| --------------------------- | -----------: | ------------: | --------------: |
| Active live pulse           |      0.10 ms |       0.08 ms |    1.25x faster |
| Inactive branch update      |     0.065 ms |       0.02 ms |    3.25x faster |
| Switch live/snapshot branch |     0.100 ms |      0.100 ms |          parity |

## Standard table operations

| Operation               |             Rows | React median | Hybrid median | Hybrid vs React |
| ----------------------- | ---------------: | -----------: | ------------: | --------------: |
| Create                  |            1,000 |     12.25 ms |      11.20 ms |    1.09x faster |
| Replace all             |            1,000 |     16.60 ms |      11.80 ms |    1.41x faster |
| Create many             |           10,000 |    286.20 ms |     128.00 ms |    2.24x faster |
| Append                  | 10,000 -> 11,000 |     71.25 ms |      13.90 ms |    5.13x faster |
| Append snapshot control | 10,000 -> 11,000 |     68.60 ms |      28.20 ms |    2.43x faster |
| Update every 10th       |           10,000 |     42.15 ms |       2.70 ms |   15.61x faster |
| Select                  |            1,000 |      3.65 ms |       0.10 ms |   36.50x faster |
| Mark two rows           |            1,000 |      3.70 ms |       0.10 ms |   37.00x faster |
| Queue two rows          |            1,000 |      3.70 ms |       0.00 ms | near timer floor |
| Dense Set delta         |            1,000 |      3.65 ms |       0.10 ms |   36.50x faster |
| Dense Map delta         |            1,000 |      3.75 ms |       0.10 ms |   37.50x faster |
| Swap rows 2 / 999       |            1,000 |      8.00 ms |       1.20 ms |    6.67x faster |
| Remove one row          |            1,000 |      4.10 ms |       0.70 ms |    5.86x faster |
| Remove snapshot control |            1,000 |      4.30 ms |       1.40 ms |    3.07x faster |
| Clear                   |           10,000 |     46.60 ms |       9.30 ms |    5.01x faster |

`Append` is the new keyed-array suffix path. The application still allocates the next array and
creates 1,000 required DOM rows, but the generated hint lets Farm skip all 10,000 existing keys and
bindings. Hybrid measured `13.90 ms`, **5.13x faster than React** and **2.03x faster than the
equivalent `28.20 ms` compiled snapshot control**. Repeated batches through 20,000 rows remained
6.83x faster than React. The gate requires at least 4x versus React and 1.25x versus the control in
both compiler modes.

`Update every 10th` is the targeted mutation-aware path. The application still executes its native
immutable `map()` over 10,000 items and creates 1,000 replacement objects. The generated hint lets
the keyed runtime validate and patch those 1,000 rows without a second scan of all 10,000 keys and
bindings. The 8x persistence floor leaves substantial headroom below this run's 11.12x-15.61x
result across compiler modes and row counts while still rejecting a silent return to the older
roughly 5x full-reconciliation path.

`Remove one row` is the keyed-array filter path. The application still executes native `filter()`
over the collection. The generated hint carries removed positions into the keyed runtime, which
validates surviving identities and keys, removes only rejected DOM rows, and skips descriptor and
binding reads for every survivor. Hybrid measured `0.70 ms`, **5.86x faster than React** and
**2.00x faster than the equivalent `1.40 ms` compiled snapshot control**. At 20,000 rows it
measured `13.70 ms`, **9.09x faster than React**. The gate requires at least 3x versus React and
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
`0.30 ms` versus `2.10 ms` for the equivalent compiled snapshot control (**7.00x faster**); the Map
delta measured `0.90 ms` versus `4.70 ms` (**5.22x faster**) in hybrid mode. These direct
compiler-to-compiler comparisons are the evidence for this PR's incremental win.

## Repeated 20,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, updates
2,000 rows, performs two distant selections, replaces two marked Set members and two mapped queue
values, swaps rows, removes a middle row, and clears. Lower time is better.

| Operation at scale       | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------ | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000    |    315.35 ms | 352.00 ms |     109.10 ms |  129.30 ms |    2.89x |
| Append a 1,000-row batch |     90.90 ms | 115.80 ms |      13.30 ms |   20.20 ms |    6.83x |
| Update every 10th at 20k |    112.30 ms | 114.20 ms |      10.10 ms |   19.00 ms |   11.12x |
| Select at 20k            |     98.60 ms | 132.15 ms |       3.60 ms |    4.60 ms |   27.39x |
| Mark two rows at 20k     |    108.10 ms | 125.60 ms |       0.20 ms |    0.20 ms |  540.50x |
| Queue two rows at 20k    |     98.35 ms | 104.55 ms |       0.20 ms |    0.30 ms |  491.75x |
| Dense Set delta at 20k   |    102.45 ms | 175.80 ms |       0.30 ms |    0.30 ms |  341.50x |
| Dense Set snapshot       |    108.90 ms | 138.60 ms |       2.10 ms |    2.30 ms |   51.86x |
| Dense Map delta at 20k   |    103.80 ms | 111.60 ms |       0.90 ms |    1.00 ms |  115.33x |
| Dense Map snapshot       |    109.65 ms | 115.35 ms |       4.70 ms |    4.70 ms |   23.33x |
| Swap at 20k              |    125.30 ms | 128.10 ms |      32.20 ms |   37.20 ms |    3.89x |
| Remove middle row at 20k |    124.55 ms | 141.55 ms |      13.70 ms |   16.10 ms |    9.09x |
| Clear 20k                |    160.20 ms | 193.60 ms |      20.70 ms |   20.70 ms |    7.74x |

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path               | Row growth | Timing growth | Normalized growth |
| ------------------ | ---------: | ------------: | ----------------: |
| Create 10k repeat    |      1.00x |         0.85x |             0.85x |
| Update 10k -> 20k    |      2.00x |         3.74x |             1.87x |
| Select 1k -> 20k     |     20.00x |        14.40x |             0.72x |
| Mark Set 1k -> 20k   |     20.00x |         0.80x |             0.04x |
| Read Map 1k -> 20k   |     20.00x |         0.80x |             0.04x |
| Dense Set delta      |     20.00x |         1.20x |             0.06x |
| Dense Map delta      |     20.00x |         3.60x |             0.18x |
| Dense Set snapshot   |     20.00x |         8.40x |             0.42x |
| Dense Map snapshot   |     20.00x |        15.67x |             0.78x |
| Swap 1k -> 20k       |     20.00x |        26.83x |             1.34x |
| Remove 1k -> 20k     |     20.00x |        19.57x |             0.98x |
| Clear 10k -> 20k     |      2.00x |         2.23x |             1.11x |

This demonstrates approximately linear rather than quadratic end-to-end growth. Key-directed
scalar selection performs constant row-binding work—at most the previous and next keyed
instances—while its complete event-to-DOM timing remains 27.39x faster than React at 20,000 rows.
Set membership and Map lookup evaluate bindings only for changed keys. Their 0.10-0.20 ms medians
are near browser timer resolution, so deterministic exact-read gates remain the primary complexity
evidence. The dense delta-versus-snapshot controls remain above that floor and independently prove
the removed collection scan. Structural swap/removal paths remain O(n), as expected for validating
keys and maintaining row indices.

## Bundle cost

| Build           | Page chunk raw | Page chunk gzip |
| --------------- | -------------: | --------------: |
| React baseline  |       22,138 B |         5,043 B |
| Static compiler |       91,774 B |        19,298 B |
| Hybrid compiler |       91,774 B |        19,296 B |

This deliberately broad page now pays a 14,253-byte hybrid gzip premium for the compiler runtime,
including keyed append, mutation-aware map, scalar key-directed, Set-membership, Map-lookup, and
collection-delta and keyed-filter paths. Smaller
direct-only applications retain less of the runtime; the package-level fixtures and persisted size
gate are documented in `packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 20,000-row mixed workload: all DOM and
event assertions pass, there are no browser errors or owner rerenders, every scale operation beats
the bracketed React baseline, and normalized growth stays at or below 1.87x for the measured
workload. Scalar selection performs at most two row-binding reads, while Set membership and Map
lookup evaluate only changed keys that map to rows. For dense collections, producer deltas were
7.00x faster for Set and 5.22x faster for Map than equivalent compiled snapshot scans. Keyed append
was 2.03x faster than its compiled snapshot control and 6.83x faster than React while scaling to
20,000 rows. Keyed filter was 2.00x faster than its compiled snapshot control at 1,000 rows and
9.09x faster than React at 20,000 rows. The evidence claims only measured end-to-end behavior within this range—not unlimited
constant-time browser work.

The machine-readable output is `/tmp/farm-react-dashboard-benchmark.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
