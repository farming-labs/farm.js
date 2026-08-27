# js-framework-benchmark results

Result: **PASS.** Farm hybrid is 1.465x faster than the official React Hooks entry across the
nine CPU operations by pairwise geometric mean and wins eight of nine individual operations. It
is 1.755x faster than the exact same component source with the compiler disabled.

These are local measurements from the official benchmark harness, not an official leaderboard
submission.

## Environment and method

- Date: 2026-08-27
- Harness: `krausest/js-framework-benchmark` revision
  `afe7c118dd217ccae4c10813613ac0d7566b1ef1`
- Runner: the harness's Playwright Chrome timeline runner, headless
- Browser: Google Chrome 151.0.7922.174
- Machine: MacBook Pro, Apple M1, 8 cores, 16 GB RAM
- Operating system: macOS 26.2 (25C56)
- Runtime: Node.js 23.11.0
- React version: 19.2.0 in every Farm adapter and the official React Hooks entry
- CPU samples: 10 requested per operation; the harness adds its configured extra samples to short
  operations such as selection
- Memory samples: 3
- Short-operation CPU slowdown: unchanged from the official harness
- Statistic below: median total timeline duration, including scripting and rendering/paint

The Farm off/static/hybrid builds use the exact same component source. The separate `react-hooks`
column is the benchmark repository's optimized React implementation using `memo(Row)`.

All Farm variants passed the official keyed-identity validator for replacement, removal, and row
swapping. The full CPU, memory, and size runs completed with the harness plausibility checks
successful.

## CPU results

Lower time is better. Speedup is official React median divided by hybrid median.

| Official operation  | React Hooks | Compiler off |   Static |   Hybrid | Hybrid vs React |
| ------------------- | ----------: | -----------: | -------: | -------: | --------------: |
| Create 1,000 rows   |     38.4 ms |      36.8 ms |  34.3 ms |  34.5 ms |    1.11x faster |
| Replace 1,000 rows  |     46.0 ms |      43.5 ms |  37.7 ms |  38.3 ms |    1.20x faster |
| Update every 10th   |     22.9 ms |      30.6 ms |  22.2 ms |  22.3 ms |     2.5% faster |
| Select row          |      8.2 ms |      20.8 ms |   5.8 ms |   5.8 ms |    1.41x faster |
| Swap rows 2 and 999 |    133.2 ms |     150.9 ms |  26.9 ms |  27.1 ms |    4.92x faster |
| Remove one row      |     17.3 ms |      23.5 ms |  18.8 ms |  17.6 ms |     1.4% slower |
| Create 10,000 rows  |    617.3 ms |     652.7 ms | 348.9 ms | 349.7 ms |    1.77x faster |
| Append 1,000 rows   |     42.6 ms |      45.6 ms |  41.3 ms |  41.0 ms |     3.9% faster |
| Clear rows          |     23.1 ms |      22.0 ms |  12.6 ms |  12.8 ms |    1.80x faster |

Pairwise geometric-mean results:

| Comparison                                | Speedup | Geometric-mean time reduction |
| ----------------------------------------- | ------: | ----------------------------: |
| Hybrid vs official React Hooks            |  1.465x |                         31.8% |
| Static vs official React Hooks            |  1.461x |                         31.6% |
| Hybrid vs exact same source, compiler off |  1.755x |                         43.0% |

Hybrid wins eight of nine operations. Removal is the only measured loss and is effectively tied:
the total median differs by 0.25 ms (17.55 vs 17.30 ms), while scripting differs by 0.15 ms (1.55
vs 1.40 ms). Browser rendering noise is larger than that margin, so this report does not claim an
all-nine win.

The compiler optimization is generic rather than tied to benchmark field names or values:

- each compiled row binding carries the state cells its expression depends on;
- each keyed collection carries the state cells that can change its items or keys;
- a non-structural state change evaluates only bindings whose dependencies intersect the dirty
  state set;
- unchanged key order bypasses map/LIS/movement work, while an order-preserving single removal
  bypasses the general keyed reconciler;
- rows without conditionals share empty bookkeeping and the removal path deletes only the removed
  row's records.

Compared with the preceding recorded run, the three formerly weak operations improved as follows.
These are separate local runs, so the delta includes ordinary run-to-run variation.

| Operation         | Previous hybrid | Current hybrid |       Change |
| ----------------- | --------------: | -------------: | -----------: |
| Update every 10th |         25.6 ms |        22.3 ms | 12.9% faster |
| Select row        |         11.7 ms |         5.8 ms | 50.4% faster |
| Remove one row    |         19.8 ms |        17.6 ms | 11.4% faster |

## Memory and size

Memory is in MB. Size is the official benchmark's transferred KiB measurement.

| Metric                             | React Hooks | Compiler off |    Static |    Hybrid | Hybrid vs React |
| ---------------------------------- | ----------: | -----------: | --------: | --------: | --------------: |
| Ready memory                       |    1.637 MB |     1.654 MB |  1.822 MB |  1.826 MB |      11.6% more |
| Memory after 1,000 rows            |    4.932 MB |     4.677 MB |  3.385 MB |  3.351 MB |      32.1% less |
| Memory after five run/clear cycles |    2.470 MB |     2.904 MB |  2.222 MB |  2.238 MB |       9.4% less |
| Uncompressed transfer              |   190.3 KiB |    192.0 KiB | 255.6 KiB | 255.6 KiB |   65.3 KiB more |
| Compressed transfer                |    51.4 KiB |     51.8 KiB |  62.6 KiB |  62.7 KiB |   11.3 KiB more |

The compiled runtime costs 11.3 KiB compressed and about 0.19 MB at idle versus official React.
Once the table contains 1,000 rows, compiler ownership uses about 1.58 MB less memory. Relative to
the preceding build, this optimization added about 2.5 KiB uncompressed and 0.4 KiB compressed to
the official production artifact. Runtime splitting and tree-shakable keyed-only helpers remain
the main bundle-size opportunity.

The official size benchmark also records one first-paint sample. That single sample was
order-sensitive in this local run (React 379.8 ms, compiler off 370.5 ms, static 458.1 ms, hybrid
446.8 ms), so it is retained in the raw JSON but is not used for the CPU conclusion.

## Conclusion

The dependency-indexed compiled path removes the former update and selection losses without
special-case equality descriptors or benchmark-specific behavior. It also reduces removal time
and populated-table memory. The remaining measured tradeoffs are the near-tie on removal and the
11.3 KiB compressed runtime delta.
