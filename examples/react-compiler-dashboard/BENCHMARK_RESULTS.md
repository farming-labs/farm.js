# Complex dashboard and 20,000-row scale result

Date: 2026-08-28

Result: **PASS.** Correctness, the React-relative performance gate, the keyed-update, scalar
selection, and Set-membership persistence gates, and the normalized scalability gate all pass. The
production run compares two bracketing React baselines with static and hybrid compiler builds from
the exact same component source.

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
- Key-directed selection gate: at least 10x faster than React at 20,000 rows and no more than 2x
  normalized growth
- Key-directed Set-membership gate: at least 10x faster than React at 20,000 rows and no more than
  2x normalized growth
- No CPU throttling

Every trial passed DOM assertions and browser-error checks. The compiler report proved that both
workloads compiled, delegated keyed rows were present only in compiler builds, exactly two scalar
key-directed bindings, one Set-membership binding, and one mutation-aware keyed-map update site were
emitted, and hybrid/static added zero owner executions. The two React baselines added 1,430
dashboard and 279 table owner executions each.

## Complex dashboard

The dashboard contains metrics, branch-sensitive panels, interactive controls, and 96 chart
bindings.

| Interaction                 | React median | Hybrid median | Hybrid vs React |
| --------------------------- | -----------: | ------------: | --------------: |
| Active live pulse           |      0.10 ms |       0.08 ms |    1.25x faster |
| Inactive branch update      |      0.06 ms |       0.02 ms |    3.00x faster |
| Switch live/snapshot branch |     0.100 ms |      0.100 ms |          parity |

## Standard table operations

| Operation         |             Rows | React median | Hybrid median | Hybrid vs React |
| ----------------- | ---------------: | -----------: | ------------: | --------------: |
| Create            |            1,000 |     12.55 ms |      11.20 ms |    1.12x faster |
| Replace all       |            1,000 |     18.15 ms |      12.10 ms |    1.50x faster |
| Create many       |           10,000 |    291.30 ms |     120.50 ms |    2.42x faster |
| Append            | 10,000 -> 11,000 |     71.10 ms |      26.00 ms |    2.73x faster |
| Update every 10th |           10,000 |     43.70 ms |       2.90 ms |   15.07x faster |
| Select            |            1,000 |      3.85 ms |       0.10 ms |   38.50x faster |
| Mark two rows     |            1,000 |      3.75 ms |       0.10 ms |   37.50x faster |
| Swap rows 2 / 999 |            1,000 |      7.90 ms |       1.50 ms |    5.27x faster |
| Remove one row    |            1,000 |      4.45 ms |       2.70 ms |    1.65x faster |
| Clear             |           10,000 |     63.95 ms |      11.00 ms |    5.81x faster |

`Update every 10th` is the targeted mutation-aware path. The application still executes its native
immutable `map()` over 10,000 items and creates 1,000 replacement objects. The generated hint lets
the keyed runtime validate and patch those 1,000 rows without a second scan of all 10,000 keys and
bindings. The 8x persistence floor leaves substantial headroom below this run's 14.57x-16.58x
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

## Repeated 20,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, updates
2,000 rows, performs two distant selections, replaces two marked Set members, swaps rows, removes a
middle row, and clears. Lower time is better.

| Operation at scale       | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------ | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000    |    315.20 ms | 412.55 ms |     124.70 ms |  127.80 ms |   2.53x |
| Append a 1,000-row batch |     85.35 ms | 121.90 ms |      29.10 ms |   35.10 ms |   2.93x |
| Update every 10th at 20k |    104.45 ms | 109.40 ms |       6.30 ms |   19.00 ms |  16.58x |
| Select at 20k            |     93.90 ms | 106.00 ms |       3.70 ms |    4.40 ms |  25.38x |
| Mark two rows at 20k     |     96.15 ms | 104.20 ms |       0.20 ms |    4.40 ms | 480.75x |
| Swap at 20k              |    113.50 ms | 135.10 ms |      26.70 ms |   27.20 ms |   4.25x |
| Remove middle row at 20k |    111.85 ms | 117.20 ms |      38.00 ms |   42.30 ms |   2.94x |
| Clear 20k                |    215.75 ms | 312.60 ms |      21.70 ms |   22.60 ms |   9.94x |

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path               | Row growth | Timing growth | Normalized growth |
| ------------------ | ---------: | ------------: | ----------------: |
| Create 10k repeat  |      1.00x |         1.03x |             1.03x |
| Update 10k -> 20k  |      2.00x |         2.17x |             1.09x |
| Select 1k -> 20k   |     20.00x |        14.80x |             0.74x |
| Mark Set 1k -> 20k |     20.00x |         0.80x |             0.04x |
| Swap 1k -> 20k     |     20.00x |        17.80x |             0.89x |
| Remove 1k -> 20k   |     20.00x |        14.07x |             0.70x |
| Clear 10k -> 20k   |      2.00x |         1.97x |             0.99x |

This demonstrates approximately linear rather than quadratic end-to-end growth. Key-directed
scalar selection performs constant row-binding work—at most the previous and next keyed
instances—while its complete event-to-DOM timing remains 25.38x faster than React at 20,000 rows.
Set membership performs work proportional to the changed members rather than total rows. Its
0.20 ms median is near browser timer resolution, so the deterministic unit gate remains the primary
complexity evidence. Structural swap/removal paths remain O(n), as expected for validating keys
and maintaining row indices.

## Bundle cost

| Build           | Page chunk raw | Page chunk gzip |
| --------------- | -------------: | --------------: |
| React baseline  |       19,073 B |         4,494 B |
| Static compiler |       77,870 B |        16,525 B |
| Hybrid compiler |       77,870 B |        16,526 B |

This deliberately broad page now pays a 12,032-byte hybrid gzip premium for the compiler runtime,
including the mutation-aware, scalar key-directed, and Set-membership paths. Smaller direct-only
applications retain less of the runtime; the package-level fixtures and persisted size gate are documented in
`packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 20,000-row mixed workload: all DOM and
event assertions pass, there are no browser errors or owner rerenders, every scale operation beats
the bracketed React baseline, and normalized growth stays at or below 1.09x. Scalar selection
performs at most two row-binding reads, while Set membership evaluates only changed members that map
to rows. The evidence claims only measured end-to-end behavior within this range—not unlimited
constant-time browser work.

The machine-readable output is `/tmp/farm-react-dashboard-benchmark.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
