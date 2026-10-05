# Middleware matcher benchmark

This benchmark compares Farm's compiled middleware configuration matcher with a control that
repeats the previous per-request path canonicalization and regular-expression construction.
Both variants run correctness checks for matches, misses, parameters, exclusions, encoded
segments, and stateful regular expressions before measurement.

Run from the repository root:

```sh
pnpm benchmark:middleware-matchers
```

The default workload uses 100 matchers, 10,000 requests, seven measured rounds, and a warmup.
Override it with `FARM_MIDDLEWARE_BENCH_MATCHERS`, `FARM_MIDDLEWARE_BENCH_ITERATIONS`, or
`FARM_MIDDLEWARE_BENCH_ROUNDS`. Results are CPU microbenchmark medians, not end-to-end request
latency claims.
