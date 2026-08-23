# FARMJS React AOT compiler edge lab

This production-browser experiment answers two questions:

1. Why build this compiler? Eligible local `useState` updates can patch precomputed DOM targets
   without rerunning the component body or asking React to reconcile the same static tree again.
2. Where must it stop? Dedicated host-only conditionals and keyed lists can use compiler-owned
   branches or rows. Keyed rows can also use React-owned local conditional slots with compiler
   snapshots. Complex conditionals, custom rows, and component islands use React-owned boundaries.
   Effects, refs, unsupported shapes, and other unproven structures stay on React.

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
| Automatic keyed map         | stable row DOM, three LIS moves for a four-row reversal  | —                                              | AOT rows patch in place and use the minimum reorder moves.              |
| Derived keyed collection    | 2,048 source rows filter, sort, slice, and reverse; executions `0` | —                                      | Collection dependencies feed keyed rows without rerunning the owner.    |
| Interactive keyed rows      | latest item/index after updates and reorder; executions `0` | —                                           | React owns events/structure while Farm patches same-key row bindings.   |
| Conditional row blocks      | only changed keyed branches refresh; owner executions `0`  | —                                           | Per-key snapshots isolate logical and ternary row content.              |
| Explicit `List`             | stateful rows reorder, update executions `0`            | —                                              | React preserves custom-row state by key inside the isolated boundary.  |
| Calculated style bindings   | value `6`, progress `50%`, update executions `0`        | —                                              | Safe calls and individual CSS properties use prepared dependencies.    |
| Controlled form bindings   | textarea/select/checkbox update, executions `0`         | —                                              | Form properties and textarea selection stay coherent.                  |
| Logical conditional block  | stable branch patches, mounts, and unmounts; executions `0` | —                                           | A proven host branch updates without React reconciliation.             |
| Ternary conditional block  | `strong` and `span` replace each other; executions `0`     | —                                           | Only the compiler-owned branch is replaced.                            |
| Composable nested blocks   | two lists, nested conditions, and one component island  | —                                              | One block graph mounts, updates, and cleans up nested subscriptions.    |

The package runtime test also measures one equivalent update under a React `Profiler`:

| Path       | Component renders | React commits | DOM result            |
| ---------- | ----------------: | ------------: | --------------------- |
| FARMJS AOT |                 1 |             1 | Text and class update |
| Base React |                 2 |             2 | Text and class update |

For this narrow eligible update, AOT removes all React render/commit work caused by the local update.
This is a structural result, not a claim that an entire application is twice as fast. End-to-end
speed depends on event work, DOM work, layout, paint, application shape, and device.

## Keys and Hooks boundary

For a dedicated host container such as
`<ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>`, the compiler can prepare the
row host tree and its dynamic bindings at build time. React creates or hydrates the initial rows.
After mount, the list runtime keeps one row instance per key, patches surviving text, attributes,
and styles directly, and inserts or removes only changed host rows. For reorders, a longest
increasing subsequence (LIS) identifies the rows already in a valid relative order, so only the
remaining rows move.

The explicit equivalent separates collection, key, and rendering:

```tsx
import { List } from "@farm.js/react/list";

<div>
  <List each={items} by={(item) => item.id}>
    {(item) => <Row item={item} />}
  </List>
</div>;
```

`List` still works as ordinary React when the compiler is off. An inline host-only `List` row can
use the same compiler-owned row path. A custom stateful row such as `<Row item={item} />` stays in a
React-owned keyed boundary so React preserves its Hooks, events, lifecycle, and Fiber state. The
outer compiled component can still avoid rerunning.

The compiler-owned path requires one keyed map or `List` as the only meaningful child of a nested
host container. Its collection may chain synchronous inline `filter`, `slice`, `toSorted`, and
`toReversed` operations. The compiler records the state dependencies used by those operations and
reruns the pipeline only when one changes; it still performs the necessary filtering or sorting.
Mutating methods, external or async callbacks, Hooks, assignments, spread arguments, and unproven
calls fall back to React.

An otherwise eligible host row can include inline synchronous events. React installs and dispatches
those event props; Farm does not add a native listener. A stable proxy resolves the newest item and
index for that key when the event fires. With the same key sequence, Farm patches the prepared row
bindings without rerunning the map. When keys are inserted, removed, or reordered, React reconciles
the structure once; Farm then adopts the committed rows and resumes direct same-key patches. The
`04C` card verifies capture and stop-propagation behavior, latest-item lookup across three clicks,
row identity through a reversal, and zero owner update executions.

The `04D` card adds two branch slots to every keyed row. Each logical or ternary expression is the
only child of a persistent host container. Farm scopes the prepared test and branch-value snapshot
to the row key, then asks React to refresh only a slot whose selected branch or active values
changed. The card toggles status and details independently, rotates the rows, checks that their DOM
identity survives, and verifies zero outer component executions for same-key updates.

React still owns the branch Fiber, initial render, hydration, errors, and every structural list
commit. This is why row conditionals do not use the manual insertion or LIS path. Branch events,
components, fragments, refs, SVG, nested blocks, or a conditional mixed with another child in the
same slot use the existing React-owned list fallback.

Non-inline or async row handlers, controlled interactive form fields, custom components, fragments,
refs, SVG, static siblings in that same container, and index or missing keys use the React-owned
list path. Duplicate keys discovered at runtime remount that container through React. LIS applies
to non-interactive compiler-owned rows; interactive structural changes intentionally stay with
React. Neither path makes insertions, removals, key comparison, collection work, or DOM updates
disappear.

The example includes ES2023 TypeScript library declarations because `toSorted` and `toReversed`
are standard runtime methods that the compiler preserves rather than polyfills.

Calling a Hook directly inside `items.map(...)` or a `List` render callback is invalid React because
the number or order of Hook calls can change. Put the Hook inside a separate `Row` component and key
that component. The compiler has a regression test confirming that the invalid inline shape is
rejected rather than transformed.

## Conditional block boundary

The `07A` and `07B` cards exercise `condition && <host />` and
`condition ? <host /> : <host />` as the only child of a dedicated host container. The compiler
records each condition and prepares descriptors plus text/attribute/style bindings for both host
branches. React creates or hydrates the initial branch. After mount, a same-branch update patches
that existing element, while a condition change mounts, removes, or replaces only the branch. The
production assertion checks that updating `07A` keeps the exact same branch DOM node.

This does not pre-mount both branches or bypass React's event system. Branch events, custom
components, fragments, refs, SVG, keys, spreads, nested dynamic blocks, and dangerous HTML keep a
React-owned conditional boundary or fall back to the original component. A numeric logical value
such as `0 && <p />` also remounts through React so visible primitive output is preserved exactly.

The `08` card combines those boundary types under one outer conditional. It also proves that a
hidden outer block removes its inner subscriptions: updates made while hidden do no render work,
and remounting reads the newest compiler-cell values. Child-local React state resets after the
outer branch unmounts, matching ordinary React semantics.

## Heavy compiler-on/off benchmark

The page contains two measured workloads:

- `HeavyInteractionBenchmark` has one component with 768 static host nodes, three local state
  cells, and a small number of dynamic text/attribute targets.
- `ComponentIslandExperiment` has one state-dependent React child beside a React-owned component
  that produces 768 static host nodes. The child keeps local Hook state while the compiler skips
  the outer owner and unchanged static sibling.

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

The component-island sample waits for the dependent React child to commit, so its latency includes
that child render. It does not stop at the earlier direct owner binding.

Repeated reference run on Apple M1, Chromium 145:

| Metric                       |    Compiler off | Compiler on |                        Change |
| ---------------------------- | --------------: | ----------: | ----------------------------: |
| Median update latency        |        0.175 ms |    0.015 ms | **91.4% lower / 11.7× faster** |
| p95 update latency           |        0.210 ms |    0.030 ms |                **85.7% lower** |
| Component executions added   | 2,430 per trial |           0 |  All update rerenders removed |
| Production page chunk (gzip) |         6,948 B |    10,792 B |                  **+3,844 B** |

Component-island reference run from the same crossover method:

| Metric                              | Compiler off | Compiler on |                         Change |
| ----------------------------------- | -----------: | ----------: | -----------------------------: |
| Median child-commit latency         |     0.165 ms |    0.025 ms | **84.8% lower / 6.6× faster**  |
| p95 child-commit latency            |     0.180 ms |    0.110 ms |                **38.9% lower** |
| Owner executions added per trial    |        2,430 |           0 |       Owner rerenders removed |
| Static sibling executions per trial |        2,430 |           0 | Static rerenders removed      |

The timing result is intentionally narrow. It does not include browser layout/paint, network work,
effects, or compiler-owned keyed-row work. The component-island row does include its dependent child
update, but not layout, paint, or unrelated application work. Unsupported dynamic structures still
fall back to React. Run the command on target devices before using the reference number for a
product decision.

The environment flag controls the two production builds; omission defaults to enabled:

```bash
FARM_REACT_COMPILER=true pnpm --filter farm-react-compiler-example build
FARM_REACT_COMPILER=false pnpm --filter farm-react-compiler-example build
```
