# Meta-framework benchmark

Generated 2026-11-03T21:28:36.086Z at Farm commit ccf35ddf7c24.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 | Decoded HTML | Encoded body | Actual encoding (dev / prod) |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -----------: | -----------: | ---------------------------- |
| Farm.js 0.1.51-beta.2   |          272ms |   2.08ms |         589ms |            78ms |               0.74ms / 1.64ms |      8,201 B |      8,201 B | identity / identity          |
| Next.js 16.2.10         |          1.44s |     29ms |         2.48s |           252ms |               2.88ms / 3.72ms |     30,842 B |     30,842 B | identity / identity          |
| SvelteKit 2.70.1        |          804ms |   1.92ms |         1.73s |            69ms |               0.63ms / 0.80ms |      8,355 B |      8,355 B | identity / identity          |
| Nuxt 4.5.0              |          2.39s |   3.16ms |         4.49s |           119ms |               1.03ms / 1.51ms |      8,527 B |      8,527 B | identity / identity          |
| TanStack Start 1.168.32 |          816ms |   4.59ms |         690ms |            83ms |               0.99ms / 1.74ms |      9,285 B |      9,285 B | identity / identity          |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Requested Accept-Encoding: identity. Identity fallback is recorded, not treated as compressed output.
- Transport: Node HTTP/1.1 with explicit decoding (v2; not directly comparable to the prior Fetch transport).
- Body sizes: Encoded and decoded HTTP body bytes; excludes headers, chunk framing, and TLS. responseBytes is the legacy decoded-size alias.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Warm responses: 30 equal warm-up requests per server and round are excluded from the samples.
- Runs: 1 discarded burn-in plus 7 measured rounds; order: seeded, position-balanced cyclic schedule.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem and any product-enabled Node compile cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.21.0, pnpm 8.12.1.
- Benchmark input SHA-256: ba61d0e79ae2862381732aa7804670c9923ca6a04a3bc5efb94d0026e0236ea0.
- Known generator-owned outputs are excluded from source identity and fingerprinted separately in JSON; authored inputs remain guarded.
- Benchmark inputs dirty: no.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: no.
- Correlated-contention assessment: not detected (not proof of an idle host).
- Publication eligible: yes.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
