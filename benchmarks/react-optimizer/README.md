# React optimizer benchmark

This benchmark compares normal React, Million.js automatic compilation, Million.js's recommended
manual list primitives, and Farm's experimental React compiler. It uses production Vite builds,
the same React version, the same Chromium binary, and the same keyed dashboard workload.

## Variants

- **React**: the unmodified React source and no optimizer.
- **Million auto**: the same source with Million.js automatic mode and a zero eligibility threshold.
- **Million For**: a disclosed source-level variant using Million's documented `<For>` list
  primitive with inline rows.
- **Million For + block**: a second disclosed variant combining `<For>` with a `block()` row, as
  shown in Million's manual-mode guide.
- **Farm AOT**: the same source as React with Farm's inferred compiler mode.

The runner fails unless both automatic compilers prove that they transformed the workload. Farm's
normal machine-readable compiler report is checked, while a post-transform Million proof verifies
the generated `compiledBlock` import. The manual Million variants verify that their documented
primitives survive the build and are reported separately because they are not same-source
comparisons. A manual variant that fails the browser correctness control is retained in the report
but excluded from timing.

The current Million auto transform compiles the stable outer shell but leaves `rows.map(...)` as a
React portal. The proof artifact records that fact instead of implying that Million lowered the
keyed list itself. Farm's production proof requires `FarmCompiledKeyedRows` in the emitted bundle.

## Workload and correctness control

Each cycle creates 1,000 keyed rows, updates every tenth label, changes selection, swaps two rows,
appends 100 rows, removes every tenth row, and clears the list. Before timing, every variant must
pass a browser correctness pass that checks:

- row counts, labels, selection, swap order, and unique keys;
- DOM identity for surviving and moved keyed rows;
- uncontrolled input value, focus, and selection preservation.

Latency is measured from programmatic click dispatch through the MutationObserver checkpoint for
the completed DOM mutation batch. CPU is Chrome's script + style + layout duration per full cycle.
The runner rotates variant order across trials, opens a fresh browser context for every trial, and
also records production JavaScript bytes and post-GC browser memory counters.

## Run

```bash
cd benchmarks/react-optimizer
npm install
npm run bench
```

Defaults are five trials, five warm-up cycles, and twenty measured cycles per trial. For a smoke
run, lower them explicitly:

```bash
BENCH_TRIALS=1 BENCH_WARMUPS=1 BENCH_ITERATIONS=2 npm run bench
```

Results are written to `results/latest.json` and `results/latest.md`. The exact Million and React
versions are pinned in `package.json`; Farm is built from the enclosing checkout.

## What Farm should carry forward

Million's useful idea is to move stable host structure out of React's ordinary reconciliation
loop. Its automatic compiler decides eligibility with a static-to-dynamic score and lowers the
component to a block with dynamic edits and React portals. Farm should keep the same broad goal,
but retain its stricter proof-based model:

- compile keyed collections as owned host rows, while keeping React as the component and lifecycle
  boundary;
- index bindings by state dependency so an unrelated update never scans every dynamic expression;
- emit operation-specific append, removal, reorder, and map hints only when the compiler can prove
  their preconditions, with the complete keyed reconciler as the fallback;
- preserve DOM identity, native input state, focus, selection, hydration, and Strict Mode before
  accepting a speedup;
- split optional runtimes aggressively. On the recorded reference run Farm was faster, but its
  production JavaScript payload was larger than Million auto, making payload reduction the clearest
  next target.

The checked-in [reference result](./results/latest.md) records the machine, runtime, browser,
correctness outcome, raw bundle sizes, and aggregate timings. Raw trial samples are in
[`latest.json`](./results/latest.json).

## Scope

This is a reconciliation-heavy benchmark, not a claim about whole-app performance. It does not
measure networking, server rendering, hydration, application data work, or user-perceived frame
rates. Million itself describes js-framework-benchmark-style table tests as intentionally
unrealistic, so the result should guide runtime work rather than become a universal headline.

Sources: [Million repository](https://github.com/aidenybai/million),
[Million block virtual DOM explanation](https://github.com/aidenybai/million/blob/main/website/pages/blog/virtual-dom.en-US.mdx),
and [Million `<For>` documentation](https://github.com/aidenybai/million/blob/main/website/pages/docs/manual-mode/for.en-US.mdx).
