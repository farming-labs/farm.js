# Meta-framework benchmark

Generated 2026-07-21T18:57:46.775Z at Farm commit 1d27e4c2a996.

| Framework            | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 |     HTML |
| -------------------- | -------------: | -------: | ------------: | --------------: | ----------------------------: | -------: |
| Farm.js 0.0.3-beta.3 |          473ms |   5.57ms |         1.43s |           101ms |               0.91ms / 1.45ms |  7,528 B |
| Next.js 16.2.10      |          1.51s |     33ms |         2.60s |           261ms |               4.44ms / 6.05ms | 30,842 B |
| SvelteKit 2.70.1     |          832ms |   2.23ms |         1.78s |            66ms |               0.76ms / 1.60ms |  8,355 B |
| Nuxt 4.5.0           |          2.42s |   3.63ms |         4.57s |           125ms |               1.29ms / 1.91ms |  8,527 B |

Lower is better. Values are medians unless a percentile is named.

## Scope

- Fixture: One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.
- Build metric: complete fixture-project production build; local Farm package preparation is excluded.
- Runs: 1 discarded burn-in plus 7 randomized measured rounds.
- Cache policy: Generated framework caches removed before dev and build; OS filesystem cache warm.
- Machine: Apple M1, 16 GB, macOS 26.2.
- Runtime: Node 24.14.0, pnpm 8.12.1.
- Benchmark input SHA-256: 76d4a36d1331bee98fc116c7295c4fd6558fd17b4d403e5834ac163713c3e09d.
- Farm source dirty: no.
- Root lockfile dirty: no.
- Workspace dirty: yes; the broader workspace state is recorded.
- Contended measured rounds detected: none.

See ../README.md for metric boundaries, controls, limitations, and reproduction steps. The complete samples are in latest.json.
