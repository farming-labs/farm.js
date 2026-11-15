---
title: "Scroll Restoration"
description: "Restore the window scroll position on Back and Forward once the page has rendered, including in Server Components mode."
section: "Plugin Ecosystem"
---

# Scroll Restoration

`@farm.js/scroll-restoration` restores the window scroll position on Back and Forward after the
page has rendered. Core already restores window scroll for its HTML and SPA routers as soon as the
new page is in the DOM (see [Scroll restoration](/docs/routing#scroll-restoration)). The plugin
restores again on `navigation.rendered`, so content that settles after core's restore still lands
where you left it. It also covers Server Components mode, where core has no scroll restoration of
its own.

## Install

```bash
pnpm add @farm.js/scroll-restoration
```

## Complete example

Register the plugin once in Farm config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { scrollRestoration } from "@farm.js/scroll-restoration";

export default defineConfig({
  plugins: [scrollRestoration()],
});
```

That is the whole setup.

## Options

| Option             | Default                 | Description                                                                                                       |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `storageKeyPrefix` | `"farm-scroll-restore"` | Prefix for the `sessionStorage` keys. Change it only to avoid a collision with another entry in the same storage. |

## Behavior

- Every client navigation saves the position of the page being left. Back and Forward restore the
  saved position of the page being entered. Pushes and replaces keep core's scroll-to-top.
- Positions are saved per history entry, the way the browser and React Router keep them. The
  plugin adds an id to each entry's `history.state` (`__farmScrollEntry`), so the same URL visited
  twice keeps two positions. They live in `sessionStorage`, one small entry per history entry, for
  the tab's lifetime.
- A destination with a hash is left to core, which scrolls to the fragment.
- A disabled or full storage never breaks a navigation.
- Configure scroll restoration in one `scrollRestoration()` instance per app.

## Limits

- The plugin restores the window only. Register nested scroll containers with core's
  `useScrollRestoration` hook.
- It does not change pushes. To keep the current scroll on a link click, use
  `<Link scroll={false}>`.
- Core's own restore is still keyed by URL. When the same URL is in history twice, core can land
  on the other entry's position first, and the plugin moves to the right one two frames later.
