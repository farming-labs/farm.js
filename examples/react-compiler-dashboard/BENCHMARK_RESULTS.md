# Complex dashboard and 20,000-row scale result

Date: 2026-08-28

Result: **PASS.** Correctness, the React-relative performance gate, and the normalized scalability
gate all pass. The production run compares two bracketing React baselines with static and hybrid
compiler builds from the exact same component source.

## Environment and method

- Apple M1, 8 logical CPUs, macOS arm64
- Google Chrome 151.0.7922.174, Node.js 23.11.0
- Four production builds: React baseline A, static compiler, hybrid compiler, React baseline B
- Dashboard: 60 measured samples x 10 updates, after 5 warmup samples
- Standard table: 10 measured samples per operation, after 5 warmup samples
- Scale profile: 3 complete cycles peaking at 20,000 rich rows
- Timing boundary: event dispatch through an asserted DOM mutation
- Baseline values average the medians from the two bracketing React trials
- Performance gate: more than 10% and 0.25 ms slower than the bracketed baseline
- No CPU throttling

Every trial passed DOM assertions and browser-error checks. The compiler report proved that both
workloads compiled, delegated keyed rows were present only in compiler builds, exactly one
mutation-aware keyed-map update site was emitted, and hybrid/static added zero owner executions.
The two React baselines added 1,430 dashboard and 261 table owner executions each.

## Complex dashboard

The dashboard contains metrics, branch-sensitive panels, interactive controls, and 96 chart
bindings.

| Interaction                 | React median | Hybrid median | Hybrid vs React |
| --------------------------- | -----------: | ------------: | --------------: |
| Active live pulse           |     0.100 ms |      0.100 ms |          parity |
| Inactive branch update      |     0.060 ms |      0.020 ms |    3.00x faster |
| Switch live/snapshot branch |     0.100 ms |      0.100 ms |          parity |

## Standard table operations

| Operation         |            Rows | React median | Hybrid median | Hybrid vs React |
| ----------------- | --------------: | -----------: | ------------: | --------------: |
| Create            |           1,000 |     12.45 ms |      10.50 ms |    1.19x faster |
| Replace all       |           1,000 |     16.85 ms |      11.50 ms |    1.47x faster |
| Create many       |          10,000 |    297.40 ms |     116.10 ms |    2.56x faster |
| Append            | 10,000 -> 11,000 |     70.30 ms |      27.30 ms |    2.58x faster |
| Update every 10th |          10,000 |     44.05 ms |       2.50 ms |   17.62x faster |
| Select            |           1,000 |      4.10 ms |       0.20 ms |   20.50x faster |
| Swap rows 2 / 999 |           1,000 |     10.20 ms |       1.10 ms |    9.27x faster |
| Remove one row    |           1,000 |      4.65 ms |       2.40 ms |    1.94x faster |
| Clear             |          10,000 |     53.60 ms |       9.70 ms |    5.53x faster |

`Update every 10th` is the targeted mutation-aware path. The application still executes its native
immutable `map()` over 10,000 items and creates 1,000 replacement objects. The generated hint lets
the keyed runtime validate and patch those 1,000 rows without a second scan of all 10,000 keys and
bindings. That reduced the measured median from the previous compiler result of 9.90 ms to 2.50 ms
on the same benchmark shape; cross-run timings remain machine- and load-sensitive.

## Repeated 20,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, updates
2,000 rows, performs two distant selections, swaps rows, removes a middle row, and clears. Lower
time is better.

| Operation at scale        | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------- | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000     |    293.65 ms | 347.20 ms |     107.50 ms |  130.90 ms |   2.73x |
| Append a 1,000-row batch  |     90.65 ms | 119.60 ms |      28.60 ms |   34.30 ms |   3.17x |
| Update every 10th at 20k |     98.35 ms | 106.95 ms |       6.00 ms |    9.70 ms |  16.39x |
| Select at 20k             |     94.75 ms | 106.40 ms |       5.00 ms |    8.80 ms |  18.95x |
| Swap at 20k               |    119.15 ms | 132.50 ms |      24.50 ms |   26.40 ms |   4.86x |
| Remove middle row at 20k |    117.85 ms | 151.05 ms |      40.10 ms |   43.00 ms |   2.94x |
| Clear 20k                 |    121.35 ms | 206.70 ms |      21.00 ms |   22.30 ms |   5.78x |

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path                    | Row growth | Timing growth | Normalized growth |
| ----------------------- | ---------: | ------------: | ----------------: |
| Create 10k repeat       |      1.00x |         0.93x |             0.93x |
| Update 10k -> 20k       |      2.00x |         2.40x |             1.20x |
| Select 1k -> 20k        |     20.00x |        20.00x |             1.00x |
| Swap 1k -> 20k          |     20.00x |        22.27x |             1.11x |
| Remove 1k -> 20k        |     20.00x |        16.71x |             0.84x |
| Clear 10k -> 20k        |      2.00x |         2.16x |             1.08x |

This demonstrates approximately linear rather than quadratic growth. Selection still scans the
rows to evaluate the affected binding, so it is not O(1); it performs only the required DOM writes
and remains 18.95x faster than React at 20,000 rows. Structural swap/removal paths are also O(n),
as expected for validating keys and maintaining row indices.

## Bundle cost

| Build                   | Page chunk raw | Page chunk gzip |
| ----------------------- | -------------: | --------------: |
| React baseline          |       18,567 B |         4,307 B |
| Static compiler         |       74,029 B |        15,521 B |
| Hybrid compiler         |       74,029 B |        15,522 B |

This deliberately broad page now pays an 11,215-byte gzip premium for the compiler runtime,
including the mutation-aware keyed path. Smaller direct-only applications retain less of the
runtime; the package-level fixtures and persisted size gate are documented in
`packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 20,000-row mixed workload: all DOM and
event assertions pass, there are no browser errors or owner rerenders, every scale operation beats
the bracketed React baseline, and normalized growth stays at or below 1.20x. The evidence supports
approximately linear scaling within this range, not unlimited or constant-time scaling.

The machine-readable output is `/tmp/farm-react-dashboard-benchmark.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
