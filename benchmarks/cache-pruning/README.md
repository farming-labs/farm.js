# Cache invalidation pruning benchmark

Run from the repository root:

```sh
pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/cache-pruning.bench.ts --run
```

Both cases use the current `FarmDataCache` public write path. The control replaces
only its private pruning method with the implementation from `1307b964`. Fixtures
assert the same stale-read and invalidation-version behavior before measuring.
The regression suite additionally covers pending fills, replacement, eviction,
deletion, and releasing invalidation metadata.

Each cache contains the default 1,024 entries. The benchmark repeatedly updates
an unrelated existing entry, retaining zero, one, or 100 invalidated tags. The
tagged stale entry is either first or near the end of LRU order. No adapters or
network work are included.

Observed on macOS arm64, Node 24.21.0, Vitest 3.2.7:

| Outstanding tags / dependency | Previous mean ms/write | Iterator mean ms/write |
| ----------------------------- | ---------------------: | ---------------------: |
| 0                             |                 0.0043 |                 0.0035 |
| 1 / first                     |                 0.0090 |                 0.0036 |
| 100 / first                   |                 0.4616 |                 0.0087 |
| 100 / late                    |                 2.5725 |                 1.1779 |

These are warmed CPU microbenchmarks, not application latency claims. Relative
margin of error was 8–16%; rerun on a quiet machine before comparing small changes.
The no-tag case is unchanged logically. The key deterministic improvement is
that finding an early stale dependency no longer copies all 1,024 entries for
every tag. The worst case still scans entries for each invalidated tag.

A minified Node ESM bundle of `src/cache.ts` using the workspace esbuild measured
31,583 → 31,584 bytes, or 10,092 → 10,085 gzip bytes. This is an isolated module
bundle measurement, not the size of a complete Farm application. No dependency,
public API, client entry point, or cache policy changes are introduced.
