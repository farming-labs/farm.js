# Complex dashboard and 20,000-row scale result

Date: 2026-08-27

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
workloads compiled, delegated keyed rows were present only in compiler builds, and hybrid/static
added zero owner executions. The two React baselines added 1,430 dashboard and 261 table owner
executions each.

## Complex dashboard

The dashboard contains metrics, branch-sensitive panels, interactive controls, and 96 chart
bindings.

| Interaction                 | React median | Hybrid median | Hybrid vs React |
| --------------------------- | -----------: | ------------: | --------------: |
| Active live pulse           |     0.100 ms |      0.080 ms |    1.25x faster |
| Inactive branch update      |     0.070 ms |      0.020 ms |    3.50x faster |
| Switch live/snapshot branch |     0.100 ms |      0.100 ms |          parity |

## Standard table operations

| Operation         |            Rows | React median | Hybrid median | Hybrid vs React |
| ----------------- | --------------: | -----------: | ------------: | --------------: |
| Create            |           1,000 |     12.60 ms |      11.20 ms |    1.13x faster |
| Replace all       |           1,000 |     18.65 ms |      11.80 ms |    1.58x faster |
| Create many       |          10,000 |    287.35 ms |     124.20 ms |    2.31x faster |
| Append            | 10,000 -> 11,000 |     74.40 ms |      29.30 ms |    2.54x faster |
| Update every 10th |          10,000 |     47.05 ms |       9.90 ms |    4.75x faster |
| Select            |           1,000 |      4.10 ms |       0.20 ms |   20.50x faster |
| Swap rows 2 / 999 |           1,000 |      9.20 ms |       1.20 ms |    7.67x faster |
| Remove one row    |           1,000 |      4.60 ms |       2.00 ms |    2.30x faster |
| Clear             |          10,000 |     49.05 ms |       9.70 ms |    5.06x faster |

## Repeated 20,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, updates
2,000 rows, performs two distant selections, swaps rows, removes a middle row, and clears. Lower
time is better.

| Operation at scale        | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------- | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000     |    306.60 ms | 370.30 ms |     128.90 ms |  133.70 ms |   2.38x |
| Append a 1,000-row batch  |     88.80 ms | 117.95 ms |      29.80 ms |   34.50 ms |   2.98x |
| Update every 10th at 20k |    104.65 ms | 133.35 ms |      20.50 ms |   22.20 ms |   5.10x |
| Select at 20k             |     96.20 ms | 143.50 ms |       4.60 ms |    6.90 ms |  20.91x |
| Swap at 20k               |    113.00 ms | 123.25 ms |      24.40 ms |   26.40 ms |   4.63x |
| Remove middle row at 20k |    111.10 ms | 116.65 ms |      40.00 ms |   52.30 ms |   2.78x |
| Clear 20k                 |    167.25 ms | 255.60 ms |      20.70 ms |   23.50 ms |   8.08x |

The earlier one-off removal tail was not reproduced in the scale cycles: hybrid removal ranged
from 39.9 to 52.3 ms, versus React's 101.2 to 122.7 ms.

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path                    | Row growth | Timing growth | Normalized growth |
| ----------------------- | ---------: | ------------: | ----------------: |
| Create 10k repeat       |      1.00x |         1.04x |             1.04x |
| Update 10k -> 20k       |      2.00x |         2.07x |             1.04x |
| Select 1k -> 20k        |     20.00x |        18.40x |             0.92x |
| Swap 1k -> 20k          |     20.00x |        20.33x |             1.02x |
| Remove 1k -> 20k        |     20.00x |        20.00x |             1.00x |
| Clear 10k -> 20k        |      2.00x |         2.13x |             1.07x |

This demonstrates approximately linear rather than quadratic growth. Selection still scans the
rows to evaluate the affected binding, so it is not O(1); it performs only the required DOM writes
and remains 20.91x faster than React at 20,000 rows. Structural swap/removal paths are also O(n),
as expected for validating keys and maintaining row indices.

## Bundle cost

| Build                   | Page chunk raw | Page chunk gzip |
| ----------------------- | -------------: | --------------: |
| React baseline          |       18,567 B |         4,306 B |
| Static compiler         |       71,688 B |        14,783 B |
| Hybrid compiler         |       71,688 B |        14,785 B |

This deliberately broad page now pays a 10,479-byte gzip premium for the compiler runtime. Static
capability selection removes 22,915 raw bytes and 3,150 gzip bytes from the previous hybrid page
chunk while preserving every benchmark scenario. Smaller direct-only applications retain less of
the runtime; the package-level fixtures and persisted size gate are documented in
`packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 20,000-row mixed workload: all DOM and
event assertions pass, there are no browser errors or owner rerenders, every scale operation beats
the bracketed React baseline, and normalized growth stays below 1.07x. The evidence supports
approximately linear scaling within this range, not unlimited or constant-time scaling.

The machine-readable output is `/tmp/farm-react-dashboard-scale-final.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
