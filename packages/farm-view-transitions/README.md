# `@farm.js/view-transitions`

**Animate client navigations with the View Transitions API.**

The plugin starts a view transition on `navigation.before`, while the old page is still on
screen, and completes it on `navigation.resolved`, once the new page is in place. The browser
captures both snapshots and animates between them with the default cross-fade, or with any
`::view-transition` CSS you define.

## Install

```bash
pnpm add @farm.js/view-transitions
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { viewTransitions } from "@farm.js/view-transitions";

export default defineConfig({
  plugins: [viewTransitions()],
});
```

## Options

| Option    | Default | Notes                                                                                                                                         |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `exclude` | `[]`    | Route patterns that never animate, matched against the destination pathname: literals, `:param` for one segment, a trailing `*` for the rest. |

## Behavior

- Every client navigation is wrapped: the transition's update callback stays pending between
  `navigation.before` and `navigation.resolved`, so the new snapshot is the page the router
  actually rendered — streamed and islands navigations included, because the update completes
  on the same `resolved` signal they settle on.
- Browsers without `document.startViewTransition` navigate exactly as before. The plugin is a
  progressive enhancement and never gates a navigation on the API.
- `prefers-reduced-motion` disables the animation; the navigation still happens.
- A route listed in `exclude` opts out per route, e.g. `viewTransitions({ exclude: ["/checkout", "/print/*"] })`.
- A navigation that starts while a transition is still pending releases the pending update
  callback — the browser skips the superseded transition — so a callback can never hang.
- Skipped transitions reject their promises; the runtime handles every rejection, and every
  browser call is wrapped, so a transition can never break a navigation.

## What it does not do

- It ships no CSS. The browser's default cross-fade applies unless the app defines
  `::view-transition-old` / `::view-transition-new` animations or `view-transition-name`
  values of its own.
- It does not animate the first page load or full document reloads — only client navigations
  that run the client plugin hooks.
