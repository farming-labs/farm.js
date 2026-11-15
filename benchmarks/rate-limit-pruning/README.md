# Rate-limit expiration pruning benchmark

```sh
pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/rate-limit-pruning.bench.ts --run
```

The control preserves `memoryRateLimitStorage` from `1307b964`. Each store has
100,000 active keys, the default capacity, with one-hour windows. Assertions
verify that unknown keys are rejected while existing counters can increment.
Measurements include the capacity error construction/catch in both cases.

Observed on macOS arm64, Node 24.21.0, Vitest 3.2.7:

| Operation                         | Previous mean ms | Expiry-aware mean ms |
| --------------------------------- | ---------------: | -------------------: |
| Reject an unknown key at capacity |           1.2116 |               0.0026 |
| Increment an existing active key  |           0.0001 |               0.0001 |

Rejection RME was 1.08% / 0.16%. Existing-key throughput was 10.70M / 10.25M
operations/s, with 0.10% / 15.12% RME; that small difference is inconclusive.
These are local CPU microbenchmarks, not network or application throughput claims.

The store tracks a lower bound on live expiry times. Capacity pressure scans
only when a window could expire, then recomputes the bound. Mixed TTLs, boundary
expiry, backward/forward clock movement and lazy deletion are covered by tests.
Expired cleanup itself still scans the store; no heap, timer or active-key
eviction is introduced. At 1,000 full active keys, three rejected new keys now
visit zero records rather than 3,000.

Both `increment()` and `get()` return snapshots. Unlike the previous increment
result, changing a returned object cannot alter the stored counter or expiry.
This is necessary to keep the cached expiry bound valid and is documented in
the storage guide. Active increments update the private counter in place and
allocate one result snapshot; inserting a new key additionally allocates its
private record.

An esbuild-minified Node ESM bundle of `src/middleware/chain.ts` measured
5,417 → 5,454 bytes, or 2,220 → 2,253 gzip bytes. These are isolated bundle sizes,
not complete application sizes. Shared/Redis adapters are unchanged.
