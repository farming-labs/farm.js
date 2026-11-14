# `@farm.js/scroll-restoration`

Per-route scroll restoration for Farm.js, as a client plugin.

Core already saves a scroll position per path and restores it on
back/forward — but it restores synchronously, right after the new page data
arrives and before the route has rendered, so the scroll is often clamped
to the not-yet-rendered document and the visit lands at the top. This
plugin re-does the restore at the moment the layout is final: it saves the
window position on `navigation.before` and restores it on
`navigation.rendered`, for back/forward (`pop`) navigations only. New
pushes keep the top, as core already scrolls them there.

Positions are keyed by route pattern + params when the navigation session
carries a route (`/posts/[id]#{"id":"7"}`), and by pathname otherwise, and
live in `sessionStorage` for the tab's lifetime. Every storage access is
try/catch-wrapped: a hostile storage never breaks a navigation.

## Install

```bash
pnpm add @farm.js/scroll-restoration
```

```ts
// farm.config.ts
import { scrollRestoration } from "@farm.js/scroll-restoration";

export default {
  plugins: [scrollRestoration()],
};
```

## Options

| Option             | Default                 | Notes                                                                                                             |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `storageKeyPrefix` | `"farm-scroll-restore"` | Prefix for the `sessionStorage` keys. Change it only to avoid a collision with another entry in the same storage. |

## Opting a navigation out

A link opts its navigation out with `data-farm-scroll-restore="off"` —
the runtime skips both the save and the restore for the navigation that
click starts:

```html
<a href="/posts/7" data-farm-scroll-restore="off">Read without restoring</a>
```

## What it does (and does not) do

- Restores the **window** scroll position only. Registered scroll elements
  (the `useScrollRestoration` hook) stay with core.
- A fragment in the destination URL is an explicit scroll target: core
  scrolls to it, and this plugin does not restore over it.
- The router does not populate `session.route` today, so keys fall back to
  the pathname in practice; the pattern + params branch activates when the
  session carries a route.
- This plugin keeps its own `sessionStorage` namespace
  (`farm-scroll-restore:*`) and never reads or overwrites core's
  `farm-scroll-*` entries. Core's early restore still runs first on a pop;
  this plugin's restore after `navigation.rendered` is the one that sticks.
