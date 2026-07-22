# Meta-framework benchmark

Generated 2026-07-22T15:28:32.297Z at Farm commit 1557bdc8c5d7.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3    |          303ms |   1.90ms |         571ms |            63ms |               0.68ms / 1.05ms |  7,591 B |
| Next.js 16.2.10         |          1.54s |     34ms |         2.63s |           255ms |               3.92ms / 9.17ms | 30,842 B |
| SvelteKit 2.70.1        |          813ms |   2.02ms |         1.77s |            67ms |               0.66ms / 1.15ms |  8,355 B |
| Nuxt 4.5.0              |          2.47s |   3.40ms |         4.67s |           119ms |               1.23ms / 2.15ms |  8,527 B |
| TanStack Start 1.168.32 |          1.27s |   4.83ms |         731ms |            82ms |               1.14ms / 2.29ms |  9,285 B |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Warm responses: 30 equal warm-up requests per server and round are excluded from the samples.
- Runs: 1 discarded burn-in plus 7 measured rounds; order: seeded, position-balanced cyclic schedule.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem and any product-enabled Node compile cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.14.0, pnpm 8.12.1.
- Benchmark input SHA-256: 3898d19883ae5c0ec1a0f313d3b0ed29b8e2dab2d493700e8845f56bd4e5c40d.
- Benchmark inputs dirty: no.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: yes; the broader workspace state is recorded.
- Contended measured rounds detected: none.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
