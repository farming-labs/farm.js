# @farm.js/react

React renderer integration for FARMJS, including the experimental AOT compiler.

React remains the default renderer and needs no package or configuration. Install this package only
when opting into the compiler experiment:

```bash
pnpm add @farm.js/react
```

```ts
import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

export default defineConfig({
  renderer: react({
    experimental: {
      compiler: true,
    },
  }),
});
```

`compiler: true` uses inference: every application TSX/JSX component is considered, eligible
components are compiled with hybrid reactivity, and everything else keeps the normal React path.

Hybrid reactivity starts from the compiler's proven state-to-binding dependency lists, then marks
only multi-state short-circuit bindings for runtime read tracking. For
`enabled ? activeValue : inactiveValue`, an update to the inactive value does not schedule the
binding. The runtime uses direct subscription indexes rather than proxies or a component-wide
scan. Use `compiler: { reactivity: "static" }` to retain only the complete build-time dependency
lists for comparison or diagnosis.

Compiler output also selects its runtime capabilities at build time. A direct counter imports only
the cell scheduler and direct-binding core; conditionals, keyed rows and LIS, nested host ranges,
and component islands are retained only when a compiled component in that module needs them. Plain
keyed rows omit the larger recursive-host and row-conditional extensions. This selection is
automatic and does not add a configuration option or asynchronous runtime loading. The legacy
`createCompiledComponent` export remains a complete compatibility entry for hand-authored
definitions, while generated code uses the tree-shakable feature entry.

The persisted production-size fixtures and regression gate live in
[`RUNTIME_SIZE_RESULTS.md`](./RUNTIME_SIZE_RESULTS.md). The recorded direct-only runtime premium is
82.6% smaller than the complete compatibility runtime premium; the feature-heavy keyed benchmark
application removes 6,185 gzip bytes from its previous compiler-on build.

For selective adoption, use annotation mode:

```ts
renderer: react({
  experimental: {
    compiler: {
      mode: "annotation",
      directive: "use compiler",
      onUnsupported: "warn",
      reactivity: "hybrid",
    },
  },
}),
```

```tsx
export function Counter() {
  "use compiler";
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>;
}
```

The directive is configurable and only has meaning in annotation mode.

## Current compiler contract

The current compiler handles components that it can prove have:

- one host-element root and a statically known host-element tree around supported conditional,
  keyed-list, and React component-island boundaries;
- an identifier props parameter or flat object destructuring with aliases and defaults;
- build-time dependency cells for referenced flat primitive props, with runtime identity guards;
- top-level `useState` declarations;
- optional compiler-safe derived `const` values declared after state and in source order;
- whitelisted `Boolean`, `Number`, `String`, and deterministic `Math` calculations;
- optional synchronous `const` or function-declaration handlers used by JSX events;
- state-driven text, attributes, per-property inline styles, and controlled form properties;
- host-rooted `condition && <element>` and `condition ? <element> : <element>` child blocks at
  statically known locations, including direct ranges among static siblings and at the component
  root;
- item-keyed `collection.map(...)` children and explicit `List` boundaries at statically known
  container locations, including supported non-mutating collection pipelines;
- inline synchronous events inside otherwise eligible host-only keyed rows;
- multiple and recursively nested logical or ternary host branches inside non-interactive keyed
  rows, including branches beside static host siblings;
- stable module-level child components with compiler-safe props;
- React-managed event handlers; and
- no refs, effects, or unsupported dynamic child structures.

The generated component preserves React ownership of initial placement, parent update commits,
identity-bearing props, events, SSR, and hydration. Local state cells batch updates into a
microtask; eligible flat destructured primitive props join the same dependency index after React
commits their parent update. The runtime skips unchanged binding output and patches only
compiler-known DOM targets. Objects, arrays, functions, symbols, React elements, `children`, and
identifier props retain the normal React prop-render path. Proven host containers
can transfer child ownership after mount for host-only conditional
branches and ranges, plus non-interactive host-only keyed rows and their recursively nested host
conditions. An interactive row uses a hybrid boundary instead: React retains its events,
conditional Fibers, and structural reconciliation, while Farm patches same-key bindings and
refreshes only changed React-owned row-local branches. React still creates or hydrates all initial
DOM. Anything outside those narrow contracts uses a small React-owned boundary or the complete
original component.

For a common dedicated conditional, no new component or annotation is required:

```tsx
<div className="status-slot">
  {enabled ? <strong>Enabled {count}</strong> : <span>Disabled {count}</span>}
</div>
```

When the conditional is the container's only meaningful child, the container has only static
properties, and each branch is a statically known host tree without events, refs, custom components,
or other dynamic structures, the compiler emits
both host descriptors and their exact text/attribute/style bindings. After the initial React render
or hydration, a same-branch update patches those bindings without replacing the element. A condition
change creates, removes, or replaces only the selected branch. No marker node is added to SSR output.
More complex conditional shapes keep the existing React-owned conditional boundary.

Eligible direct conditionals can also share a host container with static host siblings:

```tsx
<article data-update={updates}>
  <header>Status</header>
  {loading && <p>Loading {updates}</p>}
  <section>Stable content</section>
  {enabled ? <strong>Enabled</strong> : <span>Disabled</span>}
  <footer>Actions</footer>
</article>
```

That `article` may be the component's exact returned root. Farm adopts the original container and
counts its direct static elements as anchors for the conditional ranges. Same-branch bindings patch
in place; branch changes insert, remove, or replace only their range. Multiple changed ranges use
one state snapshot and reconcile from right to left, including when adjacent ranges are empty. The
root and every unchanged static sibling keep their DOM identity, and no wrapper or marker is added.
Branch events, components, fragments, refs, SVG, spreads, nested dynamic blocks, or another
unsupported direct child keep the container on the React-owned path.

For a common keyed map, no new API is required:

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}
</ul>
```

When this map is the only meaningful child of a dedicated host container and its rows are host-only,
the compiler prepares a row descriptor, a key reader, and exact text/attribute/style bindings at
build time. After React performs the initial render or hydration, Farm adopts those row elements.
Later list updates patch surviving rows by key, create or remove only the changed rows, and use a
longest increasing subsequence (LIS) to minimize DOM moves during a reorder. The outer user
component and the list callback do not rerun for those compiler-cell updates.

When a separate state cell or primitive prop is compared with the exact row-key expression using
`===` or `!==`, the compiler emits a key-directed binding proof. A selection change such as
`item.id === selectedId` then looks up only the previously selected and newly selected row
instances. Class, attribute, style, and leaf-text bindings on those rows update without evaluating
the other keyed instances. The proof requires one reactive target used only in strict comparisons;
mixed structural dependencies, ambiguous expressions, non-primitive runtime targets, React-owned
rows, and unsupported shapes keep the complete scan or React fallback. No option is required, and
the compiler report exposes the emitted binding count as `keyedIdentityTargets`.

For multi-selection, an exact local-state expression such as `markedIds.has(item.id)` receives a
separate Set-membership proof. The runtime compares the previous and next native `Set` snapshots and
patches only row keys in their symmetric difference. It accepts ordinary native sets containing
primitive keys. Different fields, extra reactive dependencies, Set subclasses or proxies, object
members, customized `has` behavior, React-owned rows, nested blocks, and structural dependencies
stay on the existing complete or React-owned paths. The compiler report exposes this count as
`keyedMembershipTargets`.

For per-row data, an exact local-state expression such as `statusById.get(item.id)` receives a
separate Map-lookup proof. The runtime compares the previous and next native `Map` snapshots and
patches only row keys whose mapped primitive value changed. It accepts ordinary native maps with
primitive keys and primitive or nullish values. Different fields, extra dependencies, Map
subclasses or proxies, object values, customized `get` behavior, React-owned rows, nested blocks,
and structural dependencies keep the existing complete or React-owned paths. The compiler report
exposes this count as `keyedMapLookupTargets`.

When a targeted Set or Map is compiler-owned, Farm can also carry the exact mutated keys from a
proven immutable functional update:

```tsx
setMarkedIds((current) => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
});

setStatusById((current) => new Map(current).set(id, "ready"));
```

The application still creates its normal immutable collection. The generated update records only
the native `add`, `delete`, or `set` calls that execute, and the runtime validates those keys
against the previous committed collection. It can then update the relevant keyed rows without
iterating every old and new Set member or Map entry first. Queued functional updates compose, and
the runtime periodically compacts its persistent snapshot so a long update chain stays bounded.

This proof is deliberately conservative. The state must start from a compiler-owned native
`Set`/`Map`; every setter use must be a fresh same-kind replacement or a recognized immutable
updater; and the collection, updater parameter, and cloned draft must not escape or be mutated
through unknown code. Shadowed constructors, custom collections, object keys, object Map values,
direct state mutation, aliased drafts, or a failed runtime check use the existing snapshot or
React-owned path before compiled bindings run. No option or syntax is added. The compiler report
counts emitted native mutation sites as `keyedCollectionUpdateHints`.

For a direct keyed `useState` collection, the compiler also recognizes conservative same-order
updates such as:

```tsx
setItems((current) =>
  current.map((item) => (item.id === targetId ? { ...item, selected: !item.selected } : item)),
);
```

The generated native `map()` records which indexes returned new item identities. Farm then
validates that length, keys, and positions are unchanged and patches only those row instances. The
user's `map()` remains O(n); this removes the keyed runtime's second full key-and-binding scan.
Queued hints compose. Key changes, structural edits, relevant mixed dependencies, and failed runtime
checks use the existing complete reconciliation and LIS path. Non-functional setters, derived
collections, block-bodied or mutating mappers, and other unproven forms are simply not hinted. No
new option is required. A compiler report exposes the emitted-site count as
`keyedMapUpdateHints`. The separate hint runtime capability is imported only when that count is
nonzero, so direct-only and ordinary keyed builds do not retain it.

The same optional runtime recognizes conservative immutable appends on a direct keyed array:

```tsx
setItems((current) => [...current, nextItem]);
setItems((current) => [...current, ...nextItems]);
```

Because every existing item keeps its key and index, Farm validates the committed source and the
queued append chain, reads keys and descriptors only for the appended suffix, and mounts that
suffix in one fragment. Existing row DOM is left untouched. The concise functional updater and
native arrays are required; middle insertion, removal, direct replacement, duplicate
keys, rows that read the collection itself, and failed runtime checks use complete keyed
reconciliation. A key that reads the collection prevents hint emission entirely. The compiler
report exposes the emitted-site count as
`keyedArrayAppendHints`.

The mirror-image prepend form is supported when the keyed row and key do not read the row index:

```tsx
setItems((current) => [nextItem, ...current]);
setItems((current) => [...nextItems, ...current]);
```

Farm validates the committed source and queued prepend chain, creates only the new prefix, inserts
it before the first existing row, and shifts the stored indexes used by delegated row events.
Existing row DOM and bindings stay in place. Index-aware rows, collection-reading bindings or
keys, React-owned row structures, middle insertion, direct replacement, duplicate keys, custom or
sparse arrays, and failed validation use complete keyed reconciliation. The compiler report
exposes the emitted-site count as `keyedArrayPrependHints`.

Native slices with compiler-safe bounds can carry their exact retained interval into the same
removal runtime:

```tsx
setItems((current) => current.slice(1_000));
setItems((current) => current.slice(0, -1_000));
setItems((current) => current.slice(2, 8));
setItems((current) => current.slice(trimCount));
setItems((current) => current.slice(visible.start, visible.end));
```

For compiler-owned host rows whose render and key do not read the row index, Farm validates the
committed source and queued slice chain, preserves every surviving DOM row, and removes only rows
outside the retained interval. A slice-only chain does not reread surviving keys, descriptors, or
bindings. One or two safe-integer literals or compiler-safe runtime expressions are required.
Identifiers, property reads, side-effect-free arithmetic and conditionals, and safe `Math` calls
are supported. Farm preserves native method lookup, argument evaluation, coercion, results, and
errors, then records metadata only when the evaluated bounds are already safe integers. Calls,
assignments, updates, unsafe evaluated bounds, block-bodied or chained updates, custom slice
methods, sparse or subclassed arrays, index-aware or collection-reading rows, React-owned
structures, and failed validation keep complete keyed reconciliation. No option or component is
added. The compiler report exposes the emitted-site count as `keyedArraySliceHints`.

A fixed-size feed can combine that retained tail with a new keyed suffix:

```tsx
setItems((current) => [...current.slice(1), nextItem]);
setItems((current) => [...current.slice(1_000), ...nextItems]);

const trimCount = pageSize * pagesToExpire;
setItems((current) => [...current.slice(trimCount), ...nextItems]);
```

Farm executes the ordinary native slice and array construction, then validates the complete hint
chain back to the committed source, retained item identities, and final incoming keys. Multiple
rolling setters queued before one compiler flush collapse into one cumulative prefix removal; rows
introduced by an earlier setter are created only if they remain in the final suffix. Farm removes
only the expired committed prefix, leaves the retained DOM rows in place, and creates only that
final incoming suffix. This form supports one
safe-integer literal or compiler-safe runtime slice bound and compiler-owned, index-independent
host rows. Identifiers, property reads, side-effect-free arithmetic and conditionals, and safe
`Math` calls are supported while preserving native lookup, evaluation, results, and errors.
Effectful expressions, reused keys, block-bodied updaters, custom slice behavior,
collection-reading or index-aware rows, nested or React-owned rows, mixed or unhinted queued chains,
unsafe or no-op evaluated bounds, and failed checks use complete keyed reconciliation. The
optional all-hint runtime is selected only for modules that emit this optimization. Reports expose
the site count as `keyedArrayRollingWindowHints`.

Native known-position updates can avoid a complete keyed scan too:

```tsx
setItems((current) => current.toSpliced(selectedIndex, 0, nextItem));
setItems((current) => current.toSpliced(selectedIndex, 0, nextA, nextB));
setItems((current) => current.toSpliced(selectedIndex, 0, ...incomingItems));
setItems((current) => current.toSpliced(selectedIndex, 1));
setItems((current) => current.toSpliced(selectedIndex, 25));
setItems((current) => current.toSpliced(selectedIndex, 1, replacement));
setItems((current) => current.toSpliced(selectedIndex, 25, ...replacements));
setItems((current) => current.with(selectedIndex, replacement));

// Two same-key windows may be queued before one compiler flush.
setItems((current) => current.toSpliced(firstIndex, 25, ...firstRefresh));
setItems((current) => current.toSpliced(secondIndex, 25, ...secondRefresh));
```

The compiler recognizes only a concise functional setter and either a safe-integer literal or a
compiler-safe runtime position expression, such as an identifier, property read, arithmetic,
conditional, or safe `Math` call. The update must insert one or more compiler-safe items with zero
removals, remove one item or a fixed positive safe-integer literal range, replace one item through
either `toSpliced()` or `with()`, or replace a fixed positive safe-integer literal window with
compiler-safe explicit items or a safe spread. Farm preserves method lookup,
evaluates the position and remaining arguments once in their original order, executes the ordinary
native call, and records metadata only after validating the committed native source, result, and
actual safe-integer position and clamped removal count. A batch requires at least two evaluated
items at runtime. Exact-window replacement supports a safe spread that evaluates to zero, one, or
many items. A fresh-key window creates every incoming key, descriptor, binding snapshot, and
detached row before changing the live DOM, rejects key collisions, and mounts the complete batch
through one document fragment. It then removes only the replaced window. When the incoming window
has the same length and the same keys in the same order, Farm prepares every binding read and
changed DOM target across the complete window first, patches the existing rows in place, and
updates the stored row objects used by later events. That path creates no descriptors or DOM rows,
and preserves row identity, focus, and selection. A window may instead grow or shrink while it
reorders keys from inside its own removed interval and mixes them with globally fresh keys. Farm
prepares all reused binding updates, new descriptors, binding snapshots, and detached rows before
the first DOM write. It removes only retired rows, preserves each reused row, batches adjacent new
rows in a fragment, updates shifted suffix indexes, and applies LIS only to the reused part of that
interval so it moves the fewest connected rows needed by the local permutation. Rows outside the
interval are not rerendered or rebound.
Multiple length-preserving same-key windows
queued before one compiler flush compose into one atomic refresh. Fixed-length queued windows may
mix same-key refreshes with globally new final keys, and both disjoint and overlapping windows are
supported. An overlapping position uses the last queued value; intermediate identities are never
mounted. Farm validates the complete chain and final key set, then prepares every touched key,
binding value, DOM target, new descriptor, binding snapshot, and disconnected DOM row before the
first write. It patches same-key positions and swaps only final fresh-key positions. Untouched rows
keep their identity and are not recreated. The runtime otherwise creates one inserted row,
removes only the known row or range, or patches/replaces one row at that position without rereading
every existing key, descriptor, and binding. Surviving rows keep their DOM identity. Index-aware or
collection-reading rows, custom methods, position expressions with user calls or mutations,
runtime positions that are not safe integers, dynamic, zero, negative, or fractional removal
counts, other `toSpliced()` forms, block-bodied updaters, unsafe incoming expressions, queued
chains containing a structural window or unhinted intermediate update, existing keys moved from
outside the removed interval, duplicate final keys, nested or React-owned rows, and failed checks
use complete keyed reconciliation before the fast path mutates the DOM.
Reports expose the site count as `keyedArrayPositionHints`. Batch insertion and exact-window
replacement use progressively separate optional runtime capabilities, so existing single-position
and batch-only bundles do not retain window validation or replacement code.

A direct native reverse can carry its complete permutation to a separate optional runtime:

```tsx
setItems((current) => current.toReversed());
```

Farm preserves the method lookup, call result, and errors, then records metadata only for the native
method on an ordinary array whose chain starts at the committed collection. One direct reverse
verifies equal lengths and every reversed item identity before moving the existing keyed elements
with the minimum `n - 1` connected DOM moves. It does not reread row keys, descriptors, or bindings
and does not run the generic LIS calculation. Consecutive concise native `toReversed()` and
`toSorted()` setters queued before one flush compose into one final validated permutation. The
runtime skips intermediate DOM states and uses LIS once for that final order; two reversals that
cancel perform no DOM moves. A single concise updater may also chain two or more native reorder
operations:

```tsx
setItems((current) => current.toSorted((left, right) => left.rank - right.rank).toReversed());
```

Farm evaluates every lookup and call in JavaScript order, carries the same committed token through
the pipeline, and reconciles only its final result. Index-aware or collection-reading rows,
arguments to `toReversed()`, referenced comparators, computed methods, chains containing another
method, block-bodied updaters, custom methods, sparse or subclassed behavior, an unhinted or
structural intermediate update, nested or React-owned rows, and failed checks keep complete keyed
reconciliation. Reports count each compiled reverse step as a `keyedArrayReorderHints` entry, and
modules without one omit the reorder runtime. Farm does not polyfill `Array.prototype.toReversed`.

A direct native immutable sort can use the same optional reorder runtime:

```tsx
setItems((current) => current.toSorted((left, right) => left.rank - right.rank));
setLabels((current) => current.toSorted());
```

Farm recognizes a concise functional setter with no comparator or an inline synchronous comparator
from the compiler-safe expression subset. It preserves the original method lookup, comparator,
stable native result, and errors. After the native sort runs, the runtime validates an ordinary
dense array whose reorder chain starts at the committed collection, equal lengths, and a unique
one-to-one item-identity permutation. It then uses LIS to move only `n - LIS` keyed DOM nodes
without rereading row keys, descriptors, or bindings. Multiple concise native sorts and reverses
queued in one flush, or chained in one concise updater, share the original committed token and
reconcile only their final permutation. The native sorting work itself is unchanged.

Index-aware or collection-reading rows, referenced comparators, block-bodied updaters, computed or
unsupported chained calls, custom methods, sparse or subclassed arrays, duplicate item identities,
unhinted or structural intermediate updates, nested or React-owned rows, and failed checks keep
complete keyed reconciliation. Reports count each compiled sort step as a `keyedArraySortHints`
entry; sort shares the optional reorder runtime, and Farm does not polyfill
`Array.prototype.toSorted`.

Concise immutable filters on a direct keyed array can carry removal positions into the same
optional runtime:

```tsx
setItems((current) => current.filter((item) => item.id !== removedId));
```

For compiler-owned host rows whose render and key do not observe the row index, Farm validates the
native filter chain, every surviving item identity, and every surviving key before removing only
the rejected DOM rows. It does not recreate descriptors or reread bindings for unchanged rows,
and queued filters compose before one compiler flush. Index-aware rows or predicates,
block-bodied updates, custom filter methods, sparse or subclassed arrays, collection-reading
bindings or keys, React-owned row structures, mixed dirty dependencies, and failed validation use
complete keyed reconciliation. No option or new component is required. The compiler report exposes
the emitted-site count as `keyedArrayFilterHints`.

An otherwise eligible host row may also contain an inline synchronous React event:

```tsx
<ul>
  {items.map((item, index) => (
    <li key={item.id}>
      <span>{item.label}</span>
      <button onClick={() => select(item.id, index)}>Select</button>
    </li>
  ))}
</ul>
```

The compiler leaves the event prop on the React element and emits no native listener. Its stable
keyed proxy looks up the latest item and index when React dispatches the event, so a same-key item
replacement cannot leave a stale row closure. If the key order is unchanged, Farm patches the
prepared text, attribute, and style bindings without rerunning the component or map callback. An
insert, removal, or reorder asks React to reconcile the rows, adopts the committed host elements,
reapplies current bindings, and then resumes direct same-key patches. This avoids creating eventful
DOM outside React's Fiber tree.

A non-interactive keyed row may also transfer its safe host conditions to the same keyed instance:

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>
      <span>{item.label}</span>
      <div className="status-slot">
        <i>State</i>
        {item.done ? (
          <article>
            <strong>{item.label} complete</strong>
            <div>{item.details && <small>{item.description}</small>}</div>
          </article>
        ) : (
          <span>In progress</span>
        )}
        <b>Prepared</b>
      </div>
      <section className="details-slot">{item.expanded && <p>{item.description}</p>}</section>
    </li>
  ))}
</ul>
```

The compiler prepares the row descriptor, static sibling positions, branch factories, and
text/attribute/style bindings at build time. React creates or hydrates the initial list. After
mount, a same-key update patches the active branch in place or mounts, replaces, or removes only the
changed branch. Multiple and deeper host-only conditions share that row scope. Insertions and
removals create or clean one row scope, while reorders use the normal LIS pass. The component body
and map callback do not rerun, and no wrapper or hydration marker is added.

This compiler-owned tier requires a lowercase non-interactive host row. Hooks, custom components,
branch events, refs, SVG, fragments, spreads, dangerous HTML, controlled inputs inside a condition,
and unproven expressions stay on React. An otherwise eligible row with inline events continues to
use the hybrid boundary: React owns its conditional Fibers and structural commits, while Farm
compares per-key snapshots and refreshes only changed slots. Duplicate runtime keys or invalid
adopted DOM switch the complete list to React.

An eligible outer keyed row may also own nested keyed ranges:

```tsx
<div>
  {projects.map((project) => (
    <section key={project.id}>
      <h2>{project.name}</h2>
      <ul>
        <li>Tasks</li>
        {project.tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
        <li>End</li>
      </ul>
    </section>
  ))}
</div>
```

Every outer key receives an isolated inner key table and LIS pass. Moving a project preserves its
task scope; reordering one task list touches only that project. Surviving project, task, and static
sibling elements keep their DOM identity, and removing an outer row cleans its inner scope. The
initial contract accepts non-interactive lowercase inner rows from `.map(...)` or inline `List`,
including multiple ranges separated by static host siblings. Inner events or forms, Hooks, custom
components, fragments, refs, SVG, spreads, dangerous HTML, and index keys keep the complete outer
row on React's fallback. Additional keyed levels that satisfy the same host-only contract are
analyzed recursively instead of using a fixed nesting limit.

For example, `boards → columns → cards → tags` becomes a tree of keyed scopes. Each stable parent
key owns its child key table and LIS pass. Moving a board carries its column, card, and tag scopes;
reordering cards reconciles only the selected column. Block IDs stay globally unique while runtime
instances are isolated by their complete parent-key path. Removing any parent cleans every
descendant subscription before its DOM leaves the document.

A keyed collection may use derived locals or an inline chain of `filter`, `slice`, `toSorted`, and
`toReversed`:

```tsx
const visible = items.filter((item) => item.visible && item.rank >= minimumRank);
const page = visible
  .toSorted((left, right) => left.rank - right.rank)
  .slice(offset, offset + pageSize)
  .toReversed();

return (
  <ul>
    {page.map((item) => (
      <li key={item.id}>{item.label}</li>
    ))}
  </ul>
);
```

The compiler records dependencies used by the source collection, inline predicate, inline
comparator, and slice arguments. It reruns the pipeline only when one of those compiler cells
changes, then gives the result to the existing keyed-row and LIS runtime. The required filtering or
sorting still runs; unrelated local updates avoid that work and do not rerun the outer component.
Callbacks must be synchronous, inline, and contain one compiler-safe returned expression. Mutating
`sort`, `reverse`, and `splice`, external or async callbacks, Hooks, assignments, spread arguments,
and unproven calls use the original React fallback.

`toSorted` and `toReversed` are emitted as standard runtime calls rather than polyfilled. Configure
the TypeScript `lib` with ES2023 and target a runtime that supports them when using those methods.

React remains the fallback and compatibility boundary. An interactive map beside static children,
a non-host sibling between ranges, a row with a non-inline or async handler, a file input or dynamic
form control shape, a fragment, a ref, a custom component, or any unsupported nested dynamic
structure uses the existing React-owned keyed boundary. The outer compiled component can still be
skipped, but React reconciles that list's rows and owns their events, lifecycle, and state.

Non-interactive host maps can share a nested or component-root container with static host siblings:

```tsx
<ul>
  <li>Primary</li>
  {primary.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}
  <li>Secondary</li>
  {secondary.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}
  <li>{primary.length + secondary.length} total</li>
</ul>
```

The compiler emits one range block for that host container. React renders and hydrates the original
markup. After mount, Farm records the static element segments and reconciles each keyed range with
its own row table and LIS pass. It does not add wrappers or hydration markers. When the container is
the component root, the block forwards that exact host element to the outer binding runtime, so
root attributes and styles keep updating normally. A root with one eligible map or `List` also
works without static siblings. Direct children must be host elements or eligible ranges; events,
controlled rows, row conditionals, components, fragments, and nested dynamic structures keep the
React boundary. Duplicate keys, an adoption shape mismatch, or a parent-driven static markup change
remounts the complete container through React.

Controlled host fields can use the hybrid keyed-row path:

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>
      <input
        value={item.label}
        onChange={(event) =>
          setItems((current) =>
            current.map((row) =>
              row.id === item.id ? { ...row, label: event.currentTarget.value } : row,
            ),
          )
        }
      />
      <input type="checkbox" checked={item.done} onChange={/* keyed update */} />
    </li>
  ))}
</ul>
```

React owns the controls, events, hydration, and every structural commit. Farm patches `value`,
`checked`, selected options, and dependent row bindings by stable key. It preserves focused text
selection and leaves composition events on React. When `event.currentTarget` is referenced inside
a queued functional compiler-state updater, generated code snapshots the referenced property while
the handler is active. Static input types and static option attributes are required. File inputs,
dynamic types or options, `contentEditable`, refs, custom controls, textarea children beside
`value`, and async or non-inline handlers keep the React fallback.

For custom rows or an explicit key selector, use the public component:

```tsx
import { List } from "@farm.js/react/list";

<div>
  <List each={items} by={(item) => item.id}>
    {(item) => <StatefulRow item={item} />}
  </List>
</div>;
```

`List` also works with the compiler disabled. `each` accepts an iterable, `null`, or `undefined`;
`by` supplies the React key; and the child function returns one React element. An inline host-only
row inside a dedicated container can use compiler-owned keyed rows. A custom row such as
`StatefulRow` remains a React-owned keyed boundary, which is necessary for its Hooks, lifecycle,
and Fiber state. Put Hooks inside the row component, not directly inside the iteration
callback. The optimized explicit shape also requires inline `by` and child functions, a safe
`each` expression, an item-derived key, and a statically known location. Other shapes keep normal
React behavior.

A normal child component can become an automatic React-owned island:

```tsx
<Header title="Dashboard" />
<Chart value={count} />
```

If `count` changes, the compiler leaves the outer component and `Header` alone and asks React to
render only the `Chart` boundary. `Chart` remains ordinary React and may use Hooks, context, local
state, effects, lifecycle, and error boundaries. The first contract accepts stable imported or
module-level identifiers with explicit compiler-safe props. Component children, spreads, `ref`,
`key`, member-expression or prop-selected component types, and identity-bearing inline prop values
fall back to the complete React component.

Generated callback refs give directly patched host elements stable private target identities. A
React-owned component may therefore return `null`, a fragment, or multiple host nodes without
shifting an unrelated compiler binding. These refs do not add attributes to SSR output.

Conditional blocks have three safe ownership levels. One or more proven host-only direct branches
may become compiler-owned ranges among static host siblings, including at the exact component root.
A dedicated container with exactly one conditional child uses the smaller compiler-owned branch
boundary. The more general React-owned conditional path accepts supported events, nested host
conditionals, keyed lists, and component islands. A compiler-owned host branch may now recursively
contain eligible host-only conditional ranges and non-interactive keyed ranges in nested host
containers. Each nested range receives its own dependency entry and updates without rerunning or
replacing the outer branch. When conditionals and keyed maps/`List` ranges are direct siblings in
one safe host container, the compiler emits one ordered mixed-range controller. It mounts or removes
conditional branches, applies independent LIS reconciliation to each keyed range, and preserves
static siblings in place. Stateful leaf text, attributes, `className`, and individual inline style
properties on those siblings are compiled into stable segment/sibling/path bindings. Their address
does not shift when a nearby condition mounts or a keyed range inserts, removes, or reorders rows,
so the same controller patches them from the current state snapshot without replacing the sibling
or rerunning the owner. The same mixed layout may recurse inside safe branches and keyed rows.
Keys on branches, custom components, fragments, refs, SVG, attribute spreads,
`dangerouslySetInnerHTML`, branch events, interactive rows, and unsupported mixed children keep
React ownership. An empty ternary branch may be `null` or `false`. The
inactive branch is described at build time but is never pre-mounted or cached. If a logical `&&`
evaluates to a number such as `0`,
or adopted DOM no longer matches its descriptor, the affected container remounts through React so
JavaScript, hydration, and React rendering semantics remain exact.

All component-level boundary types share one block graph and one ID sequence. A nested
binding records its nearest conditional parent. If one state flush affects both an outer
conditional and its descendants, the runtime refreshes the mounted outer boundary once and skips
the redundant descendant refreshes. React-owned inner boundaries unmount normally. Compiler-owned
host scopes explicitly remove every nested subscription before their outer DOM is removed, and a
later mount reads the latest compiler-cell values. Surviving keyed rows move with the existing LIS
algorithm. Duplicate runtime keys, invalid adoption, or an unsafe logical value transfer the outer
container back to React; descendant dependencies remain subscribed so that fallback stays live.
Host-only keyed rows have separate runtime instances per key. Row-local conditional and keyed-range
IDs are scoped to that instance and paired with its stable key, so two rows can use the same
build-time slot ID without sharing data or subscriptions. Unsupported row subtrees stay complete
React-owned keyed boundaries.

Unsupported components fall back to React by default. Use `onUnsupported: "warn"` for diagnostics
or `onUnsupported: "error"` while tightening an annotated migration.

Enable a deterministic production-build coverage report to see which components compiled and why
the rest stayed on React:

```ts
compiler: {
  report: true,
  // reportFile: "artifacts/react-compiler.json",
}
```

The default path is `.farm/react-compiler.json`. The report covers the production browser graph and
contains project-relative module paths, compiled component names, fallback details, and fallback
reasons aggregated by count. Its summary and per-module `optimizations` also report
`keyedIdentityTargets`, the number of scalar key-directed row bindings;
`keyedMapLookupTargets`, the number of native-Map keyed lookup bindings;
`keyedMembershipTargets`, the number of native-Set membership bindings;
`keyedCollectionUpdateHints`, the number of compiler-proven native Set/Map mutation sites; and
`keyedMapUpdateHints`, the number of compiler-proven direct keyed `map()` update sites; and
`keyedArrayAppendHints`, the number of compiler-proven direct keyed-array append sites; and
`keyedArrayFilterHints`, the number of compiler-proven direct keyed-array filter sites; and
`keyedArrayPrependHints`, the number of compiler-proven direct keyed-array prepend sites; and
`keyedArrayPositionHints`, the number of compiler-proven native exact-position insertion, single or
contiguous-range removal, single-row replacement, or exact-window replacement sites, including
guarded compiler-safe runtime positions;
and
`keyedArrayReorderHints`, the number of compiler-proven native keyed-array reverse steps; and
`keyedArraySortHints`, the number of compiler-proven native keyed-array sort steps; and
`keyedArrayRollingWindowHints`, the number of compiler-proven retained-tail plus incoming-suffix
sites; and
`keyedArraySliceHints`, the number of compiler-proven direct keyed-array slice sites with literal or
guarded compiler-safe runtime bounds. A custom project-relative `reportFile` also enables reporting.

The runtime test compares the same counter interaction on both paths: ordinary React performs a
second component render and commit, while the compiled component remains at one render and one
commit and updates its two bindings directly. This is a deterministic structural performance
assertion; it is not presented as a cross-machine timing benchmark.

Application and prototype calls, dynamic style objects, handlers outside JSX events, nested,
computed, and rest props patterns, async handlers, unkeyed or index-keyed lists, chained maps,
unsupported conditional roots, effects, and more advanced hook support intentionally stay on React
in this release. Compiler-owned keyed rows support either one dedicated host-only map/`List` or
one or more non-interactive ranges in a nested or component-root host container. A dedicated
non-interactive row may also contain multiple recursive logical or ternary host branches beside
stateful static host siblings, plus recursively nested non-interactive keyed ranges scoped by every
stable parent key. Static sibling bindings support safe leaf text, attributes, `className`, and
individual style properties; lifecycle-sensitive shapes continue to fall back. Inline synchronous
row events continue to use the hybrid React-owned row path. Branch
or nested-row events, interactive ranges beside siblings, non-inline or async row handlers,
unsupported form shapes, custom components, fragments, refs, SVG, and duplicate runtime keys keep
or switch to React ownership.
