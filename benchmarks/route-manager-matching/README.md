# Route manager matching benchmark

This source-level benchmark compares a route-table scan that decodes the request pathname for
every candidate with Farm's shared decoded-parts matcher. It also compares sorting layout entries
per request with reusing discovery-time order.

Both route-scan variants must return the same route and parameters before measurements run. The
benchmark uses 100 page candidates and 50 layouts by default.

Run from the repository root:

```sh
pnpm benchmark:route-manager-matching
```

Vitest reports warmed mean throughput and variance. These are CPU microbenchmarks of route-manager
work, not end-to-end request latency claims.
