# FARMJS React Compiler Starter

A focused starter for FARMJS's experimental React AOT compiler. It uses the same minimal dark shell
as the other Create FARMJS App starters and includes one live comparison: an eligible local state
update beside ordinary React reconciliation.

> The compiler is experimental and opt-in. Unsupported component shapes stay on React, so the
> optimization is never required for correctness.

## Create this starter

```bash
pnpm create @farm.js/app my-compiler-app --template react-compiler
cd my-compiler-app
pnpm dev
```

You can also clone the standalone
[farmjs-react-compiler-starter](https://github.com/farming-labs/farmjs-react-compiler-starter).

## Compiler configuration

The starter enables the compiler through the React renderer:

```ts
renderer: react({
  compiler: true,
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

Set `FARM_REACT_COMPILER=false` when running `pnpm experiment` to verify the ordinary React path
too. `FARM_EXPERIMENT_BROWSER_PATH` can point to an existing Chrome/Chromium executable instead of
Playwright's downloaded browser. `FARM_EXPERIMENT_SCREENSHOT` overrides the screenshot location.

For batching, multiple bindings, safe keyed-list fallback, and the full compiler-on/off benchmark,
see the maintained
[React Compiler example](https://github.com/farming-labs/farm.js/tree/main/examples/react-compiler).

Read the [React compiler guide](https://farmjs.dev/docs/renderers/react#aot-compiler)
for the supported component contract and rollout guidance.
