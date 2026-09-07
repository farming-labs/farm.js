# Isolated hydration benchmark

Generated 2026-09-07T14:34:28.566Z on darwin arm64, Node v23.11.0, 152.0.7977.82.
25 measured browser and server iterations after 5 warmups. Latency cells show p50; raw samples, p95, and bootstrap median confidence intervals are in `latest.json`.

## Transfer and document cost

| shape     | mode       | client JS raw | client JS gzip | client JS Brotli | chunks |      HTML |  markers |
| --------- | ---------- | ------------: | -------------: | ---------------: | -----: | --------: | -------: |
| leaf      | route-wide |     374.3 KiB |       77.6 KiB |         63.5 KiB |      2 | 108.9 KiB |  0.0 KiB |
| leaf      | isolated   |     228.8 KiB |       71.4 KiB |         62.6 KiB |      3 | 109.2 KiB |  0.3 KiB |
| leaf      | rsc        |     222.3 KiB |       70.4 KiB |         60.7 KiB |      2 | 219.3 KiB |  0.0 KiB |
| siblings  | route-wide |     297.9 KiB |       73.5 KiB |         62.0 KiB |      2 |  55.1 KiB |  0.0 KiB |
| siblings  | isolated   |     230.7 KiB |       72.7 KiB |         63.7 KiB |      7 |  56.2 KiB |  1.2 KiB |
| siblings  | rsc        |     223.1 KiB |       70.6 KiB |         60.9 KiB |      2 | 110.9 KiB |  0.0 KiB |
| stress-8  | route-wide |     247.2 KiB |       70.5 KiB |         61.0 KiB |      2 |  19.3 KiB |  0.0 KiB |
| stress-8  | isolated   |     232.9 KiB |       74.0 KiB |         64.8 KiB |     11 |  21.6 KiB |  2.3 KiB |
| stress-16 | route-wide |     248.4 KiB |       70.7 KiB |         61.0 KiB |      2 |  19.7 KiB |  0.0 KiB |
| stress-16 | isolated   |     237.3 KiB |       76.8 KiB |         66.8 KiB |     19 |  24.3 KiB |  4.6 KiB |
| stress-32 | route-wide |     250.9 KiB |       70.9 KiB |         61.2 KiB |      2 |  20.6 KiB |  0.0 KiB |
| stress-32 | isolated   |     246.1 KiB |       82.3 KiB |         71.1 KiB |     35 |  29.9 KiB |  9.3 KiB |
| stress-64 | route-wide |     255.7 KiB |       71.3 KiB |         61.3 KiB |      2 |  22.3 KiB |  0.0 KiB |
| stress-64 | isolated   |     263.8 KiB |       93.1 KiB |         80.0 KiB |     67 |  40.9 KiB | 18.6 KiB |

## Server and browser cost

Requests are reported as total / script resources / executed script resources.

| shape     | mode       | SSR response |   script | compile | hydration | first interaction |     requests |       heap | roots | warm nav |
| --------- | ---------- | -----------: | -------: | ------: | --------: | ----------------: | -----------: | ---------: | ----: | -------: |
| leaf      | route-wide |      3.30 ms | 17.39 ms | 0.07 ms |  52.30 ms |           1.60 ms |    3 / 1 / 2 | 3118.8 KiB |     1 |  2.30 ms |
| leaf      | isolated   |      3.30 ms |  6.84 ms | 0.06 ms |  41.60 ms |           1.40 ms |    4 / 2 / 3 | 2218.4 KiB |     1 |  1.40 ms |
| leaf      | rsc        |      7.88 ms | 14.95 ms | 0.26 ms |  46.70 ms |           1.70 ms |    3 / 0 / 3 | 2312.1 KiB |     1 | 15.30 ms |
| siblings  | route-wide |      1.94 ms | 12.31 ms | 0.06 ms |  41.70 ms |           1.50 ms |    3 / 1 / 2 | 2644.3 KiB |     1 |  1.50 ms |
| siblings  | isolated   |      2.17 ms |  7.41 ms | 0.06 ms |  39.00 ms |           1.40 ms |    8 / 6 / 7 | 2400.3 KiB |     4 |  0.90 ms |
| siblings  | rsc        |      5.57 ms | 15.14 ms | 0.14 ms |  44.50 ms |           1.70 ms |    3 / 0 / 3 | 2277.5 KiB |     1 |  5.60 ms |
| stress-8  | route-wide |      1.25 ms |  9.49 ms | 0.05 ms |  38.10 ms |           1.50 ms |    3 / 1 / 2 | 2529.8 KiB |     1 |  1.00 ms |
| stress-8  | isolated   |      1.34 ms |  7.97 ms | 0.07 ms |  43.20 ms |           1.50 ms | 12 / 10 / 11 | 2591.3 KiB |     8 |  0.50 ms |
| stress-16 | route-wide |      1.31 ms |  9.64 ms | 0.06 ms |  39.50 ms |           1.60 ms |    3 / 1 / 2 | 2574.0 KiB |     1 |  1.00 ms |
| stress-16 | isolated   |      1.77 ms |  8.49 ms | 0.06 ms |  46.30 ms |           1.40 ms | 20 / 18 / 19 | 2525.5 KiB |    16 |  0.70 ms |
| stress-32 | route-wide |      1.74 ms | 10.33 ms | 0.07 ms |  57.10 ms |           1.70 ms |    3 / 1 / 2 | 2619.4 KiB |     1 |  1.20 ms |
| stress-32 | isolated   |      4.36 ms |  9.92 ms | 0.07 ms |  78.70 ms |           1.50 ms | 36 / 34 / 35 | 2897.3 KiB |    32 |  0.70 ms |
| stress-64 | route-wide |      1.43 ms | 10.58 ms | 0.06 ms |  38.20 ms |           1.60 ms |    3 / 1 / 2 | 2712.6 KiB |     1 |  1.00 ms |
| stress-64 | isolated   |      2.13 ms | 12.87 ms | 0.06 ms |  65.50 ms |           1.50 ms | 68 / 66 / 67 | 3693.2 KiB |    64 |  0.90 ms |

The first measured stress regression beyond the 5% or confidence-interval budget occurred at 8 independent roots. The deterministic guard therefore keeps plans with 4 or fewer statically bounded isolated roots and sends larger or data-dependent plans through route-wide hydration.

The RSC rows are controls built with Farm's RSC plugin and optimized server boundary enabled. They use the same layout, counters, and navigation workload; they are not treated as route-wide fallbacks for the standard renderer.
