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
components are compiled, and everything else keeps the normal React path.

For selective adoption, use annotation mode:

```ts
renderer: react({
  experimental: {
    compiler: {
      mode: "annotation",
      directive: "use compiler",
      onUnsupported: "warn",
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
- row-local logical and ternary host branches inside stable keyed-row containers;
- stable module-level child components with compiler-safe props;
- React-managed event handlers; and
- no refs, effects, or unsupported dynamic child structures.

The generated component preserves React ownership of initial placement, props, events, SSR, and
hydration. Local state cells batch updates into a microtask and patch only compiler-known DOM
targets. Proven host containers can transfer child ownership after mount for host-only conditional
branches and ranges, plus non-interactive host-only keyed rows. An interactive row or a row with
local conditional slots uses a hybrid boundary instead: React retains its events, conditional
Fibers, and structural reconciliation, while Farm patches same-key bindings and refreshes only
changed row-local branches. React still creates or hydrates all initial DOM. Anything outside those
narrow contracts uses a small React-owned boundary or the complete original component.

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

A keyed row may also contain dedicated conditional slots:

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>
      <span>{item.label}</span>
      <div className="status-slot">
        {item.done ? <strong>{item.label} complete</strong> : <span>In progress</span>}
      </div>
      <section className="details-slot">{item.expanded && <p>{item.description}</p>}</section>
    </li>
  ))}
</ul>
```

Each conditional must be the only meaningful child of its persistent lowercase host container.
The compiler records its test and branch bindings per row key. A same-key collection update compares
those prepared snapshots and asks React to render only the conditional boundaries whose selected
branch or branch values changed. Other conditional rows and the outer map stay untouched. Inserts,
removals, and reorders remain React structural commits for these rows, after which Farm re-adopts
the host skeleton and resumes row-local updates. This keeps empty branches, SSR, hydration,
recoverable hydration errors, error boundaries, and Fast Refresh inside React's ownership.

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
form control shape, a fragment, a ref, a custom component, or a conditional mixed directly beside
other children in the same host slot uses the existing React-owned keyed boundary. The outer
compiled component can still be skipped, but React reconciles that list's rows and owns their
events, lifecycle, and state.

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
conditionals, keyed lists, and component islands. Keys, custom components, fragments, refs, SVG,
attribute spreads, `dangerouslySetInnerHTML`, nested dynamic blocks, and branch events keep React
ownership. An empty ternary branch may be `null` or `false`. The inactive branch is described at
build time but is never pre-mounted or cached. If a logical `&&` evaluates to a number such as `0`,
or adopted DOM no longer matches its descriptor, the affected container remounts through React so
JavaScript, hydration, and React rendering semantics remain exact.

All component-level boundary types share one block graph and one ID sequence. A nested
binding records its nearest conditional parent. If one state flush affects both an outer
conditional and its descendants, the runtime refreshes the mounted outer boundary once and skips
the redundant descendant refreshes. React unmounts inner boundaries normally, their subscriptions
are removed, and a later remount reads the latest compiler-cell values. Host-only keyed rows have
separate runtime instances per key. Row-local conditional IDs are scoped to that instance and
paired with its stable key, so two rows can use the same build-time slot ID without sharing data or
subscriptions. Unsupported row subtrees stay complete React-owned keyed boundaries.

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
reasons aggregated by count. A custom project-relative `reportFile` also enables reporting.

The runtime test compares the same counter interaction on both paths: ordinary React performs a
second component render and commit, while the compiled component remains at one render and one
commit and updates its two bindings directly. This is a deterministic structural performance
assertion; it is not presented as a cross-machine timing benchmark.

Application and prototype calls, dynamic style objects, handlers outside JSX events, nested,
computed, and rest props patterns, async handlers, unkeyed or index-keyed lists, chained maps,
unsupported conditional roots, effects, and more advanced hook support intentionally stay on React
in this release. Compiler-owned keyed rows support either one dedicated host-only map/`List` or
one or more non-interactive ranges in a nested or component-root host container. Inline synchronous
events and dedicated row-local host conditional slots can use the single-list hybrid path, but
branch events, interactive ranges beside siblings, nested dynamic blocks, conditionals mixed with
siblings in one slot, non-inline or async row handlers, unsupported form shapes, custom components,
fragments, refs, SVG, and duplicate runtime keys keep or switch to React ownership.
