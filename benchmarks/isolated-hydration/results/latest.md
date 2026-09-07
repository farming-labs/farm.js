# Isolated hydration benchmark

Generated 2026-09-07T16:37:46.343Z on darwin arm64, Node v24.11.0, 152.0.7977.82.
25 measured browser and server iterations after 5 warmups. Latency cells show p50; raw samples, p95, and bootstrap median confidence intervals are in `latest.json`.

## Transfer and document cost

| shape     | mode       | client JS raw | client JS gzip | client JS Brotli | chunks |      HTML |  markers |
| --------- | ---------- | ------------: | -------------: | ---------------: | -----: | --------: | -------: |
| leaf      | route-wide |     374.3 KiB |       77.7 KiB |         63.5 KiB |      2 | 108.9 KiB |  0.0 KiB |
| leaf      | isolated   |     229.0 KiB |       71.5 KiB |         62.6 KiB |      3 | 109.2 KiB |  0.3 KiB |
| leaf      | rsc        |     222.3 KiB |       70.6 KiB |         60.7 KiB |      2 | 219.3 KiB |  0.0 KiB |
| siblings  | route-wide |     297.9 KiB |       73.5 KiB |         62.0 KiB |      2 |  55.1 KiB |  0.0 KiB |
| siblings  | isolated   |     230.9 KiB |       72.8 KiB |         63.7 KiB |      7 |  56.2 KiB |  1.2 KiB |
| siblings  | rsc        |     223.1 KiB |       70.8 KiB |         60.8 KiB |      2 | 110.9 KiB |  0.0 KiB |
| stress-8  | route-wide |     247.3 KiB |       70.6 KiB |         60.9 KiB |      2 |  19.3 KiB |  0.0 KiB |
| stress-8  | isolated   |     233.1 KiB |       74.1 KiB |         64.8 KiB |     11 |  21.6 KiB |  2.3 KiB |
| stress-16 | route-wide |     248.5 KiB |       70.7 KiB |         61.0 KiB |      2 |  19.7 KiB |  0.0 KiB |
| stress-16 | isolated   |     237.5 KiB |       76.9 KiB |         67.1 KiB |     19 |  24.3 KiB |  4.6 KiB |
| stress-32 | route-wide |     250.9 KiB |       71.0 KiB |         61.2 KiB |      2 |  20.6 KiB |  0.0 KiB |
| stress-32 | isolated   |     246.3 KiB |       82.3 KiB |         71.2 KiB |     35 |  29.9 KiB |  9.3 KiB |
| stress-64 | route-wide |     255.8 KiB |       71.4 KiB |         61.3 KiB |      2 |  22.3 KiB |  0.0 KiB |
| stress-64 | isolated   |     264.0 KiB |       93.2 KiB |         79.7 KiB |     67 |  40.9 KiB | 18.6 KiB |

## Server and browser cost

Requests are reported as total / script resources / executed script resources.

| shape     | mode       | SSR response |   script | compile | hydration | first interaction |     requests |       heap | roots | warm nav |
| --------- | ---------- | -----------: | -------: | ------: | --------: | ----------------: | -----------: | ---------: | ----: | -------: |
| leaf      | route-wide |      3.70 ms | 18.60 ms | 0.07 ms |  62.20 ms |           1.70 ms |    3 / 1 / 2 | 3122.9 KiB |     1 |  2.60 ms |
| leaf      | isolated   |      3.21 ms |  7.17 ms | 0.07 ms |  49.60 ms |           1.50 ms |    4 / 2 / 3 | 2218.5 KiB |     1 |  1.50 ms |
| leaf      | rsc        |      8.26 ms | 15.65 ms | 0.26 ms |  60.60 ms |           1.90 ms |    3 / 2 / 3 | 2312.1 KiB |     1 | 19.70 ms |
| siblings  | route-wide |      8.04 ms | 12.78 ms | 0.07 ms |  62.20 ms |           1.70 ms |    3 / 1 / 2 | 2661.9 KiB |     1 |  1.70 ms |
| siblings  | isolated   |      2.19 ms |  7.64 ms | 0.07 ms |  62.60 ms |           1.50 ms |    8 / 6 / 7 | 2400.4 KiB |     4 |  1.10 ms |
| siblings  | rsc        |     19.15 ms | 15.96 ms | 0.16 ms |  63.90 ms |           1.90 ms |    3 / 2 / 3 | 2277.6 KiB |     1 | 11.80 ms |
| stress-8  | route-wide |      6.31 ms | 10.81 ms | 0.08 ms |  74.20 ms |           1.80 ms |    3 / 1 / 2 | 2529.8 KiB |     1 |  1.20 ms |
| stress-8  | isolated   |      2.38 ms |  9.44 ms | 0.07 ms |  87.90 ms |           1.60 ms | 12 / 10 / 11 | 2592.3 KiB |     8 |  0.80 ms |
| stress-16 | route-wide |      6.12 ms | 10.55 ms | 0.07 ms |  71.10 ms |           1.80 ms |    3 / 1 / 2 | 2569.3 KiB |     1 |  1.30 ms |
| stress-16 | isolated   |      4.09 ms | 10.01 ms | 0.07 ms |  82.00 ms |           1.60 ms | 20 / 18 / 19 | 2527.5 KiB |    16 |  0.80 ms |
| stress-32 | route-wide |      2.56 ms | 11.84 ms | 0.07 ms |  72.50 ms |           1.80 ms |    3 / 1 / 2 | 2620.6 KiB |     1 |  1.60 ms |
| stress-32 | isolated   |      8.29 ms | 10.70 ms | 0.07 ms |  89.50 ms |           1.60 ms | 36 / 34 / 35 | 2892.2 KiB |    32 |  0.90 ms |
| stress-64 | route-wide |      3.56 ms | 11.57 ms | 0.07 ms |  67.60 ms |           1.70 ms |    3 / 1 / 2 | 2712.5 KiB |     1 |  1.50 ms |
| stress-64 | isolated   |      3.77 ms | 14.26 ms | 0.07 ms | 112.20 ms |           1.50 ms | 68 / 66 / 67 | 3666.6 KiB |    64 |  1.00 ms |

The first measured stress regression beyond the 5% or confidence-interval budget occurred at 8 independent roots. The deterministic guard therefore keeps plans with 4 or fewer statically bounded isolated roots and sends larger or data-dependent plans through route-wide hydration.

The RSC rows are controls built with Farm's RSC plugin and optimized server boundary enabled. They use the same layout, counters, and navigation workload; they are not treated as route-wide fallbacks for the standard renderer.
