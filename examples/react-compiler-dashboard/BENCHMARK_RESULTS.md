# Complex dashboard and 20,000-row scale result

Date: 2026-08-28

Result: **PASS.** Correctness, the React-relative performance gate, the keyed-update and
key-directed selection persistence gates, and the normalized scalability gate all pass. The
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
- No CPU throttling

Every trial passed DOM assertions and browser-error checks. The compiler report proved that both
workloads compiled, delegated keyed rows were present only in compiler builds, exactly two
key-directed row bindings and one mutation-aware keyed-map update site were emitted, and
hybrid/static added zero owner executions. The two React baselines added 1,430 dashboard and 261
table owner executions each.

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
| Create            |           1,000 |     11.55 ms |      10.40 ms |    1.11x faster |
| Replace all       |           1,000 |     15.85 ms |      11.30 ms |    1.40x faster |
| Create many       |          10,000 |    265.65 ms |     112.90 ms |    2.35x faster |
| Append            | 10,000 -> 11,000 |     71.90 ms |      25.30 ms |    2.84x faster |
| Update every 10th |          10,000 |     40.35 ms |       2.40 ms |   16.81x faster |
| Select            |           1,000 |      3.70 ms |       0.10 ms |   37.00x faster |
| Swap rows 2 / 999 |           1,000 |      7.80 ms |       1.10 ms |    7.09x faster |
| Remove one row    |           1,000 |      4.20 ms |       2.00 ms |    2.10x faster |
| Clear             |          10,000 |     50.40 ms |       9.30 ms |    5.42x faster |

`Update every 10th` is the targeted mutation-aware path. The application still executes its native
immutable `map()` over 10,000 items and creates 1,000 replacement objects. The generated hint lets
the keyed runtime validate and patch those 1,000 rows without a second scan of all 10,000 keys and
bindings. The 8x persistence floor leaves substantial headroom below this run's 15.76x-16.81x
result across compiler modes and row counts while still rejecting a silent return to the older
roughly 5x full-reconciliation path.

`Select` is the key-directed path added by this result. When a primitive state value is compared
strictly with the exact row key, the compiler records that identity proof. The runtime then reads
and patches only the previous and next keyed instances instead of evaluating that binding for every
row. Package tests deterministically require no more than two row-binding reads per transition; the
browser boundary still includes event dispatch, style invalidation, and DOM observation.

## Repeated 20,000-row scale profile

Each of the three cycles creates 10,000 rows, appends ten 1,000-row batches to 20,000, updates
2,000 rows, performs two distant selections, swaps rows, removes a middle row, and clears. Lower
time is better.

| Operation at scale        | React median | React p95 | Hybrid median | Hybrid p95 | Speedup |
| ------------------------- | -----------: | --------: | ------------: | ---------: | ------: |
| Create initial 10,000     |    337.70 ms | 399.90 ms |     121.90 ms |  130.20 ms |   2.77x |
| Append a 1,000-row batch  |     84.85 ms | 114.20 ms |      27.40 ms |   36.50 ms |   3.10x |
| Update every 10th at 20k |     96.15 ms | 103.35 ms |       6.10 ms |    6.30 ms |  15.76x |
| Select at 20k             |     90.55 ms | 114.70 ms |       2.70 ms |    4.80 ms |  33.54x |
| Swap at 20k               |    112.80 ms | 138.10 ms |      26.00 ms |   26.80 ms |   4.34x |
| Remove middle row at 20k |    103.50 ms | 117.80 ms |      36.40 ms |   37.80 ms |   2.84x |
| Clear 20k                 |    206.10 ms | 240.65 ms |      19.90 ms |   21.30 ms |  10.36x |

## Scalability gate

The gate divides observed timing growth by row-count growth. A value near 1 means linear scaling;
2 is the failure threshold. All measured paths pass.

| Path                    | Row growth | Timing growth | Normalized growth |
| ----------------------- | ---------: | ------------: | ----------------: |
| Create 10k repeat       |      1.00x |         1.08x |             1.08x |
| Update 10k -> 20k       |      2.00x |         2.54x |             1.27x |
| Select 1k -> 20k        |     20.00x |        10.80x |             0.54x |
| Swap 1k -> 20k          |     20.00x |        23.64x |             1.18x |
| Remove 1k -> 20k        |     20.00x |        18.20x |             0.91x |
| Clear 10k -> 20k        |      2.00x |         2.14x |             1.07x |

This demonstrates approximately linear rather than quadratic end-to-end growth. Key-directed
selection performs constant row-binding work—at most the previous and next keyed instances—while
its complete event-to-DOM timing remains 33.54x faster than React at 20,000 rows. Structural
swap/removal paths remain O(n), as expected for validating keys and maintaining row indices.

## Bundle cost

| Build                   | Page chunk raw | Page chunk gzip |
| ----------------------- | -------------: | --------------: |
| React baseline          |       18,567 B |         4,307 B |
| Static compiler         |       75,139 B |        15,854 B |
| Hybrid compiler         |       75,139 B |        15,854 B |

This deliberately broad page now pays an 11,547-byte gzip premium for the compiler runtime,
including the mutation-aware and key-directed keyed paths. Smaller direct-only applications retain
less of the runtime; the package-level fixtures and persisted size gate are documented in
`packages/farm-react/RUNTIME_SIZE_RESULTS.md`.

## Conclusion

The compiled path scales successfully through the tested 20,000-row mixed workload: all DOM and
event assertions pass, there are no browser errors or owner rerenders, every scale operation beats
the bracketed React baseline, and normalized growth stays at or below 1.27x. Selection performs at
most two row-binding reads, but the evidence claims only measured end-to-end behavior within this
range—not unlimited constant-time browser work.

The machine-readable output is `/tmp/farm-react-dashboard-benchmark.json`. Re-run
`pnpm --filter farm-react-compiler-dashboard-example benchmark` to reproduce it.
