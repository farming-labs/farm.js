# Keyed target runtime isolation

Run `pnpm --filter @farm.js/react test:runtime-size` to build and check both the existing size
budgets and the three focused keyed-target fixtures. To rerun only the focused comparison after
building, use `pnpm --filter @farm.js/react exec node scripts/benchmark-keyed-targets.mjs`.

The benchmark compiles each fixture twice with the same production bundler and source. The
control replaces the selected single-kind feature import with the existing complete keyed-target
feature. It asserts that the replacement occurred, that the specialized feature was bundled,
and that identity-only bundles exclude native Set/Map snapshot guards retained by the control.
React and React DOM are included equally in both payloads.

On macOS arm64 / Node 24.21.0:

| Target kind    | Complete gzip | Specialized gzip |   Saved |
| -------------- | ------------: | ---------------: | ------: |
| Identity       |      71,973 B |         70,732 B | 1,241 B |
| Set membership |      71,992 B |         71,400 B |   592 B |
| Map lookup     |      71,992 B |         71,533 B |   459 B |

The allocation regression test constructs equivalent complete and specialized row components:
each specialized component allocates four fewer Maps (two target snapshot maps instead of six).
Run `pnpm --filter @farm.js/react exec vitest run src/__tests__/compiler-runtime-target-allocation.test.ts`.
This measures payload and allocation reductions, not a page-latency speedup.

The existing identity, membership, and lookup correctness suites run against **both** runtimes,
including randomized queued updates, native collection guards, and React fallback. Mixed targets,
row conditionals, nested host blocks, and structural hints keep the existing complete runtime.
