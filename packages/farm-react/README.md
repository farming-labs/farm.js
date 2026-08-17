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

- one host-element root and a statically known host-element tree;
- an identifier props parameter or flat object destructuring with aliases and defaults;
- top-level `useState` declarations;
- optional compiler-safe derived `const` values declared after state and in source order;
- whitelisted `Boolean`, `Number`, `String`, and deterministic `Math` calculations;
- optional synchronous `const` or function-declaration handlers used by JSX events;
- state-driven text, attributes, per-property inline styles, and controlled form properties;
- host-only `condition && <element>` and `condition ? <element> : <element>` child blocks at
  statically known locations;
- React-managed event handlers; and
- no refs, effects, custom child components, or keyed lists.

The generated component preserves React ownership of placement, props, events, SSR, and hydration.
Local state cells batch updates into a microtask and patch only compiler-known DOM paths. For an
eligible conditional, the runtime refreshes one small internal React boundary instead of executing
the user component again. React mounts, replaces, or removes the selected branch, so events,
unmounting, SSR, hydration, and error boundaries keep React semantics.

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
computed, and rest props patterns, async handlers, keyed list lowering, unsupported conditional
shapes, effects, and more advanced hook support intentionally stay on React in this release.
