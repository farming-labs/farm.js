# FARMJS React AOT compiler edge lab

This production-browser experiment answers two questions:

1. Why build this compiler? Eligible local `useState` updates can patch precomputed DOM targets
   without rerunning the component body or asking React to reconcile the same static tree again.
2. Where must it stop? Eligible host-only conditionals and keyed lists use small React-owned
   boundaries. Effects, refs, unsupported list shapes, and other unproven structures stay on React.

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

The command creates a production build, starts it on a local port, runs desktop and mobile Chromium
assertions, checks for console/runtime errors and horizontal overflow, saves screenshots under
`/tmp/farm-react-aot-edge-lab*`, and prints a JSON report.

## Expected report

| Experiment                  | Compiled result                                         | Base React / fallback result                   | What it proves                                                         |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Two direct updates          | state `2`, update executions `0`                        | state `2`, update executions `2`               | Eligible updates skip post-mount component executions.                 |
| Batched functional updates  | count `2`, snapshot `0`, update executions `0`          | count `2`, snapshot `0`, update executions `1` | The compiler preserves queued updater and event snapshot behavior.     |
| Two state cells             | text/class/data/input all update, update executions `0` | —                                              | AOT dependency lists update only bindings affected by each state cell. |
| Automatic keyed map         | insert and reverse rows, update executions `0`          | —                                              | A direct item-keyed map gets its own React refresh boundary.           |
| Explicit `List`             | stateful rows reorder, update executions `0`            | —                                              | React preserves custom-row state by key inside the isolated boundary.  |
| Calculated style bindings   | value `6`, progress `50%`, update executions `0`        | —                                              | Safe calls and individual CSS properties use prepared dependencies.    |
| Controlled form bindings   | textarea/select/checkbox update, executions `0`         | —                                              | Form properties and textarea selection stay coherent.                  |
| Logical conditional block  | branch mounts, updates, and unmounts; executions `0`    | —                                              | Only the isolated React block refreshes.                               |
| Ternary conditional block  | `strong` and `span` replace each other; executions `0`  | —                                              | React preserves branch and event semantics without the outer rerender. |

The package runtime test also measures one equivalent update under a React `Profiler`:

| Path       | Component renders | React commits | DOM result            |
| ---------- | ----------------: | ------------: | --------------------- |
| FARMJS AOT |                 1 |             1 | Text and class update |
| Base React |                 2 |             2 | Text and class update |

For this narrow eligible update, AOT removes all React render/commit work caused by the local update.
This is a structural result, not a claim that an entire application is twice as fast. End-to-end
speed depends on event work, DOM work, layout, paint, application shape, and device.

## Keys and Hooks boundary

For a direct `items.map(item => <Row key={item.id} />)`, the compiler can isolate the list update
from the outer component. Keys tell React which row identity survived an insert, delete, or move;
they do not make reconciliation unnecessary. React still compares the rows and owns their DOM,
events, lifecycle, and state.

The explicit equivalent separates collection, key, and rendering:

```tsx
import { List } from "@farm.js/react/list";

<div>
  <List each={items} by={(item) => item.id}>
    {(item) => <Row item={item} />}
  </List>
</div>;
```

`List` is useful for custom stateful rows and still works as ordinary React when the compiler is
off. Automatic maps and optimized `List` boundaries currently need to be the only meaningful child
of their host container. Index keys, missing keys, chained maps, and mixed sibling structures fall
back to the complete React component. Farm does not perform compiler-owned LIS moves in this stage;
React remains the sole owner of row reconciliation.

Calling a Hook directly inside `items.map(...)` or a `List` render callback is invalid React because
the number or order of Hook calls can change. Put the Hook inside a separate `Row` component and key
that component. The compiler has a regression test confirming that the invalid inline shape is
rejected rather than transformed.

## Conditional block boundary

The `07A` and `07B` cards exercise `condition && <host />` and
`condition ? <host /> : <host />` in the production browser build. The compiler records each
condition's state dependencies and lowers the child to a private React boundary. A matching state
update refreshes that boundary while the user component's execution counter stays unchanged.

This does not pre-mount both branches or bypass React's event system. React still creates, replaces,
and removes the selected host branch. Custom components, hooks, fragments, nested conditionals,
lists, refs, spreads, and dangerous HTML inside a branch intentionally fall back.

## Heavy compiler-on/off benchmark

The page also contains `HeavyInteractionBenchmark`: one component with 768 static host nodes, three
local state cells, and a small number of dynamic text/attribute targets. It represents a workload
the current compiler is designed to optimize—a large stable tree with sparse local updates.

Run the full crossover benchmark:

```bash
pnpm --filter @farm.js/react build
pnpm --filter farm-react-compiler-example exec playwright install chromium
pnpm --filter farm-react-compiler-example experiment:heavy
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
effects, child component updates, or keyed-list reconciliation. Those add costs outside the
measured update path. Unsupported dynamic structures still fall back to React. Run the command on
target devices before using the reference number for a product decision.

The environment flag controls the two production builds; omission defaults to enabled:

```bash
FARM_REACT_COMPILER=true pnpm --filter farm-react-compiler-example build
FARM_REACT_COMPILER=false pnpm --filter farm-react-compiler-example build
```
