# Meta-framework benchmark

Generated 2026-07-22T00:17:50.324Z at Farm commit ff5a0a3a20b2.

| Framework               | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| ----------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3    |          345ms |   5.26ms |         546ms |            97ms |               0.83ms / 1.29ms |  7,528 B |
| Next.js 16.2.10         |          1.38s |     31ms |         2.38s |           241ms |               4.10ms / 6.79ms | 30,842 B |
| SvelteKit 2.70.1        |          784ms |   1.95ms |         1.68s |            63ms |               0.73ms / 1.10ms |  8,355 B |
| Nuxt 4.5.0              |          2.30s |   3.35ms |         4.29s |           120ms |               1.13ms / 1.62ms |  8,527 B |
| TanStack Start 1.168.32 |          801ms |   8.74ms |         663ms |            90ms |               1.17ms / 2.15ms |  9,285 B |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Runs: 1 discarded burn-in plus 7 randomized measured rounds.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.14.0, pnpm 8.12.1.
- Benchmark input SHA-256: 58e331fd39d110764cc006af2dc95cccb6ede975c4af78fd5bf37219fb7fd81d.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: yes; the broader workspace state is recorded.
- Contended measured rounds detected: none.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
