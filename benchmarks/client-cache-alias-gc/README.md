# Targeted client cache alias cleanup

Run `pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/client-cache-alias-gc.bench.ts --run`.

The control preserves the previous metadata sweep for an unwatched cache. Both workloads
restore the same entry/alias maps and the new reverse index before lazily reading expired
entries. Restoration is included in timing; notifications are disabled in both to isolate
metadata cleanup from the separate emission optimization. Both assert identical empty entry
and alias maps. Unit tests cover live subscribers, in-flight ownership, retargeting and cleanup.

On macOS arm64, Node 24.21.0, pnpm 8.12.1:

| Expired entries | Previous mean | Targeted mean |
| --------------- | ------------- | ------------- |
| 100             | 0.4123 ms     | 0.0794 ms     |
| 1,000           | 44.6448 ms    | 1.0448 ms     |

RME was 1.2–3.7%. These are isolated CPU measurements, not browser navigation or rendering
speed claims. The deterministic regression removes 500,500 global alias visits for 1,000
expirations. Cleanup walks related reverse edges instead; live listener/in-flight protection
and alias-chain resolution still have their existing costs.

The tradeoff is a reverse Map/Set index with one extra membership per alias. Alias replacement,
metadata cleanup, clear and disposal release those memberships. The minified browser bundle
of `src/client-cache.ts` measured 32,827 → 33,314 bytes; gzip 10,000 → 10,131 bytes.
