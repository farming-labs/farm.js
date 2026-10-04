# Framework hot-path benchmark

This benchmark measures two request/navigation paths that should compile stable route metadata once:

- browser matching across a table of static routes;
- integration matching across a table of typed dynamic routes.

The controls intentionally reproduce the work avoided by the optimized paths. The browser control linearly scans pre-parsed static route entries and repeats the pathname splitting that the previous matcher performed for every candidate. The integration control gives the matcher a fresh route-table identity for every request, forcing validation, normalization, sorting, and pattern compilation as the previous request path did.

Every measured variant first runs the same correctness cases. Results are reported as the median of multiple rounds after warmup; lower elapsed time is better. This is a CPU microbenchmark, not a navigation-latency claim. Shared viewport observation and the four-request prefetch limit are covered by deterministic runtime tests instead because their benefit is resource cardinality and network pressure, not loop throughput.

Run from the repository root:

```sh
pnpm benchmark:framework-hot-paths
```

The workload can be adjusted without editing the script:

```sh
FARM_HOT_PATH_BENCH_ROUTES=200 \
FARM_HOT_PATH_BENCH_ITERATIONS=10000 \
FARM_HOT_PATH_BENCH_ROUNDS=9 \
pnpm benchmark:framework-hot-paths
```
