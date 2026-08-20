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
  statically known locations, including supported nested boundaries;
- item-keyed `collection.map(...)` children and explicit `List` boundaries at statically known
  container locations, including supported non-mutating collection pipelines;
- stable module-level child components with compiler-safe props;
- React-managed event handlers; and
- no refs, effects, or unsupported dynamic child structures.

The generated component preserves React ownership of initial placement, props, events, SSR, and
hydration. Local state cells batch updates into a microtask and patch only compiler-known DOM
targets. Two proven, dedicated host containers can transfer child ownership after mount:
host-only conditional branches and host-only keyed rows. React still creates or hydrates their
initial DOM. Anything outside those narrow contracts uses a small React-owned boundary or the
complete original component.

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

React remains the fallback and compatibility boundary. A map beside static children, a row with
events, a fragment, a ref, or a custom component, and other unsupported shapes use the existing
React-owned keyed boundary. The outer compiled component can still be skipped, but React reconciles
that list's rows and owns their events, lifecycle, and state.

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
`StatefulRow` remains a React-owned keyed boundary, which is necessary for its Hooks, events,
lifecycle, and Fiber state. Put Hooks inside the row component, not directly inside the iteration
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

Conditional blocks have two safe ownership levels. A dedicated container with exactly one proven
host-only conditional child can use compiler-owned branch instances. Events, keys, custom
components, fragments, refs, SVG, attribute spreads, `dangerouslySetInnerHTML`, nested dynamic
blocks, and static siblings in that container keep React ownership. The more general React-owned
conditional path still accepts supported nested conditionals, keyed lists, and component islands.
An empty ternary branch may be `null` or `false`. The inactive branch is described at build time but
is never pre-mounted or cached. If a logical `&&` evaluates to a number such as `0`, the runtime also
falls back to React so JavaScript and React rendering semantics remain exact.

All supported boundary types share one component-wide block graph and one ID sequence. A nested
binding records its nearest conditional parent. If one state flush affects both an outer
conditional and its descendants, the runtime refreshes the mounted outer boundary once and skips
the redundant descendant refreshes. React unmounts inner boundaries normally, their subscriptions
are removed, and a later remount reads the latest compiler-cell values. Host-only keyed rows have
separate runtime instances per key. Unsupported row subtrees stay complete React-owned keyed
boundaries instead of receiving ambiguous shared block IDs.

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
in this release. Compiler-owned keyed rows are limited to a dedicated container with one host-only
map or `List`. Row events, custom components, fragments, refs, SVG, mixed static siblings, and
duplicate runtime keys keep or switch to React ownership.
