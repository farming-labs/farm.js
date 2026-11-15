# js-framework-benchmark comparison with other frameworks: Linux and Chromium

Farm hybrid ranks third of ten on CPU, after vanilla JS and Solid. Its official-weighted CPU score
is within 1% of Solid's and 1.34x faster than React Hooks. On memory it ranks seventh and on size
tenth: every Farm build loads React and React DOM, which Solid, Svelte, Vue, Preact and vanilla JS
do not.

These are local measurements from the official benchmark harness, not an official leaderboard
submission. Raw samples and medians are in `FRAMEWORK_COMPARISON_LINUX_CHROMIUM.json`.

## Environment and method

- Date: 2026-11-10
- Farm source: `main` at `fb5cfdc`, with `@farm.js/react` 0.1.0-beta.39 built from that source
- Harness: `krausest/js-framework-benchmark` revision
  `afe7c118dd217ccae4c10813613ac0d7566b1ef1`, with its own `keyed/*` entries for the other
  frameworks, built unchanged from that revision
- Runner: the harness's Playwright Chrome timeline runner, headless
- Browser: Google Chrome for Testing 153.0.8010.12 (Playwright's Chromium build)
- Machine: cloud virtual machine, Intel Xeon @ 2.10 GHz, 4 vCPUs, 15 GiB RAM, Ubuntu 24.04.5 LTS
- Samples: 10 per CPU operation (20 for select row), 3 per memory benchmark, 1 for size
- All ten builds ran in one session, passed the keyed-identity validator, and passed the harness
  plausibility checks. The size benchmark used a `--no-sandbox` Chrome wrapper, as described in
  [BENCHMARK_RESULTS_LINUX_CHROMIUM.md](./BENCHMARK_RESULTS_LINUX_CHROMIUM.md).
- `react-compiler-hooks` is the harness's React entry built with Meta's React Compiler. Its
  upstream lockfile pins React 19.0.0; it was left as shipped. Every other React build uses 19.2.0.

Scores follow the harness's results table: each framework's median is divided by the lowest
median among these ten frameworks, and the factors are combined with a geometric mean. CPU uses
the official CPU weights; memory and size use equal weights. 1.00 means best on every benchmark in
the table. `pnpm compare:frameworks` recomputes every median from the raw samples.

This run also measured Farm and React Hooks again. Its Farm-vs-React figures differ slightly from
the separate run in [BENCHMARK_RESULTS_LINUX_CHROMIUM.md](./BENCHMARK_RESULTS_LINUX_CHROMIUM.md)
(1.343x and 1.360x official-weighted), which is ordinary run-to-run variation.

## CPU

Median total time in milliseconds. Lower is better.

| #   | Framework                   | CPU score | Create 1k | Replace 1k | Update 10th | Select |  Swap | Remove | Create 10k | Append 1k | Clear |
| --: | --------------------------- | --------: | --------: | ---------: | ----------: | -----: | ----: | -----: | ---------: | --------: | ----: |
|   1 | Vanilla JS                  |     1.019 |      61.5 |       66.3 |        53.3 |   11.3 |  55.7 |   41.6 |      665.1 |      88.6 |  27.9 |
|   2 | Solid 1.9.3                 |     1.072 |      67.6 |       72.8 |        53.3 |   13.2 |  60.4 |   45.2 |      703.0 |      77.0 |  32.3 |
|   3 | **Farm hybrid**             |     1.081 |      63.8 |       72.8 |        60.5 |   12.6 |  64.8 |   43.0 |      731.3 |      79.3 |  31.4 |
|   4 | **Farm static**             |     1.090 |      67.0 |       74.8 |        60.3 |   12.6 |  68.2 |   43.7 |      709.3 |      77.9 |  31.5 |
|   5 | Svelte 5.42.1               |     1.168 |      67.9 |       75.3 |        74.8 |   15.6 |  63.6 |   44.9 |      709.3 |      83.3 |  37.0 |
|   6 | Vue 3.5.39                  |     1.233 |      75.4 |       83.3 |        67.5 |   14.3 |  61.0 |   47.2 |      807.9 |      91.8 |  39.7 |
|   7 | Preact hooks 10.29.8        |     1.433 |      79.3 |       86.2 |        83.8 |   49.3 |  85.5 |   58.4 |      888.0 |      98.0 |  36.7 |
|   8 | React Hooks 19.2.0          |     1.452 |      76.7 |       89.1 |        69.4 |   17.9 | 348.9 |   49.1 |     1112.2 |      91.9 |  55.3 |
|   9 | React Compiler hooks 19.0.0 |     1.503 |      81.8 |       91.8 |        73.1 |   24.9 | 343.6 |   47.7 |     1102.8 |      92.2 |  57.0 |
|  10 | Farm, compiler off          |     1.555 |      75.2 |       85.6 |        80.0 |   46.2 | 371.6 |   55.7 |     1072.3 |      90.2 |  57.4 |

Farm hybrid and Solid are effectively tied. Farm has the lower median on create, select, remove
and clear, they tie on replace, and Solid is lower on update, swap, create 10k and append. A
Mann-Whitney U test on the per-operation samples separates them only on update every 10th row,
where Solid is faster (53.3 vs 60.5 ms, p = 0.016); the other eight differences are within this
run's noise. One run on a shared VM is not enough to rank them; repeat it before claiming either
is faster.

## Memory

Median of `performance.measureUserAgentSpecificMemory()` after a forced garbage collection, as
the harness measures it. Lower is better.

| #   | Framework                   | Memory score |    Idle | 1,000 rows | After 5 create/clear |
| --: | --------------------------- | -----------: | ------: | ---------: | -------------------: |
|   1 | Vanilla JS                  |        1.000 | 1.05 MB |    2.31 MB |              1.16 MB |
|   2 | Solid 1.9.3                 |        1.154 | 1.07 MB |    3.18 MB |              1.27 MB |
|   3 | Preact hooks 10.29.8        |        1.226 | 1.10 MB |    3.83 MB |              1.23 MB |
|   4 | Svelte 5.42.1               |        1.275 | 1.15 MB |    3.37 MB |              1.50 MB |
|   5 | Vue 3.5.39                  |        1.537 | 1.35 MB |    4.43 MB |              1.71 MB |
|   6 | **Farm static**             |        1.682 | 1.72 MB |    3.47 MB |              2.25 MB |
|   7 | **Farm hybrid**             |        1.722 | 1.81 MB |    3.52 MB |              2.25 MB |
|   8 | React Hooks 19.2.0          |        1.901 | 1.58 MB |    4.94 MB |              2.48 MB |
|   9 | React Compiler hooks 19.0.0 |        1.922 | 1.59 MB |    5.11 MB |              2.46 MB |
|  10 | Farm, compiler off          |        2.000 | 1.64 MB |    4.75 MB |              2.89 MB |

The rows themselves are not Farm's problem: 1,000 rows add 1.71 MB to Farm hybrid and 2.11 MB to
Solid. Farm loses on the starting point. Chrome keeps a page's script text in memory, and Farm
ships 229.5 KiB of it, of which React and React DOM are about 190 KiB; Solid ships 11.5 KiB. React
Hooks with nothing rendered already uses 1.58 MB, against 1.05 MB for vanilla JS. Heap snapshots
taken after the create/clear cycles show no retained table rows for any Farm build; the remaining
growth is compiled code the engine keeps for functions that ran.

## Size and first paint

Transfer size from the harness's size benchmark. First paint is a single sample per framework and
is order-sensitive, so it is reported but not used for conclusions.

| #   | Framework                   | Size score | Uncompressed | Compressed | First paint |
| --: | --------------------------- | ---------: | -----------: | ---------: | ----------: |
|   1 | Vanilla JS                  |      1.000 |     11.3 KiB |    2.5 KiB |     83.2 ms |
|   2 | Solid 1.9.3                 |      1.271 |     11.5 KiB |    4.5 KiB |     93.2 ms |
|   3 | Preact hooks 10.29.8        |      1.490 |     14.7 KiB |    5.7 KiB |     92.8 ms |
|   4 | Svelte 5.42.1               |      2.273 |     26.6 KiB |    9.7 KiB |    107.0 ms |
|   5 | Vue 3.5.39                  |      4.960 |     64.4 KiB |   23.3 KiB |    191.1 ms |
|   6 | React Compiler hooks 19.0.0 |     11.717 |    183.0 KiB |   50.0 KiB |    413.2 ms |
|   7 | React Hooks 19.2.0          |     11.828 |    190.3 KiB |   51.4 KiB |    397.6 ms |
|   8 | Farm, compiler off          |     11.952 |    189.1 KiB |   50.9 KiB |    416.9 ms |
|   9 | **Farm static**             |     13.333 |    229.5 KiB |   60.7 KiB |    399.9 ms |
|  10 | **Farm hybrid**             |     13.934 |    229.5 KiB |   60.7 KiB |    456.5 ms |

## Conclusion

With the compiler on, Farm's CPU performance moves from last of these ten frameworks to third,
level with Solid and 1.34x faster than React Hooks. Its memory and size remain those of a React
application plus the compiler runtime: 9.8 KiB compressed and 0.17 MB of idle memory over the
same app with the compiler off.
