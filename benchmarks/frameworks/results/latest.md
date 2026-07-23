# Meta-framework benchmark

Generated 2026-07-22T16:33:44.037Z at Farm commit c6cdea5169f1.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3    |          253ms |   1.72ms |         527ms |            64ms |               0.66ms / 0.87ms |  7,591 B |
| Next.js 16.2.10         |          1.39s |     30ms |         2.38s |           254ms |               3.43ms / 4.48ms | 30,842 B |
| SvelteKit 2.70.1        |          802ms |   1.80ms |         1.68s |            66ms |               0.63ms / 0.83ms |  8,355 B |
| Nuxt 4.5.0              |          2.33s |   2.95ms |         4.46s |           117ms |               1.00ms / 1.61ms |  8,527 B |
| TanStack Start 1.168.32 |          803ms |   4.40ms |         658ms |            80ms |               0.94ms / 2.03ms |  9,285 B |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Warm responses: 30 equal warm-up requests per server and round are excluded from the samples.
- Runs: 1 discarded burn-in plus 7 measured rounds; order: seeded, position-balanced cyclic schedule.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem and any product-enabled Node compile cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.18.0, pnpm 8.12.1.
- Benchmark input SHA-256: 3898d19883ae5c0ec1a0f313d3b0ed29b8e2dab2d493700e8845f56bd4e5c40d.
- Benchmark inputs dirty: no.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: no.
- Contended measured rounds detected: none.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
