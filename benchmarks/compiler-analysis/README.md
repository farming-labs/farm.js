# Isolated React compiler analysis diagnostic

This compares compiler analysis on the maintained `react-compiler` and
`react-compiler-dashboard` TSX/JSX modules. It does **not** measure complete builds,
browser interactions, or a framework ranking. Nothing here changes shipped code.

From the repository root, with workspace dependencies installed:

```sh
pnpm --filter @farm.js/react build
BASE_REF=<baseline-commit> PAIRS=5 node benchmarks/compiler-analysis/run.mjs
```

The candidate defaults to the working-tree `packages/farm-react/src/compiler.ts`.
Set `CANDIDATE_REF=<commit>` to inspect a different revision without switching or
editing the checkout. Both refs are resolved to commits before reading source.
In PowerShell, set `$env:BASE_REF` (and optional `$env:CANDIDATE_REF`, `$env:PAIRS`)
before running `node benchmarks/compiler-analysis/run.mjs`. `PAIRS` must be 3–20.

## Controls and measurement

- Snapshot both compiler sources and the current example inputs once. Record
  source, prepared-module and input hashes, resolved revisions, normalized options,
  Node/OS/CPU details, process IDs and host-load samples.
- Use the same installed Babel/Vite and compiler-option normalization in both arms.
  Refs change **only compiler source**, not the rest of that revision's framework.
  The maintained example inputs always come from this checkout.
- Verify complete serialized results (code, source maps, diagnostics, compiled
  component selections and optimization metadata) with SHA-256 fingerprints in
  both static and hybrid modes before measuring. Reject changed results.
- Spawn a fresh Node process for **every** sample. Each worker loads only its
  selected compiler. Two untimed warm-up passes precede one measured hybrid pass.
  Imports, snapshot I/O, process startup, output hashing and assertions are outside
  measured time. There is no instrumentation in the measured compiler.
- Interleave a same-code A/A control (baseline against itself) with A/B comparisons.
  Alternate arm and group order each pair. Record wall and process CPU time,
  individual samples and medians; keep control results separate from comparisons.
- Verify warm-up and measured output too. A mismatch, timeout or failed child is
  an error, never a sample to silently discard. Each worker has a 60-second limit.
  Workers clear `NODE_OPTIONS` and `NODE_PATH` to exclude inherited preload hooks
  and disable Node's cross-process bytecode cache.

The script prints a unique temporary output directory and retains prepared modules,
input snapshots, control results, each completed sample (including stderr), and
`results.json`. These artifacts are diagnostic data, not files to commit. Failed
runs retain completed artifacts but do not produce a successful final summary.

## Interpretation

Same-code arms should not have a systematic difference. A visible A/A difference
demonstrates noise; it must not be subtracted from A/B results to manufacture a win.
Fresh processes isolate heaps, module state and JIT history, **not** host CPU,
memory pressure, thermal state or filesystem caches. Do not run other local
verification concurrently. Windows load averages are zero/unavailable, not proof
that the machine is idle.

Inspect all paired samples and repeat independently on a suitable host. A positive
compiler-only result still needs real-build comparison and correctness/bundle
coverage before recommending an optimization. No automatic speed verdict, timing
CI threshold, or leaderboard score is emitted. For build comparisons use
`packages/farm-react/scripts/benchmark-compiler-build.mjs` with the same `BASE_REF`.

## Harness tests

```sh
node --test benchmarks/compiler-analysis/run.test.mjs
```

These dependency-free controls run in the existing Linux/Windows benchmark-harness
CI job. They cover process isolation, timing boundaries, output mismatches,
nondeterminism, changed snapshots, inherited preload hooks, timeouts, error
propagation, and separation of same-code noise from candidate timings.
