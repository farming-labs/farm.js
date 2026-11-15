# API route matching benchmark

This benchmark compares cached API route metadata and once-per-request pathname decoding with
the previous matcher from commit `4c7b1017`. The preserved control is under
`packages/farm/src/__benchmarks__/controls/api-route-pattern.ts` (only its import path differs).
Both variants must return the same route and decoded parameters before measurement.

Run from the repository root:

```sh
pnpm benchmark:api-route-matching
```

The workload scans 500 dynamic routes and chooses the last one. Vitest reports warmed mean
throughput and variance. This is a CPU microbenchmark, not an end-to-end request latency claim.
