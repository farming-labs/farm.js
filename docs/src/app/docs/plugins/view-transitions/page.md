---
title: "View Transitions"
description: "Animate client navigations with the View Transitions API: start on navigation.before, complete on navigation.resolved, with per-route opt-out."
section: "Plugin Ecosystem"
---

# View Transitions

`@farm.js/view-transitions` animates client navigations with the browser's View Transitions
API. It starts a transition on `navigation.before`, while the old page is still on screen, and
completes it on `navigation.resolved`, once the new page is in place. The browser captures both
snapshots and animates between them.

## Install

```bash
pnpm add @farm.js/view-transitions
```

## Complete example

Register the plugin once in Farm config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { viewTransitions } from "@farm.js/view-transitions";

export default defineConfig({
  plugins: [viewTransitions()],
});
```

That is the whole setup. Style the animation with the platform's pseudo-elements:

```css
::view-transition-old(root) {
  animation: 120ms ease-out fade-out;
}

::view-transition-new(root) {
  animation: 180ms ease-in fade-in;
}
```

## Options

| Option    | Default | Description                                                                                                                                                           |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exclude` | `[]`    | Route patterns that never animate, matched against the destination pathname. Segments are literals, `:param` (one segment), or a trailing `*` (the rest of the path). |

```ts
viewTransitions({ exclude: ["/checkout", "/admin/:section", "/print/*"] });
```

## Behavior

- The transition's update callback stays pending between `navigation.before` and
  `navigation.resolved`, so the new snapshot is the page the router actually rendered.
  Streamed and islands navigations settle on the same `resolved` signal, so their content is
  what gets captured.
- Browsers without `document.startViewTransition` navigate exactly as before; the plugin is a
  progressive enhancement and never gates a navigation on the API.
- `prefers-reduced-motion` disables the animation. The navigation still happens.
- A navigation that starts while a transition is still pending releases the pending update
  callback — the browser skips the superseded transition — so a callback can never hang.
- Configure view transitions in one `viewTransitions()` instance per app.

## Limits

- The plugin ships no CSS. Without your own `::view-transition` rules, the browser's default
  cross-fade applies.
- Only client navigations animate. The first page load and full document reloads do not run
  the client plugin hooks, so they are never wrapped.
