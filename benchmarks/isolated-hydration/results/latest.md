# Isolated hydration benchmark

Generated 2026-09-07T16:51:56.034Z on darwin arm64, Node v24.11.0, 152.0.7977.82.
25 measured browser and server iterations after 5 warmups. Latency cells show p50; raw samples, p95, and bootstrap median confidence intervals are in `latest.json`.

## Transfer and document cost

| shape     | mode       | client JS raw | client JS gzip | client JS Brotli | chunks |      HTML |  markers |
| --------- | ---------- | ------------: | -------------: | ---------------: | -----: | --------: | -------: |
| leaf      | route-wide |     376.5 KiB |       78.3 KiB |         64.0 KiB |      2 | 108.9 KiB |  0.0 KiB |
| leaf      | isolated   |     231.2 KiB |       72.1 KiB |         63.2 KiB |      3 | 109.2 KiB |  0.3 KiB |
| leaf      | rsc        |     222.3 KiB |       70.6 KiB |         60.7 KiB |      2 | 219.3 KiB |  0.0 KiB |
| siblings  | route-wide |     300.1 KiB |       74.1 KiB |         62.5 KiB |      2 |  55.1 KiB |  0.0 KiB |
| siblings  | isolated   |     233.1 KiB |       73.4 KiB |         64.2 KiB |      7 |  56.2 KiB |  1.2 KiB |
| siblings  | rsc        |     223.1 KiB |       70.8 KiB |         60.8 KiB |      2 | 110.9 KiB |  0.0 KiB |
| stress-8  | route-wide |     249.4 KiB |       71.2 KiB |         61.5 KiB |      2 |  19.3 KiB |  0.0 KiB |
| stress-8  | isolated   |     235.3 KiB |       74.8 KiB |         65.2 KiB |     11 |  21.6 KiB |  2.3 KiB |
| stress-16 | route-wide |     250.6 KiB |       71.3 KiB |         61.5 KiB |      2 |  19.7 KiB |  0.0 KiB |
| stress-16 | isolated   |     239.7 KiB |       77.5 KiB |         67.4 KiB |     19 |  24.3 KiB |  4.6 KiB |
| stress-32 | route-wide |     253.1 KiB |       71.6 KiB |         61.6 KiB |      2 |  20.6 KiB |  0.0 KiB |
| stress-32 | isolated   |     248.5 KiB |       83.0 KiB |         71.8 KiB |     35 |  29.9 KiB |  9.3 KiB |
| stress-64 | route-wide |     257.9 KiB |       72.0 KiB |         62.0 KiB |      2 |  22.3 KiB |  0.0 KiB |
| stress-64 | isolated   |     266.1 KiB |       93.9 KiB |         80.2 KiB |     67 |  40.9 KiB | 18.6 KiB |

## Server and browser cost

Requests are reported as total / script resources / executed script resources.

| shape     | mode       | SSR response |   script | compile | hydration | first interaction |     requests |       heap | roots | warm nav |
| --------- | ---------- | -----------: | -------: | ------: | --------: | ----------------: | -----------: | ---------: | ----: | -------: |
| leaf      | route-wide |      3.30 ms | 17.26 ms | 0.07 ms |  56.20 ms |           1.60 ms |    3 / 1 / 2 | 3131.8 KiB |     1 |  2.30 ms |
| leaf      | isolated   |      3.62 ms |  7.00 ms | 0.06 ms |  47.40 ms |           1.40 ms |    4 / 2 / 3 | 2236.2 KiB |     1 |  1.30 ms |
| leaf      | rsc        |      7.71 ms | 15.97 ms | 0.26 ms |  52.40 ms |           1.70 ms |    3 / 2 / 3 | 2312.1 KiB |     1 | 14.80 ms |
| siblings  | route-wide |      2.74 ms | 12.97 ms | 0.06 ms |  52.00 ms |           1.50 ms |    3 / 1 / 2 | 2673.0 KiB |     1 |  1.60 ms |
| siblings  | isolated   |      1.99 ms |  7.84 ms | 0.07 ms |  49.10 ms |           1.40 ms |    8 / 6 / 7 | 2418.0 KiB |     4 |  0.90 ms |
| siblings  | rsc        |      6.46 ms | 17.08 ms | 0.18 ms |  61.20 ms |           1.80 ms |    3 / 2 / 3 | 2277.5 KiB |     1 | 10.20 ms |
| stress-8  | route-wide |      1.18 ms | 11.31 ms | 0.07 ms |  51.20 ms |           1.60 ms |    3 / 1 / 2 | 2547.6 KiB |     1 |  1.20 ms |
| stress-8  | isolated   |      1.82 ms |  8.74 ms | 0.07 ms |  72.20 ms |           1.60 ms | 12 / 10 / 11 | 2608.8 KiB |     8 |  0.80 ms |
| stress-16 | route-wide |      1.62 ms | 10.47 ms | 0.07 ms |  51.10 ms |           1.70 ms |    3 / 1 / 2 | 2586.4 KiB |     1 |  1.10 ms |
| stress-16 | isolated   |      2.28 ms |  8.99 ms | 0.07 ms |  66.40 ms |           1.40 ms | 20 / 18 / 19 | 2536.3 KiB |    16 |  0.80 ms |
| stress-32 | route-wide |      1.33 ms | 10.51 ms | 0.06 ms |  50.50 ms |           1.70 ms |    3 / 1 / 2 | 2638.5 KiB |     1 |  1.10 ms |
| stress-32 | isolated   |      2.10 ms | 11.72 ms | 0.07 ms |  89.70 ms |           1.60 ms | 36 / 34 / 35 | 2855.9 KiB |    32 |  0.90 ms |
| stress-64 | route-wide |      1.97 ms | 11.32 ms | 0.07 ms |  57.70 ms |           1.70 ms |    3 / 1 / 2 | 2730.2 KiB |     1 |  1.20 ms |
| stress-64 | isolated   |      2.26 ms | 13.57 ms | 0.06 ms |  89.00 ms |           1.50 ms | 68 / 66 / 67 | 3695.8 KiB |    64 |  1.00 ms |

The first measured stress regression beyond the 5% or confidence-interval budget occurred at 8 independent roots. The deterministic guard therefore keeps plans with 4 or fewer statically bounded isolated roots and sends larger or data-dependent plans through route-wide hydration.

The RSC rows are controls built with Farm's RSC plugin and optimized server boundary enabled. They use the same layout, counters, and navigation workload; they are not treated as route-wide fallbacks for the standard renderer.
