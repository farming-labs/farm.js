---
title: "React Renderer"
description: "Use FARMJS with the default React renderer, including client hooks, streaming SSR, and the experimental AOT compiler."
section: "Core"
---

# React Renderer

React is the default FARMJS renderer and has the broadest client-feature support. Existing projects
do not need a renderer option or an additional adapter package.

## Create an app

```bash
pnpm create @farm.js/app@beta my-app --template basic --typescript
```

Omitting `renderer` keeps React active:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

## Route components

React routes use `.tsx` or `.jsx` files:

```text
src/app/layout.tsx
src/app/page.tsx
src/app/products/[id]/page.tsx
```

```tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "My FARMJS app",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main>{children}</main>;
}
```

Add `"use client"` to an interactive component. FARMJS keeps ordinary server-rendered routes out of
the browser bundle and hydrates the client boundaries imported by the route.

```tsx
"use client";

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>;
}
```

## Experimental AOT compiler

Farm's experimental React compiler moves a narrow class of local state-update work from React's
runtime render-and-reconcile path into build-time binding metadata. It is disabled by default and
only affects the React renderer that enables it. Preact, Solid, Vue, Svelte, and custom renderers do
not receive this transform.

The compiler is intentionally conservative. It only transforms a component when it can prove that
the component has one stable host-element tree and that each supported state value maps to known
text or attribute targets. If that proof fails, the original component stays on React.

### Why this compiler exists

An ordinary local `useState` update asks React to run the component again, produce another element
tree, reconcile it with the previous tree, and commit the changed DOM. That general model is needed
for dynamic React applications, but it repeats work when a component's structure is fixed and only
a few text or attribute values can change.

For that safe subset, Farm prepares three things ahead of time:

1. local state cells and their setters;
2. the DOM path of every state-driven text or attribute binding; and
3. the state-cell dependencies for each binding.

After mount, an eligible local update flushes the changed cells and patches only the affected
bindings. It does not schedule another React render or reconciliation pass for that update. React
still owns initial rendering, component placement, parent-driven prop updates, events, SSR,
hydration, and unmounting.

### Enable the compiler

Start from the focused experimental starter when you want the compiler flag, shared dark starter
UI, a live AOT-versus-React comparison, and a reproducible browser check already wired together:

```bash
pnpm create @farm.js/app@beta compiler-app --template react-compiler --typescript
```

You can also clone the standalone
[React Compiler Starter](https://github.com/farming-labs/farmjs-react-compiler-starter).

Install `@farm.js/react` to select the React renderer with compiler options:

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

`compiler: true` is the recommended starting point for the experiment. It means automatic
inference with safe React fallback:

```ts
compiler: {
  mode: "infer",
  onUnsupported: "fallback",
}
```

Omitting `experimental.compiler` or setting it to `false` disables the transform.

### Configuration API

```ts
type ReactCompilerMode = "infer" | "annotation";
type UnsupportedCompilerBehavior = "fallback" | "warn" | "error";

interface ReactCompilerOptions {
  mode?: ReactCompilerMode;
  directive?: string;
  onUnsupported?: UnsupportedCompilerBehavior;
  report?: boolean;
  reportFile?: string;
}
```

| Option          | Values                                | Default                     | Purpose                                                                  |
| --------------- | ------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `compiler`      | `false`, `true`, or an options object | `false`                     | Disables, enables with defaults, or configures the React-only transform. |
| `mode`          | `"infer"`, `"annotation"`             | `"infer"`                   | Selects components automatically or only through an explicit directive.  |
| `directive`     | non-empty string                      | `"use compiler"`            | Names the module/function directive used by annotation mode.             |
| `onUnsupported` | `"fallback"`, `"warn"`, `"error"`     | `"fallback"`                | Controls what happens outside the current supported subset.              |
| `report`        | boolean                               | `false`                     | Writes a compiler coverage report after a successful production build.   |
| `reportFile`    | project-relative path                 | `.farm/react-compiler.json` | Changes the report path and enables reporting when provided.             |

`directive` is valid only when `mode` is `"annotation"`. Invalid modes, invalid unsupported
behaviors, and directives configured in inference mode throw a configuration error instead of
silently changing behavior.

### Component selection

#### Automatic inference

`compiler: true` and `mode: "infer"` inspect top-level, capitalized function components in
application `.tsx` and `.jsx` modules under the project root. Dependencies in `node_modules` are not
transformed. Every eligible component is compiled; every unsupported component remains unchanged.

Use the built-in function directive to keep a specific component entirely on React:

```tsx
export function ReactOwnedEditor() {
  "use no compiler";

  // React always owns this component.
}
```

The opt-out is intentionally local. It documents a known ownership boundary without disabling the
compiler for the rest of the module.

#### Annotation mode

Annotation mode is useful for a staged rollout or a strict, reviewed set of components:

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

Place the configured directive inside one component to select only that component:

```tsx
export function Counter() {
  "use compiler";

  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
}
```

Or place it at the top of a module to select every eligible component in that module:

```tsx
"use compiler";

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

The directive name is configurable:

```ts
compiler: {
  mode: "annotation",
  directive: "use optimize",
}
```

An explicitly selected component that cannot be compiled produces a warning even when
`onUnsupported` is `"fallback"`. Explicit selection should not fail silently.

### Unsupported-component behavior

| Value        | Behavior                                                                                 | Good fit                                       |
| ------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `"fallback"` | Keep the original React component. Inferred unsupported candidates are quiet.            | Broad automatic experimentation.               |
| `"warn"`     | Keep the React component and emit a diagnostic containing the component name and reason. | Finding missed optimization opportunities.     |
| `"error"`    | Stop the transform/build when a considered component cannot be compiled.                 | Enforcing a reviewed annotation-mode contract. |

For example, an unsupported keyed list can report:

```text
[react-compiler] KeyedList: dynamic child structures require React reconciliation; using React.
```

Use `"warn"` while exploring the compiler. Use annotation mode with `"error"` when CI should prove
that every explicitly selected component still satisfies the supported contract.

### Compiler coverage report

Console warnings are useful while editing, but a report makes compiler coverage visible across the
production browser graph where compiled DOM updates run. Enable it without changing selection or
fallback behavior:

```ts
renderer: react({
  experimental: {
    compiler: {
      report: true,
    },
  },
}),
```

After a successful build, Farm writes `.farm/react-compiler.json`:

```json
{
  "version": 1,
  "summary": {
    "modules": 2,
    "componentsConsidered": 4,
    "compiled": 2,
    "fallback": 2
  },
  "fallbackReasons": [
    {
      "count": 2,
      "reason": "dynamic child structures require React reconciliation"
    }
  ],
  "modules": [
    {
      "id": "src/Products.tsx",
      "compiled": ["ProductRow"],
      "fallbacks": [
        {
          "module": "src/Products.tsx",
          "component": "ProductList",
          "reason": "dynamic child structures require React reconciliation",
          "selected": false
        }
      ]
    }
  ]
}
```

`componentsConsidered` counts candidates selected by the active mode. `compiled` counts components
using the AOT runtime, and `fallback` counts candidates left on React. `selected` is `true` when an
annotation explicitly requested compilation. Module paths are relative to the project root, and
the output is sorted and contains no timestamp, so CI can compare reports without machine-specific
noise.

Use a different project-relative output path when CI collects artifacts elsewhere:

```ts
compiler: {
  reportFile: "artifacts/react-compiler.json",
}
```

Report paths cannot be absolute or escape the project root. Reporting is observability only: it
does not make unsupported components fail. Use `onUnsupported: "error"` when failure is the desired
policy.

### Current supported contract

The current compiler deliberately supports a smaller subset than general React. A component must
satisfy all of these rules:

| Area                | Current supported shape                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Component discovery | A top-level, capitalized function declaration, function expression, or arrow component in application `.tsx` or `.jsx`.                     |
| Function shape      | Synchronous, non-generator, non-generic block body with zero parameters, one props identifier, or flat object props destructuring.          |
| Props               | Flat object destructuring supports shorthand names, aliases, and defaults. Nested, computed, and rest patterns fall back.                   |
| Body                | Top-level `useState` declarations, optional compiler-safe derived values and synchronous named handlers, then one unconditional JSX return. |
| State               | `const [value, setValue] = useState(initial)`, including lazy initializers, multiple cells, and queued functional updates.                  |
| Root                | Exactly one lowercase host JSX element such as `button`, `section`, `input`, or `div`.                                                      |
| Tree                | A statically known host tree around eligible conditional, keyed-list, and React component-island boundaries.                                |
| Text bindings       | State-driven text in a leaf host element.                                                                                                   |
| Attribute bindings  | Basic attributes, controlled form properties, and individual properties in one inline `style` object.                                       |
| Events              | Inline handlers and synchronous `const` or function-declaration handlers, used directly or called inside an inline JSX handler.             |
| Conditional blocks  | `condition && <host />` or `condition ? <host /> : <host />`; host branches may contain supported nested blocks.                            |
| Keyed lists         | A direct keyed `items.map(...)`, or an explicit imported `List`, alongside static siblings or other supported block boundaries.             |
| Component islands   | Stable imported or module-level component identifiers with explicit compiler-safe props and no JSX children, spread, `ref`, or `key`.       |

This component is eligible:

```tsx
"use client";

import { useState } from "react";

interface StatusButtonProps {
  initial?: number;
  label: string;
}

export function StatusButton({ initial = 0, label: title }: StatusButtonProps) {
  const [count, setCount] = useState(initial);
  const [active, setActive] = useState(false);
  const visibleCount = Math.max(0, count);
  const statusClass = active ? "active" : "idle";
  const visibleLabel = `${title}: ${String(visibleCount)}`;

  function update() {
    setCount((value) => value + 1);
    setActive((value) => !value);
  }

  return (
    <button
      aria-pressed={active}
      className={statusClass}
      data-count={visibleCount}
      onClick={() => update()}
      style={{ opacity: active ? 1 : 0.6 }}
    >
      {visibleLabel}
    </button>
  );
}
```

The compiler records separate dependencies for `count` and `active`. Changing `count` does not
reevaluate bindings that depend only on `active`, and vice versa.

Derived values are expanded into the generated bindings, so they do not create a runtime scope or
force a component rerender. They may use literals, props, state, operators, optional/member access,
conditionals, templates, earlier derived values, and a small call whitelist. The whitelist contains
`Boolean`, `Number`, `String`, and `Math.abs`, `ceil`, `floor`, `max`, `min`, `round`, `sign`, and
`trunc`. A name is not treated as built-in when the component shadows it. Application helpers,
prototype methods, `Math.random`, optional calls, assignments, identity-bearing object or array
literals, functions, JSX, constructors, and other unproven expressions still fall back to React.

For destructured props, the original component wrapper still performs JavaScript destructuring on
every parent render. Defaults therefore apply only to `undefined`, aliases keep their normal local
names, and the resolved values are passed to the compiled definition. A named handler can be a
synchronous `const` function or function declaration. It is expanded when passed directly to a JSX
event or called from that event's inline function, including arguments such as
`onClick={() => select(productId)}`. Calling it while producing the event prop, exposing it as a
child, using it outside an event, or making it async/generic still falls back to React.

Stateful styles use one inline object literal. The compiler creates a separate binding for each
state-dependent camelCase property or CSS custom property, so changing `opacity` does not rewrite
an unrelated `width`. Style spreads, methods, computed names, and conditional whole objects remain
on React because their final property set or precedence can change.

### Conditional DOM blocks

The compiler can isolate two common child structures when their position is known at build time:

```tsx
export function StatusPanel() {
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);

  return (
    <section>
      <button onClick={() => setLoading(!loading)}>Toggle loading</button>
      {loading && <p>Loading…</p>}

      <button onClick={() => setEnabled(!enabled)}>Toggle status</button>
      {enabled ? <strong>Enabled</strong> : <span>Disabled</span>}
    </section>
  );
}
```

At build time, Farm records the state cells used by each condition and replaces that child
expression with a small internal block boundary. When one of those cells changes, the outer user
component does not execute again. Only the matching boundary asks React to mount, replace, remove,
or update its selected host branch. Other compiler bindings continue to patch their prepared DOM
targets directly.

This is intentionally block-local React reconciliation, not manual DOM insertion. Keeping React at
the boundary preserves delegated events, host property behavior, unmounting, error boundaries,
Strict Mode, SSR, and hydration. The inactive branch is described by generated code but is not
pre-mounted or cached in the DOM.

The initial safety limits are:

- Every non-empty branch has exactly one lowercase host root such as `p`, `strong`, `span`, or
  `div`.
- Descendants keep a statically known host tree. Stateful text, attributes, inline style
  properties, and event handlers inside that tree are allowed and update when the block refreshes.
- A branch may contain nested host-root conditionals, keyed-list boundaries, and supported
  component islands. Each nested boundary receives the outer conditional as its runtime parent.
- A ternary may use `null` or `false` for an empty branch.
- The conditional must be a JSX child at one statically known location, and its test must use the
  same deterministic expression subset as other compiler bindings.
- A non-empty branch still needs one lowercase host root. A custom component cannot be the branch
  root, but a supported component island may appear inside that host tree.
- Hooks directly in branch expressions, fragments, refs, `dangerouslySetInnerHTML`, and attribute
  spreads fall back to the original React component.

The optimization boundary matters: the surrounding compiled component and its unrelated siblings
do not rerender, but React still renders and commits the small conditional boundary. A branch with
substantial work therefore still pays for that branch work.

### Keyed list boundaries

The compiler automatically recognizes a direct keyed map in a safe, statically known container:

```tsx
export function Inventory() {
  const [items, setItems] = useState(initialItems);

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  );
}
```

Farm records the list's state dependencies and replaces the map location with a small internal
React boundary. Updating `items` refreshes that boundary without executing `Inventory` again.
React still receives the keyed elements and performs the insert, removal, move, render, lifecycle,
and commit work inside the list. The optimization isolates that work; it does not remove it.

Use the public `List` component when the key should be separate from the row renderer, or when rows
are custom components:

```tsx
import { List } from "@farm.js/react/list";

export function Inventory() {
  const [items, setItems] = useState(initialItems);

  return (
    <div className="inventory">
      <List each={items} by={(item) => item.id}>
        {(item) => <InventoryRow item={item} />}
      </List>
    </div>
  );
}

function InventoryRow({ item }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button onClick={() => setExpanded((value) => !value)}>
      {item.label}: {expanded ? "open" : "closed"}
    </button>
  );
}
```

`List` is an ordinary React component, not compiler-only syntax. It accepts an `Iterable`, `null`,
or `undefined`; calls `by(item, index)` to create each React key; and requires its child function to
return one React element. It therefore renders correctly when the experimental compiler is off or
when this particular use cannot be optimized. Hooks belong inside a row component such as
`InventoryRow`, never directly inside the `List` child function or a `.map()` callback.

The first automatic contract is deliberately narrow:

- The map must be a direct `collection.map(...)` with one synchronous inline callback returning one
  React element and an explicit item-derived `key`.
- An array-index key is rejected for compiler isolation because it does not preserve item identity
  across insertion, removal, or reordering.
- The optimized `List` shape uses inline `by` and child functions, a compiler-safe `each`
  expression, and an item-derived key.
- A map or `List` may appear beside static host children, other keyed lists, and eligible
  conditional boundaries in the same container.
- Chained expressions such as `items.filter(...).map(...)`, spread children, hooks in the callback,
  and other unproven shapes fall back to normal React.

Stable keys must be unique among siblings and come from the item's identity, such as a database ID.
Farm does not implement an LIS move algorithm in this release. A compiler-owned LIS can only be
safe after the compiler owns an entire host-only list island; this boundary intentionally keeps
React as the sole DOM and Fiber owner.

### React component islands

Ordinary child components can stay under React while the compiler owns the surrounding update
graph:

```tsx
import { Chart } from "./chart";
import { Header } from "./header";

export function Dashboard() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <Header title="Dashboard" />
      <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>
      <Chart value={count} />
    </main>
  );
}
```

`Header` has no dependency on `count`, so a compiled local update leaves it mounted without
rendering it again. `Chart` depends on `count`, so the compiler replaces that location with a small
internal component boundary and records the exact state dependency. When `count` changes, the
button binding is patched directly and only the `Chart` boundary asks React to update. The
`Dashboard` function does not execute again.

This does not compile or inspect `Chart`. React continues to own its render, Hooks, context, local
state, effects, events, lifecycle, reconciliation, errors, SSR, and hydration. Keeping the same
component type and boundary position preserves child state across parent-cell updates. Context
updates still reach consumers inside the island even when the compiled owner is memoized.

The first supported shape is intentionally conservative:

- The component name is one direct imported or module-level identifier such as `Chart`.
- Props are explicit strings, booleans, or compiler-safe expressions. Inline event handlers may
  call supported setters.
- A prop that depends on local compiler state makes the component a subscribed island. A component
  with no local-state dependency remains an ordinary, unchanged React child.
- The child may internally return `null`, fragments, multiple elements, or other components.
- JSX children, spreads, `ref`, `key`, member expressions such as `UI.Chart`, prop-selected dynamic
  component types, render props, and inline object/array/JSX values fall back to normal React.

Direct DOM bindings now use generated private callback refs instead of depending only on sibling
indexes. This matters when an earlier React-owned child changes its number of DOM nodes: the
compiler still holds the exact target element and cannot accidentally patch a different sibling.
The refs produce no `data-*` marker or other extra server markup.

### Composable block graph

Conditional, keyed-list, and component-island boundaries are analyzed together. The compiler
assigns every boundary a component-wide ID, so IDs remain unique even when several block types
share a container or are nested inside one conditional branch. Nested bindings also record the ID
of their nearest outer conditional.

When one update affects an outer conditional and one or more descendants, the runtime refreshes
the mounted outer boundary once and suppresses redundant descendant refreshes for that flush.
React then unmounts or replaces the branch normally. Inner boundaries unsubscribe during that
unmount, so later updates while the branch is hidden do not target stale components. If the branch
appears again, each boundary subscribes again and renders from the latest compiler-cell values.

The compiler deliberately does not analyze block-shaped syntax inside a keyed list callback. That
callback can execute once per row, so a single compile-time block ID would not identify one runtime
instance. React owns the complete keyed row subtree instead; put Hooks and additional dynamic
structure inside a keyed row component.

### What falls back to React

| Unsupported shape                                                          | Why React keeps ownership                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unkeyed/index-keyed/chained maps or element arrays                         | Their structure or item identity is outside the isolated keyed-boundary contract.  |
| Fragments or a custom component used as a conditional branch root          | Their structure is outside the current host-root conditional contract.             |
| Dynamic/member component types, component spreads, refs, keys, or children | Their identity or ownership is outside the first component-island contract.        |
| Effects or hooks other than the supported `useState` shape                 | Their lifecycle and ordering must remain under React's hook dispatcher.            |
| `ref` or `dangerouslySetInnerHTML`                                         | They directly participate in DOM ownership.                                        |
| Stateful `children` or `key` bindings outside an eligible boundary         | These need structure or identity semantics.                                        |
| Conditional style objects, style spreads, methods, or computed names       | The final property set or precedence cannot be prepared statically.                |
| JSX attribute spreads or namespaced attributes                             | The compiler cannot currently enumerate a stable binding contract.                 |
| Multiple/conditional returns or impure/control-flow statements             | The compiler only lowers a single, statically analyzable render path.              |
| Derived calls, assignments, identity-bearing values, functions, or JSX     | Their evaluation timing, side effects, or identity cannot yet be preserved safely. |
| Nested, computed, or rest props destructuring                              | These patterns need additional parameter-shape and identity analysis.              |
| Async/generator/generic handlers or named handlers outside JSX events      | Their scheduling, identity, or closure semantics are outside the current lowering. |
| Async/generator or generic components                                      | These function shapes are outside the current lowering.                            |
| Setters called outside JSX event handlers                                  | The compiler only controls and batches event-driven local updates.                 |

Keys do not make list reconciliation unnecessary. A key tells React which child identity survives
an insert, removal, or move; React still compares the dynamic children. The compiler uses that
identity to decide when a list can have its own refresh boundary, then hands the keyed elements to
React. Calling a Hook directly inside a list iteration is invalid React because the number or order
of calls can change. Put the Hook inside a keyed child component instead.

### Build-time transformation

The React renderer installs `farm:react-aot-compiler` as a pre-transform. The current implementation
is a Babel AST transform, not a Rust compiler pass. It parses application TSX/JSX before ordinary
JSX lowering, discovers candidate components, validates the full supported contract, and emits
source maps with the transformed module.

For each eligible component, the transform conceptually emits a definition like this:

```ts
createCompiledComponent({
  initialize: (props) => [props.initial],
  render: (props, state) => <button>Count: {state[0].get()}</button>,
  bindings: [
    {
      kind: "text",
      path: [],
      target: 0,
      dependencies: [0],
      read: (_props, state) => ["Count: ", state[0].get()],
    },
  ],
});
```

The actual output imports `createCompiledComponent` from `@farm.js/react/compiler-runtime` only in
modules where at least one component compiled. Unsupported modules keep their original source and
do not receive the runtime import.

### Runtime behavior

The generated runtime wrapper is still a React component. Its responsibilities are split as
follows:

| React owns                                      | Compiler runtime owns                                                |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Initial element creation and placement          | Local compiler-cell values                                           |
| SSR markup and hydration                        | Queuing local setter calls into one microtask                        |
| JSX event registration and dispatch             | Comparing flushed values with `Object.is`                            |
| Parent-driven prop updates                      | Selecting bindings whose state dependencies changed                  |
| Unsupported trees, hooks, refs, and lifecycles  | Patching stable ref-owned text/attribute targets after local updates |
| Host creation/removal inside an eligible block  | Refreshing only the matching internal conditional boundary           |
| Keyed row identity, reconciliation, and DOM     | Refreshing only the matching internal keyed-list boundary            |
| Component render, Hooks, context, and lifecycle | Refreshing only a dependent React component-island boundary          |
| Unmounting and the surrounding component tree   | Reapplying bindings after a parent-driven React update               |

Queued functional setters preserve the event's state snapshot. Two calls such as
`setCount(value => value + 1)` are applied in order during the same microtask flush, while reads
inside the event still see the previous snapshot. If the final value is `Object.is`-equal to the
previous value, no binding is patched.

Attribute updates preserve important DOM behavior:

- `className` and `htmlFor` map to `class` and `for`;
- input and textarea `value`, select values, input `checked`, option `selected`, and element
  `disabled` use DOM properties;
- controlled single and multiple selects update their selected options;
- style bindings patch one property, add `px` where React expects it, preserve unitless numbers and
  CSS custom properties, and clear nullish values;
- `data-*` and `aria-*` booleans are stringified; and
- nullish values and ordinary false boolean attributes are removed.

Focused input and textarea updates capture and restore the current selection around the compiler
microtask. Composition events remain React-owned, so IME input keeps its normal event ordering while
the resulting value, selection, and dependent bindings are patched together.

The server output is ordinary React HTML and contains no compiler marker. React hydrates that
markup normally; direct binding updates begin after the component mounts.

During development, compiled components receive a module-and-component identity plus a state-layout
signature. A compatible Fast Refresh replaces the compiled definition while retaining the React
component type and its local cells. If the compiler-owned state layout changes, the identity is not
reused and React remounts it instead of preserving incompatible state.

If a direct binding evaluation throws, the runtime schedules a React update and rethrows from the
component render. This lets the nearest React error boundary handle the failure through React's
normal recovery path.

### Safety reasoning

The compiler uses fallback as a semantic boundary, not as an error-recovery trick. Generated
callback refs keep direct DOM targets stable even when a React component island returns `null`, a
fragment, or multiple nodes. Conditional, keyed-list, and component boundaries give dynamic
structure back to React. Unsupported dynamic component types, refs, effects, and other unproven
shapes keep the complete component on React; fallback is the optimization's correctness mechanism.

Parent-driven prop updates also remain React updates. After React reconciles the new props, the
runtime reapplies compiler-owned bindings from the current local cells so prop changes and local
state remain coherent.

### Verification and benchmark scope

The package and example test suites verify more than generated code:

- compiled local updates change the same text and attributes as base React;
- one eligible update adds no React render or commit, while the equivalent base component adds one;
- server-rendered markup hydrates and remains interactive;
- lazy initialization, event snapshots, and batched functional setters are preserved;
- multiple state cells update only their dependent bindings;
- whitelisted calculations, per-property styles, handler wrappers, textarea/select/checkbox
  properties, and multiple-select values update without rerunning the component;
- Strict Mode mounting, queued-unmount cleanup, bubbled events, controlled input selection, and
  composition events preserve their React behavior;
- simultaneous parent-prop and compiled-local updates remain coherent;
- compatible Fast Refresh preserves state, while binding errors reach React error boundaries;
- hydration mismatches follow React's recoverable-error path and remain interactive;
- object, array, and nullish state transitions match normal React across 3,000 deterministic
  randomized updates;
- automatic keyed maps and explicit `List` boundaries preserve keyed DOM nodes and stateful row
  identity across inserts, removals, updates, and reorders without rerunning the outer component;
- component islands update only dependent children, preserve child-local state and context, route
  failures through React error boundaries, hydrate in Strict Mode, and safely drop queued updates
  after unmount;
- stable ref targets remain correct when an earlier island switches among `null`, one node, and a
  multi-node fragment;
- 1,000 deterministic object, array, and nullish component-prop transitions match normal React;
- 1,000 deterministic randomized list operations produce the same ordered output as normal React;
- the public `List` renders iterable and nullish collections correctly with the compiler off;
- the packaged runtime is exercised separately with React 18.3 and React 19;
- boolean `data-*` and `aria-*` attributes keep React-compatible string values; and
- unsupported list shapes, effects, refs, and unsupported dynamic component-island shapes remain
  on React without corrupting output.

The heavy example measures both a fixed 768-host-node tree with sparse bindings and a component
island beside a React-owned 768-node static component. Its compiler-off → compiler-on crossover
run measures deliberately favorable supported workloads. An Apple M1 and Chromium 145 reference
run measured the direct-binding median at `0.175 ms` without the compiler and `0.015 ms` with it—
91.4% lower, or 11.7× faster—with zero added component executions. The component-island result
separately includes the dependent child React render and verifies that the static sibling and
compiled owner add zero update executions. Its median child-commit latency fell from `0.165 ms` to
`0.025 ms`—84.8% lower, or 6.6× faster. These are warm update-path measurements, not page load,
build, layout, paint, network, or general React performance claims.

Run the benchmark on target devices before using its timing as a product estimate. The more stable
structural result is zero owner and unchanged-sibling executions; direct bindings also avoid a
React commit, while a dependent component island still performs its required child commit.

### Recommended rollout

1. Start with `compiler: true` and confirm the application behaves normally.
2. Enable `report` to record coverage across the complete production build.
3. Change `onUnsupported` to `"warn"` to see fallback reasons while editing.
4. Add `"use no compiler"` to known React-owned boundaries when the reason is intentional.
5. Use annotation mode for components whose compiler ownership should be explicit.
6. Use annotation mode with `onUnsupported: "error"` when CI must enforce that selected components
   remain eligible.

The [`examples/react-compiler`](https://github.com/farming-labs/farm.js/tree/main/examples/react-compiler)
app contains batching, multiple-binding, common-syntax, calculated-style, controlled-form,
automatic and explicit keyed-list, component-island, compiler-on/off, and heavy-interaction
experiments. The standalone starter intentionally keeps the first experience focused.

## React-specific FARMJS APIs

Choose React when the application needs the complete built-in client layer:

- `Link`, `useRouter`, `useNavigation`, and scroll restoration;
- `useAction`, fetcher forms, mutations, and server-query hooks;
- `useTheme`, `useLocale`, translations, and the built-in auth hook;
- integration providers and generated integration UI;
- Markdown/MDX visual routes and the docs adapter;
- generated JSX metadata images;
- experimental React Server Components and optimized Strata boundaries.

Server APIs such as endpoints, server functions, middleware, storage, caching, observability, and
deployment use the same contracts described in the renderer overview.

## Production rendering

The React adapter supports string rendering and streaming when the active production runtime can
use `renderToPipeableStream`. Static generation, ISR, PPR, and ordinary dynamic rendering continue
to follow route configuration rather than the component extension.

See [Rendering Model](/docs/server-rendering) for rendering modes and
[Renderers](/docs/renderers) for the cross-renderer support matrix.
