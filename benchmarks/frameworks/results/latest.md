# Meta-framework benchmark

Generated 2026-07-21T19:38:58.969Z at Farm commit 0821ecfdc8c7.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3    |          723ms |   5.50ms |         1.59s |            99ms |               0.93ms / 2.52ms |  7,528 B |
| Next.js 16.2.10         |          2.17s |     34ms |         3.37s |           262ms |               4.58ms / 6.36ms | 30,842 B |
| SvelteKit 2.70.1        |          1.07s |   2.36ms |         1.94s |            94ms |               0.79ms / 1.93ms |  8,355 B |
| Nuxt 4.5.0              |          2.54s |   4.25ms |         5.13s |           123ms |               1.28ms / 3.96ms |  8,527 B |
| TanStack Start 1.168.32 |          1.25s |   8.71ms |         742ms |            93ms |               1.49ms / 2.88ms |  9,285 B |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Runs: 1 discarded burn-in plus 7 randomized measured rounds.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.14.0, pnpm 8.12.1.
- Benchmark input SHA-256: e7d11f64c58b03e0199f48d00428f668aee2f4b945c0efdc8fbc4eeaf2e539e9.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: yes; the broader workspace state is recorded.
- Contended measured rounds detected: none.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
