---
title: "Hints Plugin"
description: "Find accessibility, performance, HTML, and third-party script problems while developing a Farm app."
---

# Hints Plugin

`@farm.js/hints` turns browser diagnostics into specific, route-aware fixes while you develop. It
checks the page after hydration, after Farm client navigation, and after meaningful DOM changes.
The result appears in a compact overlay beside the application instead of being buried across
different browser panels.

![Farm Hints showing performance, accessibility, and HTML findings on a development route](/hints-overlay.png)

## Install

```bash
pnpm add -D @farm.js/hints
```

## Start with every check

Add `hints()` to `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";
import { hints } from "@farm.js/hints";

export default defineConfig({
  plugins: [hints()],
});
```

This enables the useful defaults:

| Check            | What it reports                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Accessibility    | WCAG AA violations from `axe-core`, including the matching selector, markup, and remediation link.    |
| Performance      | LCP, CLS, INP, Farm hydration and navigation time, plus images that can cause layout shift.           |
| HTML             | Missing document language, duplicate IDs, missing doctype, and nested interactive controls.           |
| Third-party code | External scripts, parser-blocking scripts, and script resources that cross the configured slow limit. |

Select a finding to see its explanation and source snippet. When the finding has a selector, Hints
scrolls the matching element into view and outlines it briefly. Category filters keep a busy page
manageable. The overlay follows light and dark system color schemes and starts collapsed on clean
routes.

## Tune the checks

Every check accepts `false`, `true`, or focused options where thresholds are useful:

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
    allow: ["trusted.example", "https://static.example.com"],
  },
  maxIssues: 50,
});
```

Performance time values are milliseconds. CLS is a unitless score. The limits control when a
metric becomes a finding, while the current metric remains visible in the overlay. An allowed
third party can be written as an exact origin or a hostname.

Use axe rule overrides when a product has a deliberate exception:

```ts
hints({
  accessibility: {
    rules: {
      "color-contrast": { enabled: false },
    },
  },
});
```

Prefer a narrow selector exclusion or rule override over disabling accessibility checks for the
whole app.

## Overlay and console output

Send findings to the overlay, browser console, or both:

```ts
hints({
  report: "both",
  overlay: {
    position: "bottom-left",
    open: "issues",
  },
});
```

`open` accepts:

- `"issues"`, the default, opens once when the route has findings.
- `"always"` starts with the full panel visible.
- `"collapsed"` starts with the small launcher visible even when findings exist.

Use `report: "console"` for browser automation or a development environment where an overlay is
not wanted.

## Development and production boundary

Hints is a development diagnostic, not application runtime behavior. During a production build the
plugin removes itself from Farm's resolved configuration before client and server bundles are
generated. `axe-core`, Web Vitals, the overlay, and its Geist Mono font are therefore absent from
production output.

The scanner reads the live browser DOM. That makes it useful for UI produced after hydration and
client navigation, but it is not a replacement for a source-level HTML validator or full manual
accessibility testing. Some interaction states only exist after a user opens a menu, dialog, or
other conditional interface. Hints rescans those states when their DOM changes.

## Runnable example

The [hints demo](https://github.com/farming-labs/farm.js/tree/main/examples/hints-demo) intentionally
contains accessibility, HTML, and layout-risk problems so every part of the inspection flow can be
tested against real elements.
