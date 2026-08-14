# FARMJS React AOT compiler edge lab

This production-browser experiment answers two questions:

1. Why build this compiler? Eligible local `useState` updates can patch precomputed DOM targets
   without rerunning the component body or asking React to reconcile the same static tree again.
2. Where must it stop? Keyed lists, effects, refs, custom components, and other dynamic structures
   stay on React whenever the compiler cannot prove that a direct binding preserves behavior.

The default `compiler: true` configuration automatically considers components. No annotation is
needed. A component can explicitly opt out with `"use no compiler"`.

## Run the automated experiment

From the repository root:

```bash
pnpm --filter @farm.js/react build
pnpm --filter farm-react-compiler-example exec playwright install chromium
pnpm --filter farm-react-compiler-example experiment
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

`items.map(item => <Row key={item} />)` changes tree structure, so Group 1 leaves it to React. Keys
tell React which row identity survived an insert, delete, or move; they do not make reconciliation
unnecessary.

Calling a Hook directly inside `items.map(...)` is invalid React because the number or order of Hook
calls can change. Put the Hook inside a separate `Row` component and key that component. The compiler
has a regression test confirming that the invalid inline shape is rejected rather than transformed.
