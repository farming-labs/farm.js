# Client cache alias notification benchmark

```sh
pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/client-cache-aliases.bench.ts --run
```

Both cases run the current public cache write path with 1,000 provisional aliases
pointing to one canonical entry. The control replaces only `emit` with its
implementation from `1307b964`. Subscriber counts are verified before measurement.
The tests separately cover unrelated aliases, retargeted transitive aliases,
invalidation events, unsubscription, and subscriptions changed during delivery.

Observed on macOS arm64, Node 24.21.0, Vitest 3.2.7 (mean ms/write):

| Subscribed aliases | Previous | Skip unobserved |
| ------------------ | -------: | --------------: |
| 0                  |   0.0620 |          0.0001 |
| 5                  |   0.0508 |          0.0144 |
| 1,000              |   0.0918 |          0.1012 |

Relative margin of error was 0.7–4.9%. These are CPU microbenchmarks, not React
render or end-to-end application latency measurements. The all-subscribed case
was about 10% slower because the live membership check adds a Map lookup. The
optimization targets accumulated unobserved provisional aliases; it does not
claim to improve heavily subscribed fan-out.

With no subscribers, emission skips alias iteration altogether. With subscribers,
the list is still visited in alias insertion order, but only subscribed aliases
are resolved. This preserves live/reentrant delivery without another mutable
reverse index. An unrelated write with 1,000 unobserved aliases now makes one
`resolveKey` call instead of 1,001.

An esbuild-minified browser ESM bundle of `src/client-cache.ts` measured
32,827 → 32,877 bytes, or 10,000 → 10,010 gzip bytes. This is an isolated module
bundle, not a complete application's bundle size. No public API or dependencies
are added, and the cache behavior remains renderer-neutral.
