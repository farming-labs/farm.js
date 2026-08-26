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
Set `FARM_EXPERIMENT_BROWSER_PATH` to an existing Chrome or Chromium executable when the machine
uses a managed browser installation instead of Playwright's downloaded browser.

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
| Editable keyed rows         | caret, fields, identity, and a 256-row load; executions `0` | —                                           | Controlled form properties update by key without rerunning the owner.  |
| Conditional row blocks      | only changed keyed branches refresh; owner executions `0`  | —                                           | Per-key snapshots isolate logical and ternary row content.              |
| Explicit `List`             | stateful rows reorder, update executions `0`            | —                                              | React preserves custom-row state by key inside the isolated boundary.  |
| Root keyed ranges           | exact card root, two ranges, three LIS moves, 1,024-row load | —                                          | Multiple host lists reconcile without an artificial outer wrapper.     |
| Calculated style bindings   | value `6`, progress `50%`, update executions `0`        | —                                              | Safe calls and individual CSS properties use prepared dependencies.    |
| Controlled form bindings   | textarea/select/checkbox update, executions `0`         | —                                              | Form properties and textarea selection stay coherent.                  |
| Logical conditional block  | stable branch patches, mounts, and unmounts; executions `0` | —                                           | A proven host branch updates without React reconciliation.             |
| Ternary conditional block  | `strong` and `span` replace each other; executions `0`     | —                                           | Only the compiler-owned branch is replaced.                            |
| Root conditional ranges    | exact card root, two ranges, stable static siblings; executions `0` | —                                  | Direct branches reconcile without wrappers or marker nodes.            |
| Composable nested blocks   | two lists, nested conditions, and one component island  | —                                              | One block graph mounts, updates, and cleans up nested subscriptions.    |
| Keyed row host blocks      | 1,000 rows, one LIS move, nested branch patches, executions `0` | —                                      | Each key owns its safe recursive host conditions without React commits. |
| Nested keyed rows          | 256 projects, 2,048 tasks, one LIS move per level, executions `0` | —                                    | Every outer key owns an isolated inner key table and LIS scope.         |
| Recursive keyed scopes     | 48 boards, 288 columns, 2,304 cards, one LIS move per level, executions `0` | —                         | Keyed scope analysis continues through every safe host-row depth.       |

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

The compiler-owned path supports one dedicated keyed map/`List`, or one or more non-interactive host
ranges in a nested or component-root container. A collection may chain
synchronous inline `filter`, `slice`, `toSorted`, and `toReversed` operations. The compiler records
the state dependencies used by those operations and reruns the pipeline only when one changes; it
still performs the necessary filtering or sorting. Mutating methods, external or async callbacks,
Hooks, assignments, spread arguments, and unproven calls fall back to React.

An otherwise eligible host row can include inline synchronous events. React installs and dispatches
those event props; Farm does not add a native listener. A stable proxy resolves the newest item and
index for that key when the event fires. With the same key sequence, Farm patches the prepared row
bindings without rerunning the map. When keys are inserted, removed, or reordered, React reconciles
the structure once; Farm then adopts the committed rows and resumes direct same-key patches. The
`04C` card verifies capture and stop-propagation behavior, latest-item lookup across three clicks,
row identity through a reversal, and zero owner update executions.

The `04D` card contains controlled text, select, and checkbox fields. React keeps event, hydration,
and structural ownership; Farm patches the prepared form properties and row output for the changed
key. The production test edits in the middle of a focused input, changes the other fields, rotates
the rows while checking DOM and selection identity, loads 256 rows, and observes zero owner update
executions. File inputs, dynamic control types or option attributes, content-editable trees, refs,
custom controls, and async or non-inline handlers remain React fallbacks.

The `04E` card covers the interactive tier: Farm scopes a prepared branch snapshot to each row key,
then asks React to refresh only a slot whose selected branch or active values changed. The card
toggles status and details independently, rotates the rows, checks that their DOM identity survives,
and verifies zero outer component executions for same-key updates.

React still owns the branch Fiber, initial render, hydration, errors, and every structural list
commit for this interactive tier. Branch events, components, fragments, refs, SVG, and unsupported
nested blocks use the existing React-owned list fallback.

The `04G` card is itself the returned host root. It places two non-interactive maps between its
header, metrics, labels, and footer. React renders that original `article`; Farm adopts its direct
element ranges after mount without inserting a wrapper or hydration marker. The production test
rotates both ranges, observes three total LIS moves, preserves the root, surviving rows, and all
static siblings, crosses empty ranges, loads 1,024 rows, and records zero owner update executions.

Non-inline or async row handlers, unsupported form shapes, custom components, fragments, refs, SVG,
interactive ranges beside siblings, and index or missing keys use the React-owned list path.
Duplicate keys discovered at runtime remount that container through React. LIS applies to
non-interactive compiler-owned rows; interactive structural changes intentionally stay with React.
Neither path makes insertions, removals, key comparison, collection work, or DOM updates disappear.

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

The `07C` card covers the wider range form. Its returned `article` contains a logical branch and a
ternary branch separated by static header, content, metrics, and footer elements. Farm adopts that
exact component root after React renders or hydrates it. Updating values preserves a same-branch
node; changing both conditions in one event mounts one range and replaces the other from the same
state snapshot. The browser assertion then removes the logical range again and verifies that the
root and every static sibling are still the original DOM nodes, no marker nodes were added, and the
component recorded zero update executions.

This does not pre-mount both branches or bypass React's event system. Branch events, custom
components, fragments, refs, SVG, keys, spreads, unsupported nested structures, and dangerous HTML keep a
React-owned conditional boundary or fall back to the original component. A numeric logical value
such as `0 && <p />`, a parent-driven prop change, Fast Refresh, or invalid adopted DOM remounts the
affected range container through React so visible output and React ownership remain exact.

The `08` card combines those boundary types under one outer conditional. It also proves that a
hidden outer block removes its inner subscriptions: updates made while hidden do no render work,
and remounting reads the newest compiler-cell values. Child-local React state resets after the
outer branch unmounts, matching ordinary React semantics.

The `09` card transfers the outer branch and its recursively nested host-only conditions and keyed
ranges to compiler ownership. One action changes a nested condition, a deeper condition, and a
keyed order while preserving the outer branch, static heading, and every surviving keyed row. The
hide/update/show sequence verifies that removed scopes receive no stale work and remount from the
latest cells. The production assertion records zero owner update executions. Interactive rows,
Hooks, custom components, refs, SVG, branch events, and mixed conditional/list slots remain React
fallbacks.

The `10` card transfers that recursive host ownership into each non-interactive keyed row. Its 1,000
rows contain a ternary beside static siblings, a deeper logical branch, and a second row-local
condition. One action rotates the list with one LIS move while replacing one branch and patching a
surviving nested branch. The production assertion preserves the row, active branch, and both static
siblings, then removes and inserts one row and verifies zero owner update executions. The same path
is automatic for an eligible `.map(...)` or inline host row in `List`; it needs no new option.

The `11` card adds a separately keyed task list to every project row. One action rotates 256 outer
projects and one project's eight tasks, producing exactly one measured LIS move at each level while
preserving the project, surviving task, and static heading/footer nodes. A second action removes and
inserts only one inner task. The production assertion covers 2,048 task rows and records zero owner
update executions.

The `12` card continues the same ownership model through boards, columns, and cards. One action
rotates all 48 boards, the six columns inside one board, and the eight cards inside one column. The
browser assertion observes exactly one LIS move at every level, preserves the selected board,
column, cards, and static siblings, then removes and inserts one deepest card. It covers 2,304 card
rows and records zero owner update executions.

Hooks, custom components, row, branch, or inner-row events, refs, SVG, fragments, dangerous HTML,
controlled inputs inside a condition, and unproven expressions stay on React. Safe host-only keyed
levels recurse; duplicate keys at any level switch the mounted outer list to React.

The `13` card interleaves logical and ternary branches with a keyed row range in one host container.
Each row recursively owns another condition and keyed tag range. One action changes both outer
branches, rotates all 32 rows with one LIS move, changes a row-local condition, and rotates its tags
with one nested LIS move. The browser assertion preserves the selected row, tag, header, divider,
and footer, then removes and inserts one row while recording zero owner update executions.

Mixed ownership remains host-only. Branch or row events, Hooks, custom components, controlled
forms, refs, SVG, fragments, spreads, dangerous HTML, duplicate keys, or an invalid adopted shape
use the complete React-owned container.

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
