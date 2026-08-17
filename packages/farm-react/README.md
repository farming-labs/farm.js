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

- one host-element root and a statically known host-element tree around supported React component
  islands;
- an identifier props parameter or flat object destructuring with aliases and defaults;
- top-level `useState` declarations;
- optional compiler-safe derived `const` values declared after state and in source order;
- whitelisted `Boolean`, `Number`, `String`, and deterministic `Math` calculations;
- optional synchronous `const` or function-declaration handlers used by JSX events;
- state-driven text, attributes, per-property inline styles, and controlled form properties;
- host-only `condition && <element>` and `condition ? <element> : <element>` child blocks at
  statically known locations;
- direct item-keyed `collection.map(...)` children and explicit `List` boundaries at statically
  known container locations;
- stable module-level child components with compiler-safe props;
- React-managed event handlers; and
- no refs, effects, or unsupported dynamic child structures.

The generated component preserves React ownership of placement, props, events, SSR, and hydration.
Local state cells batch updates into a microtask and patch only compiler-known DOM targets. For an
eligible conditional, the runtime refreshes one small internal React boundary instead of executing
the user component again. React mounts, replaces, or removes the selected branch, so events,
unmounting, SSR, hydration, and error boundaries keep React semantics.

For a common keyed map, no new API is required:

```tsx
<ul>
  {items.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}
</ul>
```

The compiler can isolate this direct map when it is the container's only meaningful child, the key
comes from the item rather than the array index, and the callback is otherwise safe. A list update
then refreshes only an internal React boundary instead of executing the outer user component.
React still reconciles the keyed rows and owns their DOM, events, lifecycle, and state.

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
`by` supplies the React key; and the child function returns one React element. Put Hooks inside the
row component, not directly inside the iteration callback. With the compiler enabled, the
optimized explicit shape requires inline `by` and child functions, a safe `each` expression, an
item-derived key, and no meaningful siblings in the same host container. Other shapes keep normal
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

Conditional blocks deliberately start with a narrow contract. Each non-empty branch must have one
lowercase host root and a static host-only subtree. An empty ternary branch may be `null` or `false`.
Custom components, hooks, fragments, nested conditionals, lists, refs, attribute spreads, and
`dangerouslySetInnerHTML` inside the block fall back to the normal React component. Both branch
expressions are isolated at build time, but the inactive branch is not pre-mounted or cached.

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
mixed list siblings, unsupported conditional shapes, effects, and more advanced hook support
intentionally stay on React in this release. Farm does not perform compiler-owned LIS row moves;
eligible keyed boundaries deliberately keep reconciliation under React.
