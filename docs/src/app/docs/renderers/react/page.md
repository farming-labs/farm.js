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
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-app --template basic --typescript
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

1. local state cells plus read-only cells for eligible primitive props;
2. the DOM path of every state-driven text or attribute binding; and
3. the state-cell dependencies for each binding.

After mount, an eligible local update flushes the changed cells and patches only the affected
bindings. A parent update still enters through React, but flat destructured `string`, `number`,
`boolean`, `bigint`, `null`, or `undefined` props can reuse the mounted compiled render plan and
patch the same dependency graph after commit. React still owns initial rendering, component
placement, the parent update, events, SSR, hydration, and unmounting. Identity-bearing props and
unsupported prop shapes keep the full React render path.

### Enable the compiler

Start from the focused experimental starter when you want the compiler flag, shared dark starter
UI, a live AOT-versus-React comparison, and a reproducible browser check already wired together:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta compiler-app --template react-compiler --typescript
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
  reactivity: "hybrid",
}
```

Omitting `experimental.compiler` or setting it to `false` disables the transform.

### Configuration API

```ts
type ReactCompilerMode = "infer" | "annotation";
type ReactCompilerReactivity = "static" | "hybrid";
type UnsupportedCompilerBehavior = "fallback" | "warn" | "error";

interface ReactCompilerOptions {
  mode?: ReactCompilerMode;
  directive?: string;
  onUnsupported?: UnsupportedCompilerBehavior;
  reactivity?: ReactCompilerReactivity;
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
| `reactivity`    | `"static"`, `"hybrid"`                | `"hybrid"`                  | Selects complete static dependencies or runtime-narrowed subscriptions.  |
| `report`        | boolean                               | `false`                     | Writes a compiler coverage report after a successful production build.   |
| `reportFile`    | project-relative path                 | `.farm/react-compiler.json` | Changes the report path and enables reporting when provided.             |

`directive` is valid only when `mode` is `"annotation"`. Invalid compiler, reactivity, or
unsupported-component modes and directives configured in inference mode throw a configuration
error instead of silently changing behavior.

### Static and hybrid reactivity

Both modes keep the compiler's complete state dependency list as the correctness boundary. They
also build a reverse dependency index once, so a state update goes directly to its candidate
bindings instead of scanning every binding in the component.

`"hybrid"` additionally marks compiler-proven, multi-state short-circuit expressions and observes
the `CompilerCell.get()` calls made by those direct text, attribute, and style readers after mount.
Ordinary bindings stay entirely on the static index. A reader such as
`enabled ? activeValue : inactiveValue` subscribes to `enabled` and only the selected value. When
`enabled` changes, the reader runs and replaces its subscriptions. The generated binding carries
the internal `tracking: "dynamic"` marker; application code never manages it. Structural block
dependencies remain compiler-defined, and unsupported expressions still fall back to React; this
option does not add a Proxy or make arbitrary JavaScript compiler-safe.

`"static"` uses the full dependency list for every update. It is useful as a deterministic
comparison and diagnostic mode. `"hybrid"` is the default because it can avoid inactive work while
preserving the compiler's safe fallback and React ownership boundaries. Both modes cache the last
committed direct-binding value and skip an identical DOM write.

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
    "fallback": 2,
    "keyedArrayAppendHints": 1,
    "keyedArrayFilterHints": 1,
    "keyedArrayPrependHints": 1,
    "keyedArrayPositionHints": 1,
    "keyedArrayReorderHints": 1,
    "keyedArraySortHints": 1,
    "keyedArrayRollingWindowHints": 1,
    "keyedArraySliceHints": 1,
    "keyedCollectionUpdateHints": 3,
    "keyedIdentityTargets": 2,
    "keyedMapLookupTargets": 1,
    "keyedMembershipTargets": 1,
    "keyedMapUpdateHints": 1
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
      "optimizations": {
        "keyedArrayAppendHints": 1,
        "keyedArrayFilterHints": 1,
        "keyedArrayPrependHints": 1,
        "keyedArrayPositionHints": 1,
        "keyedArrayReorderHints": 1,
        "keyedArraySortHints": 1,
        "keyedArrayRollingWindowHints": 1,
        "keyedArraySliceHints": 1,
        "keyedCollectionUpdateHints": 3,
        "keyedIdentityTargets": 2,
        "keyedMapLookupTargets": 1,
        "keyedMembershipTargets": 1,
        "keyedMapUpdateHints": 1
      },
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
using the AOT runtime, and `fallback` counts candidates left on React. `keyedIdentityTargets` counts
row bindings that can update by looking up the previous and next key directly.
`keyedMapLookupTargets` counts row bindings that can update from changed primitive values in a
local native `Map`.
`keyedMembershipTargets` counts row bindings that can update from the changed members of a local
native `Set`.
`keyedCollectionUpdateHints` counts proven native Set/Map mutation sites that can carry their
executed keys to the runtime.
`keyedMapUpdateHints` counts setter sites where the compiler proved that a direct keyed collection
can report its changed row indexes while an immutable `map()` runs. The same counts appear per
module.
`keyedArrayAppendHints` counts setter sites where the compiler proved a direct keyed array append
and can hand the appended suffix to the runtime. `keyedArrayFilterHints` counts concise keyed-array
filter sites that can report removed positions. `keyedArrayPrependHints` counts setter sites where
the compiler proved a direct keyed array prepend and can hand the new prefix to the runtime.
`keyedArraySliceHints` counts direct keyed-array slices whose build-time bounds identify one exact
retained interval.
`keyedArrayPositionHints` counts compiler-proven native keyed-array insertions, single or
contiguous-range removals, single-row replacements, and exact-window replacements with a guarded
position.
`keyedArrayReorderHints` counts direct native keyed-array reversals whose complete permutation is
known at build time.
`keyedArraySortHints` counts direct native keyed-array sorts whose resulting permutation can be
validated without rebuilding keyed rows.
`keyedArrayRollingWindowHints` counts direct keyed-array updates that retain a proven sliced tail
and append an incoming suffix.
`selected` is `true` when an annotation explicitly requested compilation. Module paths are relative
to the project root, and the output is sorted and contains no timestamp, so CI can compare reports
without machine-specific noise.

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

| Area                | Current supported shape                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Component discovery | A top-level, capitalized function declaration, function expression, or arrow component in application `.tsx` or `.jsx`.                         |
| Function shape      | Synchronous, non-generator, non-generic block body with zero parameters, one props identifier, or flat object props destructuring.              |
| Props               | Flat object destructuring supports shorthand names, aliases, and defaults. Referenced primitive values join the dependency graph after mount.   |
| Body                | Top-level `useState` declarations, optional compiler-safe derived values and synchronous named handlers, then one unconditional JSX return.     |
| State               | `const [value, setValue] = useState(initial)`, including lazy initializers, multiple cells, and queued functional updates.                      |
| Root                | Exactly one lowercase host JSX element such as `button`, `section`, `input`, or `div`.                                                          |
| Tree                | A statically known host tree around eligible conditional, keyed-list, compiled keyed-row, and component-island boundaries.                      |
| Text bindings       | State-driven text in a leaf host element.                                                                                                       |
| Attribute bindings  | Basic attributes, controlled form properties, and individual properties in one inline `style` object.                                           |
| Events              | Inline handlers and synchronous `const` or function-declaration handlers, including inline synchronous events in eligible host-only keyed rows. |
| Conditional blocks  | Logical/ternary host branches in dedicated containers or direct ranges among static host siblings, including the component root.                |
| Keyed lists         | Item-keyed maps and imported `List`, including safe collection pipelines; eligible rows use direct bindings and recursive host-only conditions. |
| Range siblings      | Stable host siblings beside ranges may patch leaf text, attributes, `className`, and individual inline style properties.                        |
| Component islands   | Stable imported or module-level component identifiers with explicit compiler-safe props and no JSX children, spread, `ref`, or `key`.           |

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
`trunc`. Safe keyed collections additionally accept the non-mutating pipeline described below. A
name is not treated as built-in when the component shadows it. Outside that pipeline, application
helpers, prototype methods, `Math.random`, optional calls, assignments, identity-bearing object or
array literals, functions, JSX, constructors, and other unproven expressions still fall back to
React.

For destructured props, the original component wrapper still performs JavaScript destructuring on
every parent render. Defaults therefore apply only to `undefined`, aliases keep their normal local
names, and the resolved values are passed to the compiled definition. A named handler can be a
synchronous `const` function or function declaration. It is expanded when passed directly to a JSX
event or called from that event's inline function, including arguments such as
`onClick={() => select(productId)}`. Calling it while producing the event prop, exposing it as a
child, using it outside an event, or making it async/generic still falls back to React.

#### Primitive prop cells

Flat destructured props referenced by the compiled render are assigned read-only cells after the
component's local state cells. The compiler includes those cell indexes in ordinary text,
attribute, style, conditional, keyed-range, and component-island dependencies. For example:

```tsx
export function Total({ label, price, quantity, enabled }: TotalProps) {
  const [discount, setDiscount] = useState(0);
  const total = price * quantity - discount;

  return (
    <section data-enabled={enabled}>
      <strong>
        {label}: {total}
      </strong>
      {enabled && <span>Ready</span>}
      <button onClick={() => setDiscount((value) => value + 1)}>Discount</button>
    </section>
  );
}
```

When `label`, `price`, `quantity`, or `enabled` changes to another primitive, React commits the
parent update, the compiled wrapper returns its already-mounted element, and the runtime commits
the new prop cells. Only dependent targets or blocks refresh. `discount` and a prop change in the
same turn share one coherent flush, so `total` observes both newest values.

The optimization is deliberately runtime-guarded. If any tracked value is an object, array,
function, symbol, React element, or `children`, the definition runs through normal React rendering
and reconciliation for that update. Components using an identifier props parameter also retain
the existing React prop path; flat destructuring is the current proof boundary. Props used only as
`useState` initializers keep React's normal initialize-once semantics and are not turned into live
state replacements. No extra option or annotation is required.

Stateful styles use one inline object literal. The compiler creates a separate binding for each
state-dependent camelCase property or CSS custom property, so changing `opacity` does not rewrite
an unrelated `width`. Style spreads, methods, computed names, and conditional whole objects remain
on React because their final property set or precedence can change.

### Conditional DOM blocks

This optimization is automatic for components selected by the existing experimental compiler
configuration. It does not require a conditional component, a new annotation, or another option.
The compiler can isolate logical and ternary child structures when their positions are known at
build time:

```tsx
export function StatusPanel() {
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [updates, setUpdates] = useState(0);

  return (
    <article data-update={updates}>
      <header>Status</header>
      {loading && <p>Loading update {updates}…</p>}
      <section>Stable content · update {updates}</section>
      {enabled ? <strong>Enabled at {updates}</strong> : <span>Disabled at {updates}</span>}
      <footer>
        <button onClick={() => setUpdates((value) => value + 1)}>Update values</button>
        <button onClick={() => setLoading((value) => !value)}>Toggle loading</button>
        <button onClick={() => setEnabled((value) => !value)}>Toggle status</button>
      </footer>
    </article>
  );
}
```

At build time, Farm records each condition's state cells and prepares a descriptor plus exact
text/attribute/style bindings for every host branch. It also counts the static host elements before
each range and after the final range. React still creates the complete initial tree during client
rendering, SSR, or hydration. After mount, Farm adopts the original container, its static siblings,
and any active branches. It does not add a wrapper, comment marker, or hydration attribute.

When a state update keeps the same branch, Farm patches only that branch's changed bindings and
preserves its DOM identity. When the condition changes, Farm inserts, removes, or replaces only that
range. Multiple ranges are evaluated from one state snapshot and committed from right to left, so
adjacent empty ranges and simultaneous changes keep their original order. Root attributes and
ordinary bindings such as `data-update` above continue to patch the same physical root. The user
component and unchanged static siblings do not execute or remount.

The compiler-owned path is deliberately narrow:

- A nested or component-root lowercase host container may contain one or more eligible direct
  conditionals separated by statically known host siblings. A nested container needs at least two
  meaningful children; the existing dedicated one-child optimization handles the smaller shape.
- Every other direct child is a lowercase host subtree. Its text and ordinary attributes may use
  supported bindings, and its event handlers remain React events. Fragments, custom components, or
  another dynamic structure beside a range keep that container on the React-owned path.
- Every non-empty branch has one lowercase HTML root and a statically known host-only descendant
  tree. Text, attributes, and individual inline style properties may use supported expressions.
- Branch events, `key`, custom components, fragments, refs, SVG, `dangerouslySetInnerHTML`, JSX
  spreads, interactive keyed rows, unsupported direct-child structures, and dynamic text mixed
  beside nested elements require React ownership.
- A ternary may use `null` or `false` for an empty branch. For logical `&&`, a numeric falsy value
  such as `0` can be visible React output, so the runtime remounts that container through React
  instead of incorrectly treating it as empty.
- The test and every prepared binding must use the same deterministic expression subset as other
  compiler bindings.

A dedicated host container whose conditional is its only meaningful child uses the same branch
descriptor and update behavior. It remains useful when a branch needs one fixed mounting location:

```tsx
<div>{loading && <p>Loading…</p>}</div>
```

### Recursive compiler-owned host blocks

An eligible compiler-owned branch may contain more eligible host-only blocks:

```tsx
<div className="panel-slot">
  {open ? (
    <section>
      <header>Inbox</header>
      <div>{loading && <p>Loading…</p>}</div>
      <ul>
        <li>Fixed row</li>
        {messages.map((message) => (
          <li key={message.id}>{message.title}</li>
        ))}
      </ul>
    </section>
  ) : (
    <aside>Closed</aside>
  )}
</div>
```

The outer `open` condition, nested `loading` range, and keyed `messages` range receive globally
unique block IDs and separate dependency lists. Updating `loading` touches only its host range.
Updating `messages` reuses matching rows, patches their prepared bindings, and applies LIS moves.
Neither update reruns the component or replaces the outer `section`.

If an outer condition and a descendant change in the same microtask, the scheduler commits the
outer block first and suppresses the now-redundant child refresh. Removing an outer branch cleans
every descendant subscription before removing its DOM. Reopening it creates the selected host tree
from current compiler cells, so updates made while closed cannot become stale work.

This recursive path is intentionally host-only. Nested conditional ranges may recurse again, and a
nested container may own one or more non-interactive keyed ranges separated by static host
siblings. Hooks, custom components, branch events, refs, SVG, fragments, dangerous HTML,
interactive rows, or unsupported structure inside an inner keyed row keep React ownership. React still renders the initial
client/SSR tree, hydrates it, reports recoverable mismatches, and handles every fallback. Duplicate
runtime keys or invalid adopted DOM remount the affected outer container through React; descendant
dependencies remain live after that handoff.

### Mixed conditional and keyed ranges

A safe host container may interleave both range kinds in their original order:

```tsx
<section>
  <header>Inventory</header>
  {loading && <p>Loading…</p>}
  <i>Rows</i>
  {items.map((item) => (
    <article key={item.id}>{item.label}</article>
  ))}
  {error ? <strong>Error</strong> : <span>Ready</span>}
  <footer>End</footer>
</section>
```

The compiler emits one mixed-range descriptor rather than competing conditional and list
controllers. Each slot records its kind and the number of static host siblings before it. On an
update, every condition and collection is read from one compiler-cell snapshot. Conditional slots
mount, replace, or remove one host branch; keyed slots reuse their per-key instances and run LIS
independently. Reconciliation proceeds from right to left, preserving the exact order when adjacent
ranges become empty, grow, or change together. Static header, divider, and footer nodes are never
used as synthetic markers and retain their DOM identity.

Those structurally stable siblings may still contain stateful values:

```tsx
<section>
  <header className={loading ? "busy" : "ready"}>{title}</header>
  {loading && <p>Loading…</p>}
  <i data-count={items.length}>Rows: {items.length}</i>
  {items.map((item) => (
    <article key={item.id}>{item.label}</article>
  ))}
  <footer style={{ opacity: enabled ? 1 : 0.5 }}>{summary}</footer>
</section>
```

The build records each sibling binding by static segment, sibling position inside that segment,
and nested host path. Unlike a live `children[index]` address, that coordinate does not shift when
an earlier condition mounts or when an earlier keyed range inserts, removes, or reorders rows. One
compiler flush can therefore patch the header, divider, and footer while also reconciling every
dynamic range, without rerunning the owner or replacing those siblings. Supported bindings are
safe leaf text, ordinary attributes, `className`, and individual properties in one inline style
object.

Safe host-only conditionals and keyed ranges may recurse inside a mixed branch or row. Every syntax
site still receives one globally unique block ID and a parent link, so an affected outer mixed block
suppresses redundant descendant refreshes. Removing a branch or keyed row cleans its nested mixed
subscriptions before removing DOM. Recreating it reads current state, preventing hidden or removed
work from becoming stale. Stateful static-sibling bindings use the same mechanism inside recursively
compiled branches and keyed rows; row-local bindings close over the current row descriptor and are
rebound when a surviving keyed row receives a new item value.

This path requires at least one conditional and one keyed `.map(...)` or `List` range in the same
lowercase host container. Every dynamic branch and row must have a statically known host tree and a
stable item-derived key. Hooks, custom components, events inside branches or rows, controlled forms,
refs, SVG, fragments, spreads, dangerous HTML, duplicate runtime keys, numeric logical output, or an
invalid hydration/adoption shape keep or transfer that complete container to React. Parent prop and
Fast Refresh changes also remount the container through React so the compiler never retains stale
closures or static markup. Static siblings remain plain lowercase host trees; lifecycle-sensitive
components, Hooks, refs, controlled forms, events requiring compiler DOM ownership, or unproven
expressions retain the existing React fallback.

The existing React-owned conditional boundary remains the fallback for supported complex shapes.
It can contain event handlers, nested host conditionals, keyed lists, and component islands while
still skipping the surrounding compiled component. Unsupported roots or unprovable behavior keep
the complete original React component. A parent-prop update, Fast Refresh, invalid adopted DOM, or
numeric logical output remounts the affected range container through React before direct updates
resume. In every tier, React remains responsible for delegated events, error boundaries, Strict
Mode, SSR, and hydration semantics.

### Compiled keyed rows and React list boundaries

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

This dedicated `ul` has one meaningful child and each row is a host-only tree. Farm can therefore
prepare the row's host descriptor, key reader, and exact text, attribute, and style bindings at
build time. React still creates the initial elements during client render or hydration. After the
component mounts, Farm adopts those elements as keyed row instances.

Updating `items` then does not execute `Inventory` or its JSX row-render callback. Surviving rows
are found by key and their prepared bindings are patched directly. Missing keys remove only their
row, and new keys create only their prepared host tree. During a reorder, Farm calculates the
longest increasing subsequence (LIS) of the old row positions. Rows in that subsequence stay in
place; only the other surviving rows move. LIS is a runtime move planner over compiler-prepared
rows, not a claim that the future contents of an array are known at build time.

#### Key-directed selection updates

A separate state or primitive prop often identifies one active row while the collection itself
does not change:

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null);

<tbody>
  {rows.map((row) => (
    <tr
      aria-selected={row.id === selectedId}
      className={row.id === selectedId ? "selected" : ""}
      key={row.id}
    >
      <td>{row.label}</td>
    </tr>
  ))}
</tbody>;
```

For an exact `===` or `!==` comparison against the same expression used by `key`, the compiler
records which state or primitive-prop cell supplies the target. After mount, changing `selectedId`
looks up the previously selected key and the next selected key in the existing row-instance map.
Only those rows evaluate the affected class, attribute, style, or leaf-text binding. A 20,000-row
selection therefore performs at most two row-binding evaluations instead of scanning all 20,000
rows. The component and its `map()` callback still do not rerun.

This proof is intentionally narrow. The target must be read only as an operand of strict key
comparisons, the binding must have no second reactive dependency, and the target must not also
change the collection or its key projection. The runtime accepts only string, number, bigint, or
nullish targets. Object, array, boolean, ambiguous, mixed structural, React-owned, nested-block, and
unsupported expressions use the existing complete evaluation or React fallback. Missing keys are
safe and simply patch no next row. No option or component primitive is required. The compiler
report exposes the number of emitted row-binding proofs as `keyedIdentityTargets`.

#### Key-directed Set membership updates

Multi-selection usually keeps several row keys in local state:

```tsx
const [markedIds, setMarkedIds] = useState(() => new Set<number>());

<tbody>
  {rows.map((row) => (
    <tr data-marked={markedIds.has(row.id)} key={row.id}>
      <td>{row.label}</td>
    </tr>
  ))}
</tbody>;
```

For an exact `localSet.has(rowKey)` binding, the compiler records the local state cell and the row
key expression. The runtime snapshots the previous and next members and computes their symmetric
difference. Only rows whose membership changed evaluate that binding. Replacing two marked keys in
a 20,000-row table therefore touches at most four matching row instances instead of scanning every
row. The component and its `map()` callback do not rerun.

The proof accepts only a direct `has()` call on one local `useState` value with the exact expression
used by `key`. At runtime, targeting requires an ordinary native `Set` containing only string,
number, bigint, or nullish members. Set subclasses, proxies, own `has` overrides, object members,
different row fields, extra reactive dependencies, React-owned rows, nested blocks, and structural
key dependencies do not use this path. If a runtime value fails the native-Set guard, that keyed
boundary returns to React before compiled bindings are evaluated. This keeps custom collection
semantics and error handling under React ownership. No option or component primitive is required.
The report exposes the emitted binding count as `keyedMembershipTargets`.

#### Key-directed Map lookup updates

Per-row status and metadata often live in a local Map rather than on the row objects:

```tsx
const [statusById, setStatusById] = useState(() => new Map<number, string>());

<tbody>
  {rows.map((row) => (
    <tr data-status={statusById.get(row.id) ?? "none"} key={row.id}>
      <td>{row.label}</td>
    </tr>
  ))}
</tbody>;
```

For an exact `localMap.get(rowKey)` binding, the compiler records the local state cell and row-key
expression. The runtime snapshots the previous and next entries and compares mapped values with
`Object.is`. Only keys whose visible lookup result changed evaluate the row binding. Status text,
validation messages, progress attributes, classes, and styles can therefore update without
evaluating the same lookup for every row. The component and its `map()` callback do not rerun.
Snapshot comparison still visits Map entries; this optimization removes the full row-binding and
DOM-target scan, not the application's Map construction or the runtime's entry comparison.

The proof accepts one local `useState` dependency and a direct `get()` call with the exact
expression used by `key`. At runtime, targeting requires an ordinary native `Map` with string,
number, bigint, or nullish keys and string, number, bigint, boolean, or nullish values. Map
subclasses, proxies, own `get` overrides, object values, different row fields, extra reactive
dependencies, React-owned rows, nested blocks, and structural key dependencies do not use this
path. A failed runtime guard returns that keyed boundary to React before compiled bindings run.
No option or component primitive is required. The report exposes the emitted binding count as
`keyedMapLookupTargets`.

#### Producer-side Set and Map deltas

The Set-membership and Map-lookup paths above normally compare complete previous and next
snapshots to discover which keys changed. Farm can remove that second collection scan when it can
prove a compiler-owned immutable functional update:

```tsx
setMarkedIds((current) => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
});

setStatusById((current) => new Map(current).set(id, "ready"));
```

The JavaScript written by the application still creates and mutates its fresh collection, so
`new Set(current)` and `new Map(current)` retain their normal cost and semantics. At build time,
the compiler wraps only proven native `Set.add`, `Set.delete`, `Map.set`, and `Map.delete` calls.
The generated metadata contains the keys whose mutations actually executed. At commit, the
runtime validates those keys against the previous collection and updates only matching keyed-row
bindings instead of walking every old and new entry to rediscover the delta.

Concise `new Set(current).add(key)` and `new Map(current).set(key, value)` updaters are supported.
A block updater may clone `current` once into a `const`, read `has`, `get`, or `size`, perform native
mutations, and return `current`, that clone, or a fresh same-kind collection. Queued functional
updates compose. Runtime snapshots use persistent change overlays and compact after a bounded
chain, so repeated updates do not build an unlimited lookup history.

The proof requires a native collection created by the same local `useState` declaration. Every
setter use for that state must be either a fresh same-kind replacement or a proven updater. Direct
state mutation, unknown setter results, state or draft escape, draft aliases, shadowed
constructors, collection subclasses/proxies, object keys, and object Map values disable the delta
path. A failed proof keeps the existing full snapshot comparison; a failed runtime safety check
returns the boundary to React before compiled binding reads. This is an internal optimization and
adds no component, directive, or configuration. Reports expose the number of wrapped native
mutation sites as `keyedCollectionUpdateHints`.

#### Mutation-aware same-order updates

The compiler can remove the runtime's second full-row scan for a common immutable update:

```tsx
setItems((current) =>
  current.map((item) => (item.id === targetId ? { ...item, selected: !item.selected } : item)),
);
```

This needs no option or component primitive. At build time, Farm recognizes a functional setter on
the direct `useState` collection used by a compiled keyed map or `List`. The mapper must be a concise
arrow expression with a conditional result: one branch returns the original item and the other
returns a new object that spreads that item. The condition and replacement values must use the
compiler's safe expression subset. The hint runtime is retained only in modules where at least one
such site is emitted; direct-only and ordinary keyed builds do not import that capability.

The generated mapper records an index only when the returned item has a different identity. The
user's `map()` still runs and is still O(n); the optimization avoids reading every key and every row
binding again after it finishes. Farm validates that the array length and each reported row's key
and index are unchanged, then patches only those row instances. Multiple hinted functional updates
queued in one compiler flush are combined.

If a key changes, an insert, removal, or reorder occurs, a relevant second dependency changes, or a
runtime check fails, Farm discards the hint and runs the existing complete keyed reconciliation and
LIS path. Derived collections, non-functional setters, block-bodied mappers, mutating replacements,
and other unproven shapes also keep that existing path. This is an optimization hint, not a new
correctness contract or a way to bypass React fallback behavior. The compiler report exposes the
number of emitted sites as `keyedMapUpdateHints`.

#### Keyed array append hints

A direct keyed `useState` array can also avoid rescanning all existing rows for common immutable
appends:

```tsx
setItems((current) => [...current, nextItem]);
setItems((current) => [...current, ...nextItems]);
```

At build time, Farm recognizes a concise functional setter whose array literal starts with exactly
`...current` and has at least one trailing item or spread. The application still creates its normal
immutable array. Generated metadata connects that result to the last committed array and records
where its appended suffix begins. Queued functional appends form one validated chain.

At update time, existing keyed rows already have the same item, key, and index. Farm therefore
reads keys, descriptors, and bindings only for the appended suffix, creates only those host rows,
and inserts them together with a document fragment. It does not rerun the owner component or touch
the existing row DOM.

The proof is intentionally narrow. Both values must be native arrays. Middle insertion, removal,
direct replacement, a copy with no appended entries, block-bodied updaters, duplicate
keys, React-owned or nested host-block rows, row conditionals, and rows whose bindings read the
collection itself keep complete keyed reconciliation. Keys that read the collection also prevent
the compiler from emitting the hint. A preceding unhinted update, an unrelated
dirty dependency, or any failed source/length check also discards the hint. These fallbacks preserve
normal React behavior; the syntax does not opt the component into a different correctness model.
The compiler report exposes emitted sites as `keyedArrayAppendHints`, and the hinted runtime is
retained only when a module emits at least one append or same-order map hint.

#### Keyed array prepend hints

A direct keyed `useState` array can avoid rescanning every existing row when new items are inserted
at the beginning:

```tsx
setItems((current) => [nextItem, ...current]);
setItems((current) => [...nextItems, ...current]);
```

At build time, Farm recognizes a concise functional setter whose array literal ends with exactly
`...current` and has at least one leading item or spread. The application still creates its normal
immutable array. Generated metadata connects the result to the last committed array and records
the prefix length. Multiple hinted prepends queued before one compiler flush form one validated
chain.

At update time, Farm verifies native arrays, source identity, lengths, and every existing suffix
item before changing the DOM. It reads keys, descriptors, and bindings only for the new prefix,
creates only those host rows, inserts them before the first existing row, and shifts the stored
indexes used by delegated row events. Existing row DOM is neither recreated nor rebound.

This proof requires compiler-owned host rows whose render callback and key do not read the row
index. Index-aware rows, collection-derived keys, collection-reading bindings, React-owned or
nested host-block rows, row conditionals, middle insertion, removal, direct replacement,
block-bodied updaters, duplicate keys, custom, sparse, or subclassed arrays, an unrelated dirty
dependency, or any failed runtime check keeps complete keyed reconciliation. A prepend queued
after an unhinted update also falls back. Reports expose emitted sites as
`keyedArrayPrependHints`; the optional runtime capability is retained only when a module emits the
matching hint.

#### Keyed array slice hints

A direct keyed `useState` array can retain a known window without rescanning all surviving rows:

```tsx
setItems((current) => current.slice(1_000));
setItems((current) => current.slice(0, -1_000));
setItems((current) => current.slice(2, 8));
setItems((current) => current.slice(-5));
```

At build time, Farm recognizes a concise functional setter that directly calls native `slice()`
with one or two safe-integer bounds known by the compiler. The application still executes its
ordinary `slice()`. Generated metadata records the normalized retained interval and links multiple
slice or filter updates queued before one compiler flush.

At update time, Farm validates the native arrays, committed source, queued lengths, interval, and
surviving item identities before changing the DOM. It removes only rows outside the interval,
updates stored indexes used by delegated row events, and preserves every surviving element. A
slice-only chain does not reread surviving keys, descriptors, or bindings, and the owner component
does not rerun.

The proof requires compiler-owned host rows whose render callback and key do not observe the row
index. Runtime or fractional bounds, `slice()` without a bound, a no-op `slice(0)`, block-bodied or
chained updaters, custom slice methods, sparse or subclassed arrays, collection-derived keys,
collection-reading bindings, React-owned row structures, nested host blocks, row conditionals,
unrelated dirty dependencies, and failed runtime validation keep complete keyed reconciliation.
These checks make the metadata an optional optimization rather than a new behavior contract. No
configuration or component primitive is added. Reports expose emitted sites as
`keyedArraySliceHints`; slice reuses the existing removal-hint runtime so it does not add another
structural runtime combination.

#### Keyed array rolling-window hints

Queues, logs, charts, and fixed-size feeds often expire a prefix while adding new rows:

```tsx
setItems((current) => [...current.slice(1), nextItem]);
setItems((current) => [...current.slice(1_000), ...nextItems]);
```

At build time, Farm recognizes a concise functional setter whose first array entry spreads a
direct native `current.slice(bound)` and whose remaining entries are compiler-safe incoming values.
The application still performs the same slice and array construction. Farm records only metadata
that connects the final array to its committed source and retained interval.

At update time, Farm validates native arrays, the committed source token, the exact retained tail,
every retained item identity, and every incoming key before changing the DOM. It removes the
expired prefix, updates stored event indexes, preserves every retained element, and creates only
the incoming suffix. Incoming keys are checked against the complete previous window; reusing an
expired key takes full keyed reconciliation so React key identity is preserved.

The initial proof is intentionally narrow: one build-time safe-integer slice bound,
compiler-owned host rows, and index-independent render and key callbacks. A second slice bound,
runtime or zero bounds, block-bodied updates, custom slice behavior, sparse or subclassed arrays,
queued uncommitted windows, collection-reading bindings, index-aware rows, React-owned rows,
nested host blocks, row conditionals, unrelated dirty dependencies, and failed runtime validation
all keep complete keyed reconciliation. No new component or option is required. Reports expose
emitted sites as `keyedArrayRollingWindowHints`; only modules with such a site retain the optional
all-hint runtime.

#### Keyed array known-position hints

Native immutable array methods can state an exact insertion, removal, or replacement position:

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

At build time, Farm recognizes only concise functional setters whose position is either a
safe-integer literal or a compiler-safe runtime expression. Identifiers, property reads,
side-effect-free arithmetic and conditionals, and safe `Math` calls are supported. User-defined
calls, assignments, update expressions, and other effectful forms are not transformed.
`toSpliced()` must insert compiler-safe items with a zero delete count, remove one item or a
contiguous range using a positive safe-integer literal delete count, replace exactly one item with
a delete count of one, or replace a positive safe-integer literal window with compiler-safe
explicit items or a safe spread; `with()` must replace exactly one item. A zero delete count with
an explicit pair or a safe spread such as `...incomingItems` selects the batch insertion path when
at least two items are produced at runtime. A delete count above one with any incoming item, or a
positive delete count with multiple items or a spread, selects exact-window replacement; the spread
may evaluate to zero, one, or many items. Farm
preserves the original method lookup,
evaluates every argument once in its original order, and preserves the native call, return value,
coercion, and thrown errors. If the method is not native, the evaluated position is not already a
safe integer, or the removal count is dynamic or unsafe, the update still runs normally but no
metadata is recorded.

At update time, Farm validates the committed native source, result length, source token, normalized
position, clamped removal count, and any incoming key before changing the DOM. For a batch, Farm
computes every key, descriptor, binding snapshot, and detached host row before mutating the live
tree. Duplicate incoming keys or collisions with existing keys therefore take complete
reconciliation without a partial insertion. Valid rows are mounted in one document fragment;
surrounding elements remain connected and only stored suffix indexes shift. Exact-window
replacement with fresh keys removes only the proven old interval after every incoming row is
prepared. If the incoming interval has the same length and exactly the same keys in the same order,
Farm first evaluates all keys and binding snapshots and resolves every changed target across the
complete interval. It then patches only changed bindings in place and updates each stored row
object, so later delegated or cached handlers observe the latest data. No descriptor or DOM row is
created, and every row keeps its identity, focus, and text selection. A window may instead grow or
shrink while it reorders keys from inside its own removed interval and mixes them with globally
fresh keys. Farm prepares all reused binding updates, new descriptors, binding snapshots, and
detached rows before the first DOM write. It removes only retired rows, preserves each reused row,
batches adjacent new rows in a fragment, updates shifted suffix indexes, and applies LIS only to
the reused part of that interval so it moves the fewest connected rows needed by the local
permutation. Rows outside the interval are not rerendered or rebound. Multiple length-preserving
same-key windows queued before one compiler flush compose into one atomic refresh. Fixed-length
queued windows may mix same-key rows with globally new final keys, and both disjoint and
overlapping windows are supported. An overlapping position uses the last queued value;
intermediate identities are never mounted. Farm validates the complete chain and final key set,
then prepares every touched key, binding value, DOM target, new descriptor, binding snapshot, and
disconnected DOM row before the first write. It patches same-key positions and swaps only final
fresh-key positions. Untouched rows retain their identity. Duplicate final keys and keys reused
from outside a single removed interval take complete reconciliation before fast-path mutation. A
queued chain may also contain disjoint grow or shrink windows. Farm maps every immediate-source
position through earlier length changes, proves that the source and final intervals remain
disjoint, and prepares all local key reuse, fresh rows, binding updates, cleanup, and per-window LIS
moves before changing the DOM. Adjacent windows and empty incoming intervals remain eligible. An
overlapping structural window or a key transferred between windows keeps complete reconciliation.
A single insertion
creates one row at that position. A removal cleans up and removes only the known row or contiguous
range while preserving every
surviving element. A same-key replacement patches that row in place; a new-key replacement creates
and swaps one host row. The owner component does not rerun, and surviving row keys, descriptors,
and bindings are not reread.

The proof requires compiler-owned host rows whose render and key do not observe the row index.
Effectful position expressions, runtime values that are fractional or otherwise not safe integers,
dynamic, zero, negative, or fractional removal counts, other `toSpliced()` shapes, block-bodied
updaters, unsafe incoming expressions, custom methods, overlapping queued structural windows,
unhinted intermediate updates, an existing key moved from outside its local removed interval or
between queued windows, duplicate final keys, collection-reading bindings, React-owned rows,
nested host blocks, row conditionals, unrelated dirty dependencies, and failed runtime checks keep
complete keyed reconciliation.
Negative safe-integer positions and counts larger than the remaining suffix use the native
method's normal clamping rules. No new option or component is required. Reports expose emitted
sites as `keyedArrayPositionHints`. Batch insertion and exact-window replacement select
progressively separate optional runtime capabilities, so modules with only single-row operations
or batch insertion retain no window-replacement runtime.

#### Keyed array reorder hints

A direct native reverse states the complete next order without changing keyed row identity:

```tsx
setItems((current) => current.toReversed());
```

Farm recognizes only this concise functional-setter form. It preserves the original method lookup,
native call, returned array, and thrown errors. Metadata is recorded only when the committed source
and result are ordinary native arrays and the executed method is the native `toReversed()` method.
A custom or unavailable method therefore keeps its normal behavior and never enters the fast path.

At update time, Farm verifies the committed source token, equal lengths, every source row identity,
and the exact reversed result before moving the DOM. The runtime leaves one row in place and moves
the other rows through connected `insertBefore()` operations, the minimum `n - 1` moves for a
reverse. It does not call row keys, recreate descriptors, reread bindings, or run the generic LIS
calculation. Existing elements, handlers, form state, and focus stay attached to their keys.

The first proof requires compiler-owned host rows whose render and key do not observe the index.
Arguments, computed or chained calls, block-bodied updaters, subclassed or sparse behavior,
collection-reading bindings, custom methods, two reversals queued before one commit, React-owned
rows, nested host blocks, row conditionals, unrelated dirty dependencies, and any identity mismatch
use complete keyed reconciliation. No option or component is added. Reports expose emitted sites as
`keyedArrayReorderHints`; modules without one do not retain the optional reorder runtime. The
application runtime must provide `Array.prototype.toReversed`; Farm does not polyfill it.

#### Keyed array sort hints

A direct native immutable sort can reuse every keyed row while changing only its DOM position:

```tsx
setItems((current) => current.toSorted((left, right) => left.rank - right.rank));
setLabels((current) => current.toSorted());
```

Farm recognizes a concise functional setter with either no comparator or an inline synchronous
comparator from the compiler's safe expression subset. It preserves the original method lookup,
comparator execution, native result, stable-sort behavior, and thrown errors. The native sort still
does the comparison work; this optimization removes repeated keyed-row work after the result is
known.

At commit time, Farm verifies a committed ordinary dense array, the native `toSorted()` method,
equal lengths, and a one-to-one identity match between the previous and sorted items. It then
computes the longest increasing subsequence of the resulting permutation and moves only the rows
outside that subsequence. Keys, descriptors, and bindings are not reread, the owner component does
not rerun, and existing elements, handlers, form state, focus, and text selection remain attached
to their rows.

This proof requires compiler-owned host rows whose render and key do not observe the row index.
Referenced comparators, block-bodied updaters, computed or chained calls, custom methods, sparse or
subclassed arrays, duplicate item identities, collection-reading bindings, queued uncommitted
sorts, React-owned rows, nested host blocks, row conditionals, unrelated dirty dependencies, and
failed validation keep complete keyed reconciliation. Reports expose emitted sites as
`keyedArraySortHints`. Sort shares the optional reorder runtime, and Farm does not polyfill
`Array.prototype.toSorted`.

#### Keyed array filter hints

A concise immutable filter on a direct keyed `useState` array can remove rows without rebuilding
every surviving row:

```tsx
setItems((current) => current.filter((item) => item.id !== removedId));
```

At build time, Farm recognizes the direct functional setter and a synchronous, one-parameter,
expression-bodied predicate from the compiler's safe expression subset. The native `filter()`
still runs normally. Its generated wrapper records rejected positions and links queued filters to
the last committed array.

At update time, Farm validates the native-array chain, result lengths, surviving item identities,
and surviving keys before changing the DOM. It then removes only rejected row elements, updates
the stored positions used by delegated row events, and keeps all surviving elements in place. Row
descriptors and bindings are not recreated or reread, and the owner component does not rerun.

The proof applies only to compiler-owned host rows whose render callback and key do not observe the
row index. An index-aware row or predicate, collection-derived key, block-bodied updater or
predicate, custom filter method, sparse or subclassed array, binding that reads the collection,
React-owned row structure, nested host block, row conditional, unrelated dirty dependency, or
failed runtime validation keeps complete keyed reconciliation. A filter queued after an unhinted
update also falls back. These checks make the hint an internal optimization rather than a new
behavior contract. Reports expose emitted sites as `keyedArrayFilterHints`; the optional hinted
runtime is retained only when a module emits a supported update hint.

#### Interactive host rows

An otherwise eligible host-only row may contain inline synchronous React events:

```tsx
export function Inventory() {
  const [items, setItems] = useState(initialItems);

  return (
    <ul>
      {items.map((item, index) => (
        <li data-selected={item.selected} key={item.id}>
          <span>{item.label}</span>
          <button
            data-index={index}
            onClick={(event) => {
              event.stopPropagation();
              setItems((current) =>
                current.map((row) =>
                  row.id === item.id ? { ...row, selected: !item.selected } : row,
                ),
              );
            }}
            type="button"
          >
            Toggle
          </button>
        </li>
      ))}
    </ul>
  );
}
```

This uses a hybrid ownership model. React creates or hydrates every row, installs the event props,
and performs every structural insert, removal, or reorder. Farm does not call `addEventListener`
and does not create an eventful row outside React's Fiber tree. At build time, the compiler replaces
each eligible row event prop with a stable keyed proxy and prepares the row's ordinary bindings.

When React dispatches the event, the proxy resolves that key's current row instance and passes the
latest item and index to the original handler. Replacing `{ id: "a", label: "Alpha" }` with a new
object for key `"a"`, or moving it to a new index, therefore cannot leave the handler with the item
or index captured by an older map execution.

If an update keeps the exact key sequence, Farm patches changed text, attributes, and styles without
executing the owner component or map callback. If keys are inserted, removed, or reordered, the
internal boundary renders once and lets React reconcile. After that commit, Farm validates and
re-adopts the host rows, reapplies every current binding, and resumes direct same-key updates. The
reapply step is important because React compares its next props with its previous virtual props,
which may predate a direct DOM patch.

The initial event contract is deliberately conservative: the row and descendants must still be a
statically known HTML host tree; the handler must be inline, synchronous, and free of Hooks,
`this`, `super`, and `arguments`. Non-inline or async handlers, custom row components, fragments,
refs, SVG, spreads, and other unproven shapes use the React-owned keyed boundary. The same hybrid
path is available to an eligible inline host row rendered through `List`.

#### Controlled fields in keyed rows

An eligible host row can contain ordinary controlled form fields:

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
      <input
        type="checkbox"
        checked={item.done}
        onChange={(event) =>
          setItems((current) =>
            current.map((row) =>
              row.id === item.id ? { ...row, done: event.currentTarget.checked } : row,
            ),
          )
        }
      />
      <select value={item.priority} onChange={/* the same keyed update pattern */}>
        <option value="low">Low</option>
        <option value="high">High</option>
      </select>
    </li>
  ))}
</ul>
```

React still creates or hydrates the controls, dispatches `change`, `input`, selection, and
composition events, and reconciles any key insertion, removal, or reorder. Farm prepares the
`value` and `checked` property bindings at build time. A same-key edit flushes the collection cell,
looks up that row instance, and writes only the affected form properties and dependent row output;
the owner component and map do not execute again.

This is property-based rather than attribute-only. Text inputs and textareas update `.value`,
checkboxes and radios update `.checked`, and controlled single or multiple selects update their
selected options. The runtime avoids assigning an equal value, captures the focused text control's
selection before the compiler microtask, and restores the range after its keyed boundary commits.
Composition handlers remain React event props, so IME event order is unchanged.

React exposes `event.currentTarget` only while an event handler is running. If a functional
compiler-state updater refers to one of its properties, the transform snapshots that property read
before queuing the updater. This preserves the common keyed update shown above without retaining or
replaying the SyntheticEvent, and it prevents React's controlled-field restoration from changing a
deferred `.value` or `.checked` read.

The initial optimized contract requires a static input `type` and static `<option>`/`<optgroup>`
attributes. File input values, dynamic input types, dynamic option state, `contentEditable`, refs,
custom controls, async or non-inline handlers, and a controlled textarea that also has children use
the React fallback. Duplicate keys discovered at runtime also switch that mounted list to React.
These limits apply equally to automatically detected maps and inline host rows inside `List`.

#### Compiler-owned host conditionals inside keyed rows

A non-interactive keyed host row may contain logical or ternary host branches. The branches may
sit beside static host siblings and may contain deeper safe host-only conditions:

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

At build time, the compiler prepares the complete lowercase host descriptor for one row, including
the tests, static sibling counts, branch factories, text/attribute/style bindings, and recursively
nested conditionals. React still renders or hydrates the initial list. After mount, each key owns one
row instance and its nested host scopes. A same-key update creates the next lightweight descriptor,
patches a surviving branch in place, mounts or removes only a changed branch, and leaves the row and
static siblings untouched. The user component and map callback do not rerun.

Insertions and removals create or clean only the affected row scopes. Reorders use the same LIS pass
as ordinary compiler-owned keyed rows, so a condition change and a reorder queued in one event are
committed from the same latest collection. Block IDs remain unique in the component graph, while
the runtime scopes repeated row descriptors by their stable key. No marker nodes or extra wrappers
are added to SSR output.

This compiler-owned tier requires a lowercase host row with no events. Branches may use logical or
ternary expressions, multiple known locations, static siblings, nested lowercase host conditions,
and safe text, attribute, or inline-style expressions. It applies to automatic keyed `.map(...)`
syntax and inline host rows rendered by `List`.

Hooks, custom components, events inside a compiler-owned branch, refs, SVG, fragments, JSX spreads,
dangerous HTML, controlled inputs inside a conditional, and any unproven shape stay on React.
Existing interactive keyed rows keep their React-owned conditional-slot behavior: Farm compares row
snapshots and asks React to refresh a changed slot, while React retains event, Fiber, hydration, and
structural-list ownership. Duplicate runtime keys or an invalid adopted shape also switch the
complete mounted list to React.

#### Nested keyed lists inside keyed rows

A non-interactive outer row may own one or more inner keyed ranges in known host containers:

```tsx
<div>
  {projects.map((project) => (
    <section key={project.id}>
      <h2>{project.name}</h2>
      <ul>
        <li className="heading">Tasks</li>
        {project.tasks.map((task, taskIndex) => (
          <li key={task.id} data-index={taskIndex}>
            {task.title}
          </li>
        ))}
        <li className="footer">End</li>
      </ul>
    </section>
  ))}
</div>
```

The build emits one outer keyed-row descriptor and embeds an inner keyed-range descriptor in that
row. At runtime every stable `project.id` owns a separate inner key table for its tasks. Reordering
projects applies LIS to the outer list. Reordering one project's tasks applies a second LIS pass
only inside that project. A surviving project, task, and every static sibling keep their DOM
identity; updating the inner task does not rerun the component or either map callback.

The inner scope moves with its outer key and is cleaned when that project is removed. React still
renders or hydrates the original nested lists, after which the compiler adopts the existing DOM.
An outer and inner update queued together are read from the same latest collection. Duplicate keys
at either level, or DOM that cannot be adopted safely, transfer the complete mounted outer list to
its original React render.

The nested contract accepts automatic `.map(...)` and inline `List` ranges, multiple ranges
separated by static host siblings, item-derived keys, and safe text, attribute, and inline style
bindings. The outer row may also contain eligible host-only conditional blocks in other known
locations. Inner rows remain lowercase, non-interactive host trees. Events, controlled fields,
Hooks, custom components, fragments, refs, SVG, JSX spreads, dangerous HTML, and index keys keep the
outer row on React's safe fallback.

#### Recursive keyed scopes

The same analysis continues through every safe keyed host row; there is no special two-level
syntax:

```tsx
<div>
  {boards.map((board) => (
    <section key={board.id}>
      <h2>{board.name}</h2>
      <div>
        {board.columns.map((column) => (
          <article key={column.id}>
            <h3>{column.name}</h3>
            <ul>
              {column.cards.map((card) => (
                <li key={card.id}>{card.title}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  ))}
</div>
```

Build-time recursion assigns a globally unique block ID and parent relationship to every keyed
container. At runtime the hierarchy is scoped by stable keys: a board instance owns its column
controller, and each column instance owns its card controller. Every controller keeps an isolated
key table and performs LIS only inside its own container. A simultaneous board, column, and card
rotation therefore preserves all surviving DOM identities and runs one independent move plan at
each affected depth without rerunning the component or map callbacks.

Removing a parent recursively unsubscribes and removes all descendant scopes. Parent and local
updates use the latest complete descriptor tree, and SSR or hydrated DOM is adopted from the
outside inward. Duplicate keys or an invalid adopted shape at any level transfer the complete
mounted outer keyed boundary to React, where subsequent updates remain live.

Recursion does not widen the safety contract. Every optimized row must still be a non-interactive
lowercase host tree with an explicit item-derived key. An event, controlled field, Hook, custom
component, fragment, ref, SVG, spread, dangerous HTML, index key, or other unproven structure at
the deepest level keeps the outer row on React rather than partially compiling an unsafe tree.

#### Derived collection pipelines

The collection may be prepared through an inline, non-mutating pipeline before the final keyed
`.map(...)` or before it is passed to `List`:

```tsx
const visibleItems = items.filter((item) => item.visible && item.rank >= minimumRank);
const orderedItems = visibleItems.toSorted((left, right) => left.rank - right.rank);
const pageItems = orderedItems.slice(offset, offset + pageSize).toReversed();

return (
  <ul>
    {pageItems.map((item) => (
      <li key={item.id}>{item.label}</li>
    ))}
  </ul>
);
```

The compiler expands those derived locals, records the state cells used by the collection,
predicate, comparator, and window arguments, and subscribes the keyed boundary to only those
dependencies. When one changes, the pipeline runs once to produce the next collection. The existing
keyed-row runtime then reuses surviving rows, patches their bindings, and applies LIS to the new key
order. An unrelated state update does not rerun the pipeline or the outer component.

The initial pipeline contract supports:

- `filter` with one synchronous inline callback using an item and optional index;
- `slice` with up to two compiler-safe arguments;
- `toSorted` with no comparator or one synchronous inline two-item comparator;
- `toReversed` without arguments; and
- any sequence of those methods followed by one keyed `.map(...)` or used as `List each`.

Callback bodies must contain one compiler-safe returned expression. Assignments, Hooks, async
callbacks, spread arguments, calls to unproven helpers or prototype methods, external callbacks,
and mutating methods such as `sort`, `reverse`, and `splice` keep the original React component. The
compiler does not claim that filtering or sorting is free: it avoids unrelated component execution
and React reconciliation, while the necessary collection work still runs when one of its own
dependencies changes.

Farm leaves these standard methods in the generated JavaScript; it does not inject a polyfill.
Applications using `toSorted` or `toReversed` must target runtimes that provide them and include an
ES2023 TypeScript library. `filter` and `slice` do not require that newer library.

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
when this particular use cannot be optimized. The `InventoryRow` example stays in a React-owned
keyed boundary because a custom component may contain Hooks, events, context, effects, and local
state. The surrounding compiled component can still avoid executing again. Hooks belong inside a
row component such as `InventoryRow`, never directly inside the `List` child function or a
`.map()` callback.

The compiler uses four keyed-list tiers:

1. A dedicated nested host container with one direct map or one `List`, returning a non-interactive
   host-only row, becomes compiler-owned keyed row instances. Farm patches bindings and uses LIS;
   eligible outer rows may carry separately scoped nested keyed ranges.
2. A nested or component-root host container with one or more non-interactive keyed host ranges
   becomes one compiler-owned range block. Farm preserves any static segments and applies the same
   row descriptors and LIS reconciliation independently inside each range.
3. The dedicated single-list shape with eligible inline events or other React-owned row-local slots
   keeps React event and structural ownership, while Farm patches same-key row bindings and refreshes
   only changed conditional boundaries.
4. A safe keyed map or `List` that cannot use an optimized row shape becomes a small React-owned keyed
   boundary. React reconciles its rows, while the outer user component still avoids rerunning.

#### Keyed DOM ranges

Static siblings no longer force ordinary host rows onto the React-owned list tier:

```tsx
<ul>
  <li className="heading">Primary</li>
  {primary.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}

  <li className="heading">Secondary</li>
  {secondary.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}

  <li>{primary.length + secondary.length} total</li>
</ul>
```

React renders or hydrates the original `ul` without wrapper elements or marker nodes. After mount,
the range block partitions its direct element children into static segments and keyed ranges using
the build-time shape and current collection lengths. Static header, divider, and footer elements
retain their DOM identity. Each range keeps its own key-to-row table and LIS calculation, so an
update in one range cannot reorder another range or its surrounding static elements. Stateful text,
attributes, `className`, and individual inline styles inside the static host siblings are attached
to the range controller through stable segment addresses, so they patch in the same flush as the
keyed rows without replacing the sibling.

The `ul` above may be the component's returned root. The generated root range block forwards that
physical `ul` to the outer binding runtime, so stateful root attributes and styles still patch the
same element. A root containing only one eligible map or `List` is supported as a range with no
static segments. The compiler does not insert an extra parent merely to host the block.

The first range-owned contract is deliberately non-interactive. Every meaningful direct child of
the container must be either a lowercase host element or an eligible keyed map/`List`; every range
must return a statically known host tree without events or row-local conditional slots. Fragments,
components between ranges, interactive or controlled rows, and nested dynamic structures use the
existing React-owned boundaries. Parent prop or compatible Fast Refresh changes remount this one
range container through React so static markup cannot become stale. Duplicate keys or a
mount/hydration shape that cannot be adopted also switch the complete container to React before
later updates.

The optimized host-row contract is deliberately narrow:

- The map must use one synchronous inline callback returning one React element and an explicit
  item-derived `key`. Its collection may be direct or use the supported non-mutating pipeline.
- An array-index key is rejected for compiler isolation because it does not preserve item identity
  across insertion, removal, or reordering.
- The optimized `List` shape uses inline `by` and child functions, a compiler-safe `each`
  expression, and an item-derived key.
- A single interactive list must be the only meaningful child of its nested lowercase host
  container. Non-interactive host rows may instead occupy one or more ranges separated by direct
  host siblings, either in a nested container or the component's returned host root.
- The row is a statically known HTML host tree. Dynamic leaf text, attributes, controlled host
  properties, and individual inline style properties are supported.
- A dedicated non-interactive map/`List` may contain multiple logical or ternary host branches,
  including recursively nested branches and branches beside static host siblings. The compiler
  mounts, replaces, or removes only those host blocks within each keyed row instance.
- A dedicated non-interactive row may recursively contain keyed map/`List` ranges in known host
  containers. Each stable parent key receives an isolated child key table and LIS pass.
- Inline synchronous row events use the hybrid React-owned row path. Branch or inner-row events,
  non-inline or async handlers, file inputs, dynamic form control types or options, custom
  components, fragments, refs, SVG, attribute spreads, dangerous HTML, and dynamic text mixed
  beside nested elements stay React-owned.
- Unsupported or mutating collection methods, spread children, Hooks in callbacks, and other
  unproven shapes fall back to normal React.

Stable keys must be unique among siblings and come from the item's identity, such as a database ID.
If duplicate keys appear at runtime, Farm remounts that list container through its original React
render instead of guessing which row owns the identity. Later updates remain on the React fallback
for that mounted list. Interactive fallback handlers use ordinary per-render item/index closures,
not ambiguous keyed lookup. Unsupported source shapes also keep React ownership from the beginning.

For example, changing `[A, B, C, D]` to `[D, A, B, C]` keeps `[A, B, C]` as the LIS and moves only
`D`. Reversing four rows needs three moves because the LIS has length one. Insertions and removals
still do their necessary DOM work; LIS only minimizes moves among surviving keys.

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

Conditional, compiler-owned host-conditional, keyed-list, keyed-row, and component-island
boundaries are analyzed together. The compiler assigns every boundary a component-wide ID, so IDs
remain unique even when several block types share a container or are nested inside one conditional
branch. Nested bindings also record the ID of their nearest outer conditional.

When one update affects an outer conditional and one or more descendants, the runtime refreshes
the mounted outer boundary once and suppresses redundant descendant refreshes for that flush.
React then unmounts or replaces the branch normally. Inner boundaries unsubscribe during that
unmount, so later updates while the branch is hidden do not target stale components. If the branch
appears again, each boundary subscribes again and renders from the latest compiler-cell values.

Safe host-only conditions and keyed ranges inside a non-interactive keyed row receive globally
unique build-time block IDs, while the runtime creates a separate scope for each stable outer row
key. The outer keyed block drives those scopes, so a row can update a nested branch or inner list
without a component rerun or a separate global subscription for every row. Each inner list keeps
its own key table and LIS pass. The scope moves with the outer row and is cleaned when its key
disappears. Eligible inline events use the hybrid React-event path and retain React-owned row-local
conditional Fibers. Component islands, Hooks, custom components, interactive or otherwise
unsupported nested lists, and other unproven dynamic structure remain on the complete React-owned
row path; put Hooks inside a keyed row component.

### What falls back to React

| Unsupported shape                                                                                                                     | Why React keeps ownership                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unkeyed/index-keyed maps, unsupported or mutating collection pipelines, or element arrays                                             | Their structure, purity, or item identity is outside the keyed-list contract.      |
| Unsupported row events/forms, components, fragments, refs, SVG, interactive nested lists, or unsafe conditional branches              | Their event, lifecycle, or structure contract requires the React-owned row path.   |
| Interactive ranges beside siblings or non-host range siblings                                                                         | The range owner requires a host container and non-interactive host rows.           |
| Branch events, keys, components, fragments, refs, SVG, interactive rows, or unsupported nested blocks in a compiled conditional range | They require the React-owned conditional path rather than compiler-created hosts.  |
| Dynamic/member component types, component spreads, refs, keys, or children                                                            | Their identity or ownership is outside the first component-island contract.        |
| Effects or hooks other than the supported `useState` shape                                                                            | Their lifecycle and ordering must remain under React's hook dispatcher.            |
| `ref` or `dangerouslySetInnerHTML`                                                                                                    | They directly participate in DOM ownership.                                        |
| Stateful `children` or `key` bindings outside an eligible boundary                                                                    | These need structure or identity semantics.                                        |
| Conditional style objects, style spreads, methods, or computed names                                                                  | The final property set or precedence cannot be prepared statically.                |
| JSX attribute spreads or namespaced attributes                                                                                        | The compiler cannot currently enumerate a stable binding contract.                 |
| Multiple/conditional returns or impure/control-flow statements                                                                        | The compiler only lowers a single, statically analyzable render path.              |
| Derived calls, assignments, identity-bearing values, functions, or JSX                                                                | Their evaluation timing, side effects, or identity cannot yet be preserved safely. |
| Nested, computed, or rest props destructuring                                                                                         | These patterns need additional parameter-shape and identity analysis.              |
| Object, array, function, symbol, React-element, or `children` prop updates                                                            | Identity and child ownership stay on the full React render path.                   |
| Async/generator/generic handlers or named handlers outside JSX events                                                                 | Their scheduling, identity, or closure semantics are outside the current lowering. |
| Async/generator or generic components                                                                                                 | These function shapes are outside the current lowering.                            |
| Setters called outside JSX event handlers                                                                                             | The compiler only controls and batches event-driven local updates.                 |

Keys do not make list work disappear. A key identifies the row that survives an insert, removal,
or move. On the non-interactive compiler-owned host path, Farm compares those keys, reuses matching
row instances, and applies LIS to minimize moves. On the hybrid interactive path, React compares
the keyed elements for structural changes while Farm uses the same key to find the newest row data
for direct same-key bindings and event dispatch. On the fallback path, React owns the complete row
update. Calling a Hook directly inside a list iteration is invalid React because the number or
order of calls can change. Put the Hook inside a keyed child component instead; that custom row
intentionally uses the React-owned path.

### Build-time transformation

The React renderer installs `farm:react-aot-compiler` as a pre-transform. The current implementation
is a Babel AST transform, not a Rust compiler pass. It parses application TSX/JSX before ordinary
JSX lowering, discovers candidate components, validates the full supported contract, and emits
source maps with the transformed module.

For each eligible component, the transform conceptually emits a definition like this:

```ts
createCompiledComponentWithFeatures(
  {
    initialize: (props) => [props.initial],
    readProps: (props) => [props.label],
    render: (_props, state) => <button>{state[1].get()}: {state[0].get()}</button>,
    bindings: [
      {
        kind: "text",
        path: [],
        target: 0,
        dependencies: [0, 1],
        read: (_props, state) => [state[1].get(), ": ", state[0].get()],
      },
    ],
  },
  [],
);
```

The empty capability array means this component needs only direct bindings. A component with a
conditional, keyed list, keyed row, range, or component island receives the matching statically
imported feature. Plain keyed rows select a smaller implementation than rows with React-owned
conditional slots or recursively compiler-owned host blocks. The selection uses ordinary build-time
imports rather than loading code after an interaction, so SSR and hydration remain synchronous.

The actual output imports `createCompiledComponentWithFeatures` and only its required feature
exports from `@farm.js/react/compiler-runtime` in modules where at least one component compiled.
Unused feature exports are tree-shaken from the production browser bundle. Unsupported modules keep
their original source and do not receive the runtime import. Runtime features are also part of the
Fast Refresh compatibility signature; changing a component into a new structural kind cannot reuse
an instance that lacks the new runtime.

### Runtime behavior

The generated runtime wrapper is still a React component. Its responsibilities are split as
follows:

| React owns                                                | Compiler runtime owns                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Initial element creation, SSR markup, and hydration       | Local compiler-cell values                                                   |
| JSX event registration and dispatch, including row events | Queuing local setter calls into one microtask                                |
| Parent update scheduling and commit                       | Primitive prop cells and their dependency-indexed patches                    |
| Identity-bearing and unsupported prop reconciliation      | Reusing the mounted render plan for compiler-safe primitive prop updates     |
| Unsupported trees, hooks, refs, handlers, and lifecycles  | Patching stable ref-owned text, attribute, and style targets                 |
| Complex conditional branches, events, and nested blocks   | Host-only conditional identity, range placement, bindings, and replacement   |
| Interactive or conditional-row structure and reorders     | Same-key row bindings, latest-item events, and changed conditional snapshots |
| React-owned custom or structurally complex keyed rows     | Non-interactive host-row identity, bindings, insertion, removal, and LIS     |
| Component render, Hooks, context, and lifecycle           | Refreshing only a dependent React component-island boundary                  |
| Unmounting and the surrounding component tree             | Committing prop and local cells together after a parent-driven update        |

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
markup normally; direct binding updates begin after the component mounts. Eligible conditional and
keyed-row containers validate and adopt their already-hydrated child elements, so valid server DOM
is not replaced during hydration. Interactive rows keep their React event props throughout this
process. A hydration mismatch stays on React's recoverable-error path; Farm adopts only the host
shape React committed.

During development, compiled components receive a module-and-component identity plus a state-layout
signature. A compatible Fast Refresh replaces the compiled definition while retaining the React
component type and its local cells. An interactive keyed boundary lets React commit the refreshed
event layout before Farm re-adopts it, and keyed proxies read the current definition, so a refreshed
handler cannot keep executing its older closure. If the compiler-owned state layout changes, the
identity is not reused and React remounts it instead of preserving incompatible state.

If a direct binding evaluation throws, the runtime schedules a React update and rethrows from the
component render. This lets the nearest React error boundary handle the failure through React's
normal recovery path.

### Safety reasoning

The compiler uses fallback as a semantic boundary, not as an error-recovery trick. Generated
callback refs keep direct DOM targets stable even when a React component island returns `null`, a
fragment, or multiple nodes. React-owned conditional, keyed-list, and component boundaries give
complex dynamic structure back to React. Compiler-owned branches and non-interactive rows are
limited to complete host-only containers because manually inserted DOM has no React Fiber for
events, components, or Hooks. Interactive rows and other rows that require local conditional
Fibers therefore never use the manual insertion/removal/LIS path: React reconciles their structure,
and Farm only adopts committed host elements for binding patches and row-local snapshot refreshes.
Proven non-interactive host conditions are part of the keyed descriptor instead, so their scopes
can move safely with the existing LIS path.
Unsupported dynamic component types, refs, effects, and other unproven shapes keep React ownership;
fallback is the optimization's correctness mechanism.

Parent-driven updates remain React updates, but not every update needs a new compiled element tree.
For compiler-emitted flat primitive prop cells, render-phase reads use a pending snapshot without
mutating committed cells. React can abandon that render safely. After a successful commit, the
runtime publishes the cells and refreshes their indexed bindings and blocks. Identity-bearing
values skip this reuse path and receive normal React reconciliation. This split keeps prop changes
and local state coherent without moving an imperative DOM write into React's abortable render
phase.

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
- flat primitive prop transitions patch direct bindings and host conditionals without rebuilding
  the compiled render plan, preserve focused selection and DOM identity, and match React across
  deterministic string, number, boolean, and nullish transitions;
- object and function prop identities retain the full React render path, while SSR hydration and
  Strict Mode preserve the primitive prop optimization afterward;
- nested fallback blocks read one coherent render snapshot, and an abandoned concurrent render
  cannot publish prop cells or replace the last committed compiled element;
- compatible Fast Refresh preserves state, while binding errors reach React error boundaries;
- hydration mismatches follow React's recoverable-error path and remain interactive;
- compiler-owned conditionals preserve a same-branch DOM instance, patch nested text, attributes,
  styles, and focused input selection, replace only a changed branch, and fall back for numeric
  logical output or any unproven structure;
- 3,000 deterministic compiler-owned conditional transitions produce the same host output as
  normal React while the compiled owner stays at one execution;
- conditional DOM ranges preserve an exact component root and every static sibling, mount adjacent
  empty slots in source order without marker nodes, and commit simultaneous range changes from one
  state snapshot;
- stateful static siblings patch text, classes, attributes, and individual styles through stable
  segment/sibling/path addresses while conditional mounts and keyed LIS moves change nearby child
  indexes; their DOM identity survives every update;
- 3,000 deterministic nested-range updates and 3,000 component-root-range updates match normal
  React while unchanged branches, static siblings, and the compiled owner keep their identity;
- recursive host scopes preserve an outer branch and static siblings while independently updating
  nested conditions, deeper conditions, and LIS-keyed ranges;
- 3,000 deterministic recursive updates match normal React across outer toggles, nested branch
  changes, inserts, removals, binding edits, reversals, and rotations without rerunning the owner;
- recursive scopes clean queued work on unmount and outer removal, rebind on combined parent-prop
  and local updates, adopt exact SSR output, recover after hydration mismatches, and keep React
  fallback live after duplicate runtime keys, while nested binding failures reach React error
  boundaries;
- object, array, and nullish state transitions match normal React across 3,000 deterministic
  randomized updates;
- automatic keyed maps and explicit `List` boundaries preserve keyed DOM nodes and stateful row
  identity across inserts, removals, updates, and reorders without rerunning the outer component;
- compiler-owned host rows patch text, attributes, and styles in place, preserve focus and text
  selection, use the LIS minimum for measured rotations and reversals, and remount through React
  when runtime keys are duplicated;
- mutation-aware keyed `map()` updates patch only compiler-reported same-key row indexes, compose
  queued hints across multiple keyed boundaries, ignore unrelated state in the same flush, and
  reject key changes or mixed unhinted collection updates into the complete reconciliation path;
- compiler-proven immutable Set/Map updaters carry exact native mutation keys across queued
  updates, compact long persistent snapshot chains, and fall back before binding reads for unsafe
  keys, values, collections, or ownership;
- 2,000 deterministic hinted Set mutations and 2,000 deterministic hinted Map mutations match
  normal React while evaluating only changed present-row keys;
- a 2,048-row instrumentation test changes one item with one key read and one binding read, while
  2,000 deterministic queued updates match normal React with one compiled owner execution;
- keyed DOM ranges preserve static siblings around multiple lists, support adjacent empty ranges
  and exact component roots, apply LIS independently per range, and remount the complete container
  through React when keys or parent-driven static markup invalidate adoption;
- interactive host rows keep React event propagation and `currentTarget`, resolve the latest item
  and index after same-key replacements and reorders, let React own structural commits, and resume
  direct binding patches without stale virtual-prop output;
- editable keyed rows preserve input and row identity, focused selection, IME ordering, checkbox,
  radio, textarea, and select state while direct same-key edits add no owner or map executions;
- interactive rows stay coherent across combined parent/local updates, Strict Mode, compatible Fast
  Refresh, recoverable hydration mismatches, and an unmount before the compiler microtask flush;
- row-local host conditionals refresh only changed keyed slots, remain coherent with inline events
  and parent updates, preserve row identity through React reorders, switch duplicate keys to React,
  route failures through error boundaries, and clean subscriptions on unmount;
- non-interactive keyed rows own multiple and recursively nested host conditionals, patch a
  surviving branch without a React commit, combine condition changes with LIS reorders, preserve
  row, branch, and static-sibling identity, and clean every nested scope when a row disappears;
- 2,000 deterministic compiler-owned row/branch/order transitions match normal React while the
  compiled owner remains at one execution, with additional Strict Mode, parent/local, error-boundary,
  duplicate-key, queued-unmount, SSR, and recoverable-hydration coverage;
- nested keyed rows apply independent outer and inner LIS passes while preserving project, task,
  and static-sibling DOM identity, including simultaneous updates at both levels;
- 2,500 deterministic two-level reorder, insert, remove, binding, and boolean transitions match
  normal React while the compiled owner remains at one execution, with additional Strict Mode,
  parent/local, duplicate-inner-key, Fast Refresh, queued-unmount, SSR, and hydration coverage;
- recursive keyed scopes apply independent LIS passes at board, column, and card depth while
  preserving every surviving row and static sibling;
- 3,000 deterministic three-level reorder, insert, remove, binding, and boolean transitions match
  normal React while the compiled owner remains at one execution, with additional Strict Mode,
  parent/local, deepest-duplicate-key, error-boundary, Fast Refresh, queued-unmount, SSR, and
  hydration coverage;
- mixed conditional/keyed containers match normal React across 3,000 deterministic branch, reorder,
  insertion, removal, binding, and recursively nested list transitions, with additional Strict Mode,
  simultaneous parent/local, duplicate-key fallback, error-boundary, queued-unmount, SSR, and
  recoverable-hydration coverage;
- component islands update only dependent children, preserve child-local state and context, route
  failures through React error boundaries, hydrate in Strict Mode, and safely drop queued updates
  after unmount;
- stable ref targets remain correct when an earlier island switches among `null`, one node, and a
  multi-node fragment;
- 1,000 deterministic object, array, and nullish component-prop transitions match normal React;
- 1,000 deterministic randomized compiler-owned list operations produce the same ordered output as
  normal React while the list owner stays at one execution;
- 2,000 deterministic updates each for nested and component-root keyed ranges match normal React
  while every static sibling and surviving row keeps its DOM identity and the owner stays at one
  execution;
- 5,000 deterministic filter, sort, slice, reverse, insertion, removal, and row-update transitions
  produce the same keyed output as normal React while preserving surviving DOM rows;
- 4,000 deterministic interactive data, structure, and event transitions match normal React while
  the compiled owner remains at one execution;
- 2,000 deterministic controlled-form and structural transitions match normal React across text,
  textarea, checkbox, radio, and select properties while the compiled owner stays at one execution;
- 2,000 deterministic row-conditional data and structural transitions match normal React while the
  compiled owner remains at one execution;
- 2,000 deterministic keyed-array appends match normal React; targeted tests require key,
  descriptor, and binding reads to equal only the appended suffix and cover queued updates,
  multi-boundary sharing, StrictMode hydration/unmount, and conservative fallback;
- 2,000 deterministic keyed-array prepends match normal React; targeted tests require key,
  descriptor, and binding reads to equal only the inserted prefix, preserve every existing DOM
  row, update delegated event indexes, and cover queued updates, StrictMode hydration, unmount,
  invalid metadata, custom arrays, and conservative fallback;
- 2,000 deterministic queued keyed-array slices match normal React; targeted tests require zero
  surviving key, descriptor, and binding reads, preserve focused controlled-input identity and
  selection, update delegated event indexes, and cover native bounds, queued slice/filter chains,
  Strict Mode hydration, unmount cleanup, custom methods, proxies, and conservative fallback;
- 250 committed keyed rolling-window updates match normal React; targeted tests require work to
  equal only the incoming suffix, preserve retained DOM identity, and cover reused-key,
  custom-slice, and collection-dependent fallbacks;
- 2,000 deterministic randomized keyed-array removals match normal React; targeted tests require
  zero surviving descriptor and binding reads, preserve DOM identity, and cover queued filters,
  unhinted-chain fallback, collection-reading rows, StrictMode hydration, and unmount cleanup;
- 1,000 deterministic exact-position insertions, single and contiguous-range removals, single-row
  replacements, and exact-window replacements match normal React; compiler tests cover literal counts and guarded runtime
  positions, while targeted removal tests require zero surviving key, descriptor, or binding reads,
  preserve focused input and surrounding DOM identity, and cover native evaluation and coercion,
  clamping, unsafe runtime positions and counts, custom methods, queued updates,
  collection-reading rows, StrictMode hydration, and cleanup; targeted window tests additionally
  require fresh-key work to equal only the incoming window and a 4,096-row same-key refresh to
  perform zero descriptor creation while preserving all 64 refreshed DOM rows; a 4,096-row mixed
  window reuses and reorders 48 keyed rows, creates only 16 descriptors, evaluates only the 64
  local keys and bindings, and performs the exact 47 local LIS moves plus one fresh-row fragment;
  a separate 4,096-row sequence grows a 64-row interval to 80 rows and then shrinks it to 40 while
  preserving both surrounding anchors, reusing every retained row, creating only fresh rows, and
  performing the exact local LIS moves; another 1,000 randomized variable-length mixed-window
  updates match normal React; 1,000 queued disjoint grow/shrink updates also match React while
  targeted tests cover both source orders, adjacent and empty windows, atomic preparation across
  every window, exact local LIS moves, current delegated event indexes, focus, selection,
  hydration, Strict Mode, cleanup, and overlapping structural or cross-window key-move fallback;
  tests also cover duplicate and outside-window key fallback; another
  1,000 deterministic queued same-key window refreshes match normal React while disjoint and
  overlapping targeted tests preserve row identity and perform no descriptor work; 1,000 queued
  mixed fresh-key and same-key replacements also match React while targeted tests require only the
  64 incoming descriptors, preserve every untouched row, and prepare all new rows before mutation;
  another 1,000 queued overlapping fresh-key replacements match React while targeted tests require
  work to equal only the final touched union, preserve untouched DOM identity, and cover atomic
  preparation, existing-key-move fallback, Strict Mode hydration, and unmount cleanup;
- 2,000 deterministic randomized reversals match normal React; a 4,096-row targeted test requires
  exactly `n - 1` connected DOM moves and zero key, descriptor, or binding reads, while fallback
  tests cover custom methods, queued updates, collection-reading rows, StrictMode hydration, and
  unmount cleanup;
- 2,000 deterministic randomized sorts match normal React; a 4,096-row targeted test requires
  exactly `n - LIS` connected DOM moves and zero key, descriptor, or binding reads, while native
  semantics, focus and selection, fallback cases, StrictMode hydration, and cleanup are covered;
- the production browser experiment derives a keyed window from 2,048 source rows without
  rerunning the owner component or corrupting the existing compiler experiments;
- the package reactivity benchmark updates one prop across 2,048 bindings, requires identical
  first/last DOM output, and verifies one compiled render plan against 251 control render plans;
- production-size fixtures verify that direct components omit every structural runtime, plain keyed
  rows omit conditional-row support, and the core-only gzip premium remains at least 50% below the
  complete compatibility runtime; the checked result is persisted in
  `packages/farm-react/RUNTIME_SIZE_RESULTS.json`;
- the production browser experiment also replaces and reorders interactive items, verifies current
  keyed DOM identity and capture/stop-propagation behavior, and observes zero owner update
  executions;
- the production browser experiment rotates 1,000 compiler-owned host rows with one LIS move,
  updates outer and nested row conditions, preserves surviving row and branch identity, removes and
  inserts a row, and observes zero owner update executions;
- the production 10,000/20,000-row benchmark requires nonzero `keyedIdentityTargets`,
  `keyedMapLookupTargets`, `keyedMembershipTargets`, `keyedCollectionUpdateHints`, and
  `keyedMapUpdateHints`, `keyedArrayAppendHints`, `keyedArrayPrependHints`,
  `keyedArrayFilterHints`, `keyedArrayPositionHints`, `keyedArrayReorderHints`,
  `keyedArraySortHints`,
  `keyedArrayRollingWindowHints`, and `keyedArraySliceHints` report counts,
  preserves the keyed-update speedup floor, checks that scalar selection, Set membership, and Map
  lookups remain key-directed at scale, compares dense hinted Set/Map updates with equivalent
  compiled snapshot controls, requires separate single-row and contiguous-range removal speedup
  floors, requires a mixed local-window reuse/reorder gate to remain at least 4× faster than React
  and 1.5× faster than its compiled snapshot control, and passes DOM correctness, React-relative
  regression, direct-delta, and normalized scalability gates;
- the public `List` renders iterable and nullish collections correctly with the compiler off;
- the packaged runtime, including a keyed-range component root, editable and interactive keyed-row
  events, row-local conditions, reorders, identity, selection, and hydration, is exercised
  separately with React 18.3 and React 19;
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
primitive-prop, automatic and explicit keyed-list, component-island, compiler-on/off, and
heavy-interaction experiments. The standalone starter intentionally keeps the first experience
focused.

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
