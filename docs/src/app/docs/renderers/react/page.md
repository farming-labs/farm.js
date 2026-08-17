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
| Tree                | A statically known host tree. Eligible logical and ternary blocks may change one compiler-isolated child location.                          |
| Text bindings       | State-driven text in a leaf host element.                                                                                                   |
| Attribute bindings  | Basic attributes, controlled form properties, and individual properties in one inline `style` object.                                       |
| Events              | Inline handlers and synchronous `const` or function-declaration handlers, used directly or called inside an inline JSX handler.             |
| Conditional blocks  | `condition && <host />` or `condition ? <host /> : <host />`; `null` and `false` are supported empty ternary branches.                      |

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
- Descendants keep a static host-only tree. Stateful text, attributes, inline style properties, and
  event handlers inside that tree are allowed and update when the block refreshes.
- A ternary may use `null` or `false` for an empty branch.
- The conditional must be a JSX child at one statically known location, and its test must use the
  same deterministic expression subset as other compiler bindings.
- Custom components, hooks, fragments, nested conditional blocks, lists, refs,
  `dangerouslySetInnerHTML`, and attribute spreads inside a branch fall back to the original React
  component.

The optimization boundary matters: the surrounding compiled component and its unrelated siblings
do not rerender, but React still renders and commits the small conditional boundary. A branch with
substantial work therefore still pays for that branch work.

### What falls back to React

| Unsupported shape                                                      | Why React keeps ownership                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Keyed lists, `.map()`, element arrays, or helper-rendered children     | Inserts, removals, moves, and identity changes require reconciliation.              |
| Fragments or unsupported/nested conditional JSX                        | Their structure is outside the current single-location host-block contract.         |
| Custom child components                                                | A child component has its own props, hooks, lifecycle, and reconciliation boundary. |
| Effects or hooks other than the supported `useState` shape             | Their lifecycle and ordering must remain under React's hook dispatcher.             |
| `ref` or `dangerouslySetInnerHTML`                                     | They directly participate in DOM ownership.                                         |
| Stateful `children` or `key` bindings                                  | These need structure or identity semantics.                                         |
| Conditional style objects, style spreads, methods, or computed names   | The final property set or precedence cannot be prepared statically.                 |
| JSX attribute spreads or namespaced attributes                         | The compiler cannot currently enumerate a stable binding contract.                  |
| Multiple/conditional returns or impure/control-flow statements         | The compiler only lowers a single, statically analyzable render path.               |
| Derived calls, assignments, identity-bearing values, functions, or JSX | Their evaluation timing, side effects, or identity cannot yet be preserved safely.  |
| Nested, computed, or rest props destructuring                          | These patterns need additional parameter-shape and identity analysis.               |
| Async/generator/generic handlers or named handlers outside JSX events  | Their scheduling, identity, or closure semantics are outside the current lowering.  |
| Async/generator or generic components                                  | These function shapes are outside the current lowering.                             |
| Setters called outside JSX event handlers                              | The compiler only controls and batches event-driven local updates.                  |

Keys do not make list reconciliation unnecessary. A key tells React which child identity survives
an insert, removal, or move; React still needs to compare the dynamic children. Calling a Hook
directly inside a list iteration is also invalid React because the number or order of calls can
change. Put the Hook inside a keyed child component and leave that structure on React.

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

| React owns                                     | Compiler runtime owns                                           |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Initial element creation and placement         | Local compiler-cell values                                      |
| SSR markup and hydration                       | Queuing local setter calls into one microtask                   |
| JSX event registration and dispatch            | Comparing flushed values with `Object.is`                       |
| Parent-driven prop updates                     | Selecting bindings whose state dependencies changed             |
| Unsupported trees, hooks, refs, and lifecycles | Patching precomputed text/attribute targets after local updates |
| Host creation/removal inside an eligible block | Refreshing only the matching internal conditional boundary      |
| Unmounting and the surrounding component tree  | Reapplying bindings after a parent-driven React update          |

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

The compiler uses fallback as a semantic boundary, not as an error-recovery trick. A precomputed
path is only correct while the host tree has the same shape. Dynamic children, custom components,
refs, and effects can change ownership or lifecycle in ways the current compiler does not yet
model. Letting React handle them is the optimization's correctness mechanism.

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
- the packaged runtime is exercised separately with React 18.3 and React 19;
- boolean `data-*` and `aria-*` attributes keep React-compatible string values; and
- keyed lists, effects, refs, and custom child components remain on React without corrupting output.

The heavy example uses a fixed 768-host-node tree with three state cells and sparse bindings. Its
compiler-off → compiler-on crossover run measures a deliberately favorable supported workload. The
reference run reported 88.2% lower median update latency, 86% lower p95 latency, and zero added
component executions on the compiled path. These numbers describe that warm update path, not page
load, build time, browser layout/paint, network work, effects, child-component updates, or general
React performance.

Run the benchmark on target devices before using its timing as a product estimate. The structural
result—no extra component execution or React commit for an eligible local update—is the more stable
property.

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
keyed-fallback, compiler-on/off, and heavy-interaction experiments. The standalone starter
intentionally keeps the first experience focused.

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
