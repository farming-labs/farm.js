# js-framework-benchmark results: Linux and Chromium

Harness and correctness result: **PASS.** Farm hybrid records a 1.360x speedup over the official
React Hooks entry by the benchmark's official-weighted geometric mean across the nine CPU
operations. Its median is lower in all nine operations. Against the exact same component source
with the compiler disabled, the official-weighted speedup is 1.454x.

This is a second, separate result set. The Apple M1 and Google Chrome results in
[BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md) are unchanged. The two runs use different hardware,
operating systems and browsers, so compare ratios between builds, not absolute times across runs.
Raw samples and medians are in `BENCHMARK_RESULTS_LINUX_CHROMIUM.json`.

These are local measurements from the official benchmark harness, not an official leaderboard
submission.

## Environment and method

- Date: 2026-11-10
- Farm source: `main` at `fb5cfdc`, with `@farm.js/react` 0.1.0-beta.39 built from that source
- Harness: `krausest/js-framework-benchmark` revision
  `afe7c118dd217ccae4c10813613ac0d7566b1ef1`, the same revision as the M1 run
- Runner: the harness's Playwright Chrome timeline runner, headless
- Browser: Google Chrome for Testing 153.0.8010.12 (Playwright's Chromium build)
- Machine: cloud virtual machine, Intel Xeon @ 2.10 GHz, 4 vCPUs, 15 GiB RAM
- Operating system: Ubuntu 24.04.5 LTS, Linux 6.18
- Runtime: Node.js 22.23.4
- React version: 19.2.0 in every Farm adapter and the official React Hooks entry
- CPU samples: 10 per operation; the harness takes 20 for select row
- Memory samples: 3
- Short-operation CPU slowdown: unchanged from the official harness
- Statistic below: median total timeline duration, including scripting and rendering/paint
- Aggregate: the benchmark's official CPU weights applied to the pairwise median ratios

The Farm off/static/hybrid builds use the exact same component source. The separate `react-hooks`
column is the benchmark repository's optimized React implementation using `memo(Row)`.

All Farm variants and the React Hooks entry passed the official keyed-identity validator for
replacement, removal and row swapping. The CPU, memory and size runs completed with the harness
plausibility checks successful.

The size benchmark launches Chrome through Puppeteer, which Chrome refuses to start as root
without `--no-sandbox` in this container. That run used a wrapper that adds `--no-sandbox` and is
otherwise unchanged. The CPU and memory runs used the browser directly.

## CPU results

Lower time is better. Speedup is official React median divided by hybrid median.

| Official operation  | React Hooks | Compiler off |   Static |   Hybrid | Hybrid vs React |
| ------------------- | ----------: | -----------: | -------: | -------: | --------------: |
| Create 1,000 rows   |     83.0 ms |      81.1 ms |  74.6 ms |  69.4 ms |    1.20x faster |
| Replace 1,000 rows  |     91.9 ms |      95.4 ms |  72.5 ms |  75.3 ms |    1.22x faster |
| Update every 10th   |     62.0 ms |      67.3 ms |  52.8 ms |  49.0 ms |    1.26x faster |
| Select row          |     15.4 ms |      37.7 ms |  10.8 ms |  10.9 ms |    1.42x faster |
| Swap rows 2 and 999 |    333.9 ms |     361.1 ms |  52.3 ms |  54.6 ms |    6.11x faster |
| Remove one row      |     41.3 ms |      46.9 ms |  35.5 ms |  37.5 ms |    1.10x faster |
| Create 10,000 rows  |   1092.3 ms |    1051.8 ms | 746.9 ms | 764.8 ms |    1.43x faster |
| Append 1,000 rows   |     95.1 ms |      96.8 ms |  84.4 ms |  74.2 ms |    1.28x faster |
| Clear rows          |     52.4 ms |      51.3 ms |  29.6 ms |  31.0 ms |    1.69x faster |

Official-weighted pairwise geometric-mean results:

| Comparison                                | Speedup | Weighted time reduction |
| ----------------------------------------- | ------: | ----------------------: |
| Hybrid vs official React Hooks            |  1.360x |                   26.5% |
| Static vs official React Hooks            |  1.337x |                   25.2% |
| Hybrid vs exact same source, compiler off |  1.454x |                   31.2% |

For transparency, the corresponding unweighted geometric means are 1.560x, 1.550x and 1.773x.
They are retained in the raw JSON as diagnostics, but are not the headline because the upstream
benchmark uses fixed CPU weights for its overall score.

On every operation, the gap between static and hybrid medians is smaller than one standard
deviation of the noisier of the two, so this run does not separate them. A shared cloud VM is noisier than a dedicated laptop: total-time standard
deviations reach about 15 ms on swap rows for both React Hooks and hybrid, for example.

## Compared with the M1 run

Same harness revision, same React version, different machine, browser and Farm source. Each ratio
is React Hooks median divided by hybrid median within one run.

| Operation           | M1 hybrid vs React | Linux hybrid vs React |
| ------------------- | -----------------: | --------------------: |
| Create 1,000 rows   |              1.11x |                 1.20x |
| Replace 1,000 rows  |              1.20x |                 1.22x |
| Update every 10th   |              1.02x |                 1.26x |
| Select row          |              1.41x |                 1.42x |
| Swap rows 2 and 999 |              4.92x |                 6.11x |
| Remove one row      |              0.99x |                 1.10x |
| Create 10,000 rows  |              1.77x |                 1.43x |
| Append 1,000 rows   |              1.04x |                 1.28x |
| Clear rows          |              1.80x |                 1.69x |
| Official-weighted   |             1.286x |                1.360x |

The compiler-on versus compiler-off result is the same on both machines (1.454x weighted). The two
operations that were near-ties on the M1, update every 10th and remove one row, are clear wins
here: hybrid scripting time is 4.7 ms against 12.5 ms for update, and 1.9 ms against 2.7 ms for
removal. Creating 10,000 rows and clearing rows gain less here than on the M1. This report does not attribute
these differences to a single cause: hardware, browser version and compiler changes since the M1
run all differ.

## Memory and size

Memory is in MB. Size is the official benchmark's transferred KiB measurement.

| Metric                             | React Hooks | Compiler off |    Static |    Hybrid | Hybrid vs React |
| ---------------------------------- | ----------: | -----------: | --------: | --------: | --------------: |
| Ready memory                       |    1.607 MB |     1.640 MB |  1.757 MB |  1.795 MB |      11.7% more |
| Memory after 1,000 rows            |    4.942 MB |     4.747 MB |  3.530 MB |  3.529 MB |      28.6% less |
| Memory after five run/clear cycles |    2.487 MB |     2.928 MB |  2.238 MB |  2.249 MB |       9.6% less |
| Uncompressed transfer              |   190.3 KiB |    189.1 KiB | 229.5 KiB | 229.5 KiB |   39.2 KiB more |
| Compressed transfer                |    51.4 KiB |     50.9 KiB |  60.7 KiB |  60.7 KiB |    9.3 KiB more |

The compiled runtime costs 9.3 KiB compressed and about 0.19 MB at idle versus official React.
Once the table contains 1,000 rows, compiler ownership uses about 1.41 MB less memory. Compared
with the M1 run's artifacts, the compiled builds are 26.1 KiB smaller uncompressed and 2.0 KiB
smaller compressed; transfer size does not depend on the machine.

The official size benchmark also records one first-paint sample (React 429.7 ms, compiler off
390.1 ms, static 501.7 ms, hybrid 473.7 ms). As in the M1 run, a single sample is order-sensitive,
so it is retained in the raw JSON but is not used for the CPU conclusion.

## Conclusion

On this Linux and Chromium machine, hybrid has a lower median than the official React Hooks entry
on all nine CPU operations, and the official-weighted speedup is 1.360x. The M1 run's near-ties on
update and removal do not recur here. The remaining measured tradeoffs are the 9.3 KiB compressed
runtime, down from 11.3 KiB in the M1 run, and about 0.19 MB of extra idle memory, the same as in
the M1 run.
