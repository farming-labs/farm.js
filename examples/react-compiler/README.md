# FARMJS React AOT compiler example

This example runs two equivalent React counters side by side:

- **AOT compiled** is selected automatically by `compiler: true`. Its local `useState` update patches
  precomputed text and class bindings without running the component body again.
- **Base React** contains `"use no compiler"`, so the same update follows React's normal render,
  reconciliation, and commit path.

Run it from the repository root:

```bash
pnpm --filter @farm.js/react build
pnpm --filter farm-react-compiler-example dev
```

Click each card's button. Both state values and status classes update, but the compiled card's
**Component executions** value stays unchanged. The base React value increases once per click.

## Reproducible result

The package runtime test performs one equivalent update under a React `Profiler`:

| Path       | Component renders | React commits | DOM result            |
| ---------- | ----------------: | ------------: | --------------------- |
| FARMJS AOT |                 1 |             1 | Text and class update |
| Base React |                 2 |             2 | Text and class update |

For this eligible local-state update, the compiler removes one post-mount component render and one
React commit—**100% of the React render/commit work caused by the update**. This is a structural
result, not a claim that every application is twice as fast. A broad timing claim needs larger
applications, list-heavy cases, effects, production browser traces, and multiple devices; those are
outside the compiler's first supported group.

The initial group intentionally falls back to React for unsupported shapes, including keyed lists,
conditional child structure, effects, refs, and custom child components.
