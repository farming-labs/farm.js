# FARMJS React Compiler Starter

A focused experimental starter for FARMJS's React AOT compiler. It uses the same minimal dark shell
as the other Create FARMJS App starters and includes one live comparison: an eligible local state
update beside ordinary React reconciliation.

> The compiler is experimental. Unsupported component shapes stay on React, so the optimization is
> never required for correctness.

## Create this starter

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-compiler-app --template react-compiler
cd my-compiler-app
pnpm dev
```

You can also clone the standalone
[farmjs-react-compiler-starter](https://github.com/farming-labs/farmjs-react-compiler-starter).

## Compiler configuration

The starter enables the compiler through the React renderer:

```ts
renderer: react({
  experimental: {
    compiler: true,
  },
}),
```

The included environment switch defaults to enabled and makes comparison builds easy:

```bash
FARM_REACT_COMPILER=true pnpm build
FARM_REACT_COMPILER=false pnpm build
```

The status shown on the starter page reflects the resolved value used for that build.

Components are considered automatically. Add `"use no compiler"` to a component when you need an
explicit React-only path.

## Verify the compiled path

```bash
pnpm install
pnpm exec playwright install chromium
pnpm experiment
```

The command builds the app, opens the production output in Chromium, checks both counters, verifies
that the compiled update does not execute the component again, and saves a screenshot to
`/tmp/farm-react-compiler-starter.png`.

For batching, multiple bindings, safe keyed-list fallback, and the full compiler-on/off benchmark,
see the maintained
[React Compiler example](https://github.com/farming-labs/farm.js/tree/main/examples/react-compiler).

Read the [React compiler guide](https://farm.js.dev/docs/renderers/react#experimental-aot-compiler)
for the supported component contract and rollout guidance.
