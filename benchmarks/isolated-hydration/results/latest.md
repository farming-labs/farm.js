# Isolated hydration benchmark

Generated 2026-09-09T17:51:39.929Z on darwin arm64, Node v24.11.0, 153.0.8010.36.
40 measured browser iterations after 10 warmups, and 25 measured server iterations after 5 warmups. Latency cells show p50; raw samples, p95, and bootstrap median confidence intervals are in `latest.json`.

## Transfer and document cost

| shape     | mode                | client JS raw | client JS gzip | client JS Brotli | chunks |      HTML |  markers |
| --------- | ------------------- | ------------: | -------------: | ---------------: | -----: | --------: | -------: |
| leaf      | route-wide          |     381.1 KiB |       78.8 KiB |         64.4 KiB |      2 | 111.9 KiB |  0.0 KiB |
| leaf      | isolated            |     235.8 KiB |       72.7 KiB |         63.4 KiB |      3 | 112.2 KiB |  0.3 KiB |
| leaf      | route-wide-compiler |     410.6 KiB |       86.3 KiB |         70.2 KiB |      2 | 111.9 KiB |  0.0 KiB |
| leaf      | isolated-compiler   |     265.1 KiB |       80.6 KiB |         70.6 KiB |      3 | 112.2 KiB |  0.3 KiB |
| leaf      | rsc                 |     226.5 KiB |       71.1 KiB |         61.0 KiB |      2 | 222.3 KiB |  0.0 KiB |
| siblings  | route-wide          |     305.1 KiB |       74.4 KiB |         62.6 KiB |      2 |  58.3 KiB |  0.0 KiB |
| siblings  | isolated            |     238.1 KiB |       74.2 KiB |         64.7 KiB |      7 |  59.4 KiB |  1.2 KiB |
| siblings  | route-wide-compiler |     335.2 KiB |       82.1 KiB |         69.1 KiB |      2 |  58.3 KiB |  0.0 KiB |
| siblings  | isolated-compiler   |     268.1 KiB |       82.5 KiB |         72.2 KiB |      7 |  59.4 KiB |  1.2 KiB |
| siblings  | rsc                 |     227.7 KiB |       71.0 KiB |         61.0 KiB |      2 | 114.2 KiB |  0.0 KiB |
| stress-8  | route-wide          |     250.9 KiB |       71.4 KiB |         61.6 KiB |      2 |  20.1 KiB |  0.0 KiB |
| stress-8  | isolated            |     236.7 KiB |       75.4 KiB |         65.7 KiB |     11 |  22.3 KiB |  2.3 KiB |
| stress-16 | route-wide          |     253.3 KiB |       71.6 KiB |         61.7 KiB |      2 |  21.3 KiB |  0.0 KiB |
| stress-16 | isolated            |     242.3 KiB |       78.7 KiB |         68.4 KiB |     19 |  25.9 KiB |  4.6 KiB |
| stress-32 | route-wide          |     258.3 KiB |       72.0 KiB |         61.9 KiB |      2 |  23.7 KiB |  0.0 KiB |
| stress-32 | isolated            |     253.5 KiB |       85.3 KiB |         73.7 KiB |     35 |  32.9 KiB |  9.3 KiB |
| stress-64 | route-wide          |     268.1 KiB |       72.7 KiB |         62.2 KiB |      2 |  28.5 KiB |  0.0 KiB |
| stress-64 | isolated            |     276.0 KiB |       98.5 KiB |         84.2 KiB |     67 |  47.1 KiB | 18.6 KiB |

## Server and browser cost

Requests are reported as total / script resources / executed script resources.

| shape     | mode                | SSR response |   script | compile | hydration | first interaction | steady update |     requests |       heap | roots | warm nav |
| --------- | ------------------- | -----------: | -------: | ------: | --------: | ----------------: | ------------: | -----------: | ---------: | ----: | -------: |
| leaf      | route-wide          |      3.30 ms | 19.20 ms | 0.08 ms |  64.60 ms |           1.90 ms |       0.04 ms |    3 / 1 / 2 | 3194.9 KiB |     1 |  2.40 ms |
| leaf      | isolated            |      3.35 ms |  8.42 ms | 0.07 ms |  55.90 ms |           1.90 ms |       0.03 ms |    4 / 2 / 3 | 2369.7 KiB |     1 |  1.40 ms |
| leaf      | route-wide-compiler |      3.31 ms | 19.54 ms | 0.08 ms |  66.00 ms |           1.30 ms |       0.01 ms |    3 / 1 / 2 | 3207.1 KiB |     1 |  2.30 ms |
| leaf      | isolated-compiler   |      3.33 ms |  8.38 ms | 0.08 ms |  59.40 ms |           1.30 ms |       0.02 ms |    4 / 2 / 3 | 2357.9 KiB |     1 |  1.40 ms |
| leaf      | rsc                 |      7.40 ms | 16.68 ms | 0.27 ms |  56.80 ms |           2.10 ms |       0.03 ms |    3 / 2 / 3 | 2397.5 KiB |     1 | 15.30 ms |
| siblings  | route-wide          |      2.28 ms | 13.56 ms | 0.07 ms |  48.30 ms |           1.80 ms |       0.03 ms |    3 / 1 / 2 | 2727.3 KiB |     1 |  1.60 ms |
| siblings  | isolated            |      2.52 ms |  8.53 ms | 0.07 ms |  49.60 ms |           1.60 ms |       0.02 ms |    8 / 6 / 7 | 2501.2 KiB |     4 |  1.00 ms |
| siblings  | route-wide-compiler |      2.16 ms | 13.91 ms | 0.07 ms |  48.30 ms |           1.30 ms |       0.01 ms |    3 / 1 / 2 | 2787.6 KiB |     1 |  1.60 ms |
| siblings  | isolated-compiler   |      2.55 ms |  8.77 ms | 0.07 ms |  49.30 ms |           1.30 ms |       0.01 ms |    8 / 6 / 7 | 2579.9 KiB |     4 |  0.90 ms |
| siblings  | rsc                 |      5.51 ms | 16.46 ms | 0.15 ms |  47.30 ms |           2.00 ms |       0.02 ms |    3 / 2 / 3 | 2354.0 KiB |     1 |  5.40 ms |
| stress-8  | route-wide          |      1.21 ms | 10.03 ms | 0.07 ms |  37.50 ms |           1.70 ms |       0.02 ms |    3 / 1 / 2 | 2601.9 KiB |     1 |  1.00 ms |
| stress-8  | isolated            |      1.30 ms |  8.47 ms | 0.07 ms |  47.20 ms |           1.60 ms |       0.02 ms | 12 / 10 / 11 | 2647.4 KiB |     8 |  0.60 ms |
| stress-16 | route-wide          |      1.34 ms | 10.55 ms | 0.07 ms |  40.20 ms |           1.80 ms |       0.03 ms |    3 / 1 / 2 | 2637.2 KiB |     1 |  1.10 ms |
| stress-16 | isolated            |      1.34 ms |  9.03 ms | 0.07 ms |  51.30 ms |           1.60 ms |       0.02 ms | 20 / 18 / 19 | 2593.7 KiB |    16 |  0.80 ms |
| stress-32 | route-wide          |      1.65 ms | 10.64 ms | 0.07 ms |  43.20 ms |           1.70 ms |       0.03 ms |    3 / 1 / 2 | 2698.9 KiB |     1 |  1.10 ms |
| stress-32 | isolated            |      2.94 ms | 10.92 ms | 0.07 ms |  64.50 ms |           1.60 ms |       0.02 ms | 36 / 34 / 35 | 2906.5 KiB |    32 |  0.80 ms |
| stress-64 | route-wide          |      1.46 ms | 11.54 ms | 0.07 ms |  40.20 ms |           1.80 ms |       0.03 ms |    3 / 1 / 2 | 2849.4 KiB |     1 |  1.30 ms |
| stress-64 | isolated            |      2.03 ms | 13.77 ms | 0.07 ms |  75.00 ms |           1.60 ms |       0.02 ms | 68 / 66 / 67 | 3784.5 KiB |    64 |  0.90 ms |

The first measured stress regression beyond the 5% or confidence-interval budget occurred at 8 independent roots. The deterministic guard therefore keeps plans with 4 or fewer statically bounded isolated roots and sends larger or data-dependent plans through route-wide hydration.

The RSC rows are controls built with Farm's RSC plugin and optimized server boundary enabled. They use the same layout, counters, and navigation workload; they are not treated as route-wide fallbacks for the standard renderer.

The compiler rows enable Farm's experimental React compiler for the same route-wide and isolated fixtures. The build fails unless every counter appears in the compiler report. Steady update measures ten sequential state updates per sample and records owner executions: the React control must rerun its owner while the compiled control must keep that count unchanged. The combined path must preserve the isolated startup benefit and show the compiler's direct-update benefit without relying on a silent fallback.
