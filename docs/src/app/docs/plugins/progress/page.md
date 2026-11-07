---
title: "Progress"
description: "Show a top progress bar while a client navigation is in flight, complete it when the page renders, and flash it on failure."
section: "Plugin Ecosystem"
---

# Progress

`@farm.js/progress` shows a thin bar at the top of the page while a client navigation is
in flight. Client navigations otherwise give no visual feedback: the page stays put until
the new one renders. The bar is DOM-only and renderer-neutral, so it works the same for
React, Preact, Solid, Vue, and Svelte apps.

## Install

```bash
pnpm add @farm.js/progress
```

## Complete example

Register the plugin once in Farm config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { progress } from "@farm.js/progress";

export default defineConfig({
  plugins: [progress()],
});
```

That is the whole setup. The bar appears when a client navigation starts, trickles
forward while the new page loads, and completes when the page renders.

## Options

```ts
progress({
  delayMs: 150,
  color: "var(--accent)",
  height: 3,
});
```

| Option    | Default     | Description                                                             |
| --------- | ----------- | ----------------------------------------------------------------------- |
| `delayMs` | `150`       | Wait this long before showing the bar, so fast navigations never flash. |
| `color`   | `"#2563eb"` | Any CSS color for the bar, including a `var(--...)` token.              |
| `height`  | `3`         | Bar height in pixels.                                                   |

## Behavior

- The bar only covers client navigations. The initial page load keeps its own loading
  behavior; the plugin does not touch it.
- A navigation that renders before `delayMs` never shows the bar at all.
- A navigation that fails flashes the bar red and then hides it.
- A second navigation started while the first is still in flight keeps the bar up and
  restarts it from the beginning.
- The bar is removed when the page closes or the plugin is replaced during development.
  Configure navigation progress in one `progress()` instance per app.
