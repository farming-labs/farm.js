# Meta-framework benchmark

Generated 2026-07-22T12:36:43.924Z at Farm commit 69f0948b97c3.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3    |          286ms |   5.31ms |         554ms |            67ms |               0.99ms / 1.45ms |  7,591 B |
| Next.js 16.2.10         |          1.44s |     33ms |         2.54s |           239ms |               4.25ms / 6.03ms | 30,842 B |
| SvelteKit 2.70.1        |          855ms |   1.95ms |         1.75s |            65ms |               0.72ms / 1.22ms |  8,355 B |
| Nuxt 4.5.0              |          2.36s |   3.00ms |         4.61s |           116ms |               1.20ms / 1.91ms |  8,527 B |
| TanStack Start 1.168.32 |          816ms |   9.00ms |         690ms |            81ms |               1.16ms / 2.24ms |  9,285 B |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Runs: 1 discarded burn-in plus 7 measured rounds; order: seeded, position-balanced cyclic schedule.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem and any product-enabled Node compile cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.14.0, pnpm 8.12.1.
- Benchmark input SHA-256: b9f6214fc78195928d4159058d3b097a8cbf21bf4917a1fb09a16f44294ad1a9.
- Benchmark inputs dirty: no.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: yes; the broader workspace state is recorded.
- Contended measured rounds detected: none.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
