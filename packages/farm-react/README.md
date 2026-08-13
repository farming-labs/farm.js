# @farm.js/react

React renderer integration for FARMJS, including the experimental Group 1 AOT compiler.

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
  return (
    <button onClick={() => setCount((value) => value + 1)}>
      Count: {count}
    </button>
  );
}
```

The directive is configurable and only has meaning in annotation mode.

## Group 1 contract

The first compiler group handles components that the compiler can prove have:

- one host-element root and a static host-element tree;
- top-level `useState` declarations;
- state-driven text and basic attribute/property bindings;
- React-managed event handlers; and
- no refs, effects, custom child components, keyed lists, or conditional child structure.

The generated component preserves React ownership of placement, props, events, SSR, and hydration.
Local state cells batch updates into a microtask and patch only compiler-known DOM paths. A local
state update therefore does not schedule a React render or reconciliation pass.

Unsupported components fall back to React by default. Use `onUnsupported: "warn"` for diagnostics
or `onUnsupported: "error"` while tightening an annotated migration.

The runtime test compares the same counter interaction on both paths: ordinary React performs a
second component render and commit, while the compiled component remains at one render and one
commit and updates its two bindings directly. This is a deterministic structural performance
assertion; it is not presented as a cross-machine timing benchmark.

Keyed list lowering, structural conditionals, effects, and more advanced hook support belong to
later compiler groups and intentionally stay on React in this release.
