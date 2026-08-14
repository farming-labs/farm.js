# FARMJS React Compiler Starter

An experimental FARMJS starter that enables the React AOT compiler and makes its supported update
path visible in the browser. The dark comparison lab shows compiled local state beside ordinary
React reconciliation, then exercises batching, multiple bindings, safe fallbacks, and a large
static interaction workload.

> The compiler is experimental. Unsupported component shapes stay on React by default so the
> optimization never becomes a correctness requirement.

## Create this starter

```bash
pnpm create @farm.js/app@beta my-compiler-app --template react-compiler --typescript
cd my-compiler-app
pnpm dev
```

You can also clone the standalone
[farmjs-react-compiler-starter](https://github.com/farming-labs/farmjs-react-compiler-starter).

## What this project demonstrates

This production-browser experiment answers two questions:

1. Why build this compiler? Eligible local `useState` updates can patch precomputed DOM targets
   without rerunning the component body or asking React to reconcile the same static tree again.
2. Where must it stop? Keyed lists, effects, refs, custom components, and other dynamic structures
   stay on React whenever the compiler cannot prove that a direct binding preserves behavior.

The default `compiler: true` configuration automatically considers components. No annotation is
needed. A component can explicitly opt out with `"use no compiler"`.

## Run the automated experiment

```bash
pnpm install
pnpm exec playwright install chromium
pnpm experiment
```

The Playwright install is needed once per machine (or whenever its browser cache is cleared).

The command creates a production build, starts it on a local port, runs Chromium assertions, checks
for console/runtime errors, saves `/tmp/farm-react-aot-edge-lab.png`, and prints a JSON report.

## Expected report

| Experiment                 | Compiled result                                         | Base React / fallback result                   | What it proves                                                         |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Two direct updates         | state `2`, update executions `0`                        | state `2`, update executions `2`               | Eligible updates skip post-mount component executions.                 |
| Batched functional updates | count `2`, snapshot `0`, update executions `0`          | count `2`, snapshot `0`, update executions `1` | The compiler preserves queued updater and event snapshot behavior.     |
| Two state cells            | text/class/data/input all update, update executions `0` | —                                              | AOT dependency lists update only bindings affected by each state cell. |
| Keyed list                 | intentionally not compiled                              | 3 correct keyed rows, update executions `2`    | Dynamic child structure safely falls back to React reconciliation.     |

The package runtime test also measures one equivalent update under a React `Profiler`:

| Path       | Component renders | React commits | DOM result            |
| ---------- | ----------------: | ------------: | --------------------- |
| FARMJS AOT |                 1 |             1 | Text and class update |
| Base React |                 2 |             2 | Text and class update |

For this narrow eligible update, AOT removes all React render/commit work caused by the local update.
This is a structural result, not a claim that an entire application is twice as fast. End-to-end
speed depends on event work, DOM work, layout, paint, application shape, and device.

## Keys and Hooks boundary

`items.map(item => <Row key={item} />)` changes tree structure, so the current compiler leaves it to
React. Keys tell React which row identity survived an insert, delete, or move; they do not make
reconciliation unnecessary.

Calling a Hook directly inside `items.map(...)` is invalid React because the number or order of Hook
calls can change. Put the Hook inside a separate `Row` component and key that component. The compiler
has a regression test confirming that the invalid inline shape is rejected rather than transformed.

## Heavy compiler-on/off benchmark

The page also contains `HeavyInteractionBenchmark`: one component with 768 static host nodes, three
local state cells, and a small number of dynamic text/attribute targets. It represents a workload
the current compiler is designed to optimize—a large stable tree with sparse local updates.

Run the full crossover benchmark:

```bash
pnpm exec playwright install chromium
pnpm experiment:heavy
```

The runner builds and measures compiler off → on → off to reduce ordering bias. Each trial performs
30 warmup updates, followed by 120 samples of 20 sequential updates (2,400 measured updates). A
sample measures browser button dispatch through the observed DOM mutation. It also verifies final
state, browser errors, component executions, the number of rendered workload nodes, and whether the
production bundle actually contains the compiled component marker.

Repeated reference run on Apple M1, Chromium 145:

| Metric                       |    Compiler off | Compiler on |                        Change |
| ---------------------------- | --------------: | ----------: | ----------------------------: |
| Median update latency        |        0.170 ms |    0.020 ms | **88.2% lower / 8.5× faster** |
| p95 update latency           |        0.215 ms |    0.030 ms |               **86.0% lower** |
| Component executions added   | 2,430 per trial |           0 |  All update rerenders removed |
| Production page chunk (gzip) |         3,953 B |     5,221 B |                  **+1,268 B** |

The timing result is intentionally narrow. It does not include browser layout/paint, network work,
effects, child component updates, or dynamic/keyed structure. Those either add costs outside the
measured update path or currently fall back to React. Run the command on target devices before using
the reference number for a product decision.

The environment flag controls the two production builds; omission defaults to enabled:

```bash
FARM_REACT_COMPILER=true pnpm build
FARM_REACT_COMPILER=false pnpm build
```

Read the [React compiler guide](https://farm.js.dev/docs/renderers/react#experimental-aot-compiler)
for the supported component contract, configuration modes, and rollout guidance.
