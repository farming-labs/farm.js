# @farm.js/hints

Catch accessibility, performance, HTML, and third-party script problems while developing a Farm
application. Findings appear in a route-aware browser overlay and can also be sent to the console.

## Install

```bash
pnpm add -D @farm.js/hints
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { hints } from "@farm.js/hints";

export default defineConfig({
  plugins: [hints()],
});
```

With no options, Hints runs WCAG AA checks through axe-core, watches Core Web Vitals and Farm
hydration/navigation timings, catches common live-DOM mistakes, and inventories third-party
scripts. It rescans after client navigation and meaningful DOM changes.

The plugin removes itself from Farm's production configuration. Its scanners, overlay, and font are
not included in production output.

## Options

```ts
hints({
  accessibility: {
    level: "AA",
    impact: "moderate",
    exclude: ["[data-visual-test]"],
  },
  performance: {
    lcp: 2_500,
    cls: 0.1,
    inp: 200,
    hydration: 500,
    navigation: 1_000,
  },
  html: true,
  thirdParty: {
    slow: 1_000,
    allow: ["trusted.example"],
  },
  report: "both",
  overlay: {
    position: "bottom-right",
    open: "issues",
  },
  maxIssues: 50,
});
```

Each check accepts `false` when it is not useful for the current application. `report` accepts
`"overlay"`, `"console"`, or `"both"`. The `issues` open mode stays collapsed on clean routes and
opens automatically when a scan finds something.
