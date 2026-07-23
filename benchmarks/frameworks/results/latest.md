# Meta-framework benchmark

Generated 2026-07-21T22:39:51.067Z at Farm commit 3fda11ded4ff.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3    |          454ms |   5.08ms |         1.06s |            99ms |               0.80ms / 1.18ms |  7,528 B |
| Next.js 16.2.10         |          1.37s |     31ms |         2.44s |           239ms |               3.99ms / 5.79ms | 30,842 B |
| SvelteKit 2.70.1        |          781ms |   1.82ms |         1.64s |            63ms |               0.68ms / 1.12ms |  8,355 B |
| Nuxt 4.5.0              |          2.28s |   2.89ms |         4.25s |           118ms |               1.11ms / 1.80ms |  8,527 B |
| TanStack Start 1.168.32 |          798ms |   8.44ms |         652ms |            89ms |               1.12ms / 1.99ms |  9,285 B |

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
