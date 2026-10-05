# Island visibility resource benchmark

Run `pnpm --filter @farm.js/core exec vitest run src/__tests__/island-shared-triggers.test.ts`.
The deterministic 100-boundary workload counts real scheduler observer registrations rather
than reporting timing from mocked browser APIs. Before this change it constructs 100 observers;
with the shared policy it constructs one. Both observe 100 elements. The last cancellation
disconnects the observer, and the correctness controls cover shared targets, selective activation,
failed hydration, and capture-listener ordering.

This reduces browser observer instances by 99% for that workload, not DOM target count or
hydration work. No page-load speedup is claimed. The shared runtime adds 167 gzip bytes in an
esbuild-minified standalone scheduler bundle (1,527 → 1,694 bytes).

Document interaction listeners deliberately remain per-island: consolidating them changes their
order relative to application capture listeners registered between islands, including listeners
using `stopImmediatePropagation()`. The native-order test detects that regression.
