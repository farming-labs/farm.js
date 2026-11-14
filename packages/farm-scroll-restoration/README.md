# `@farm.js/scroll-restoration`

**Restore the window scroll position on Back/Forward once the page has rendered.**

Core already saves and restores window scroll for its HTML and SPA routers. It restores as soon
as the new page is in the DOM. This plugin restores again on `navigation.rendered`, two frames
after the page renders, so content that settles after core's restore still lands where you left
it. It also covers Server Components mode, where core has no scroll restoration of its own.

## Install

```bash
pnpm add @farm.js/scroll-restoration
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { scrollRestoration } from "@farm.js/scroll-restoration";

export default defineConfig({
  plugins: [scrollRestoration()],
});
```

## Options

| Option             | Default                 | Notes                                                                                                             |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `storageKeyPrefix` | `"farm-scroll-restore"` | Prefix for the `sessionStorage` keys. Change it only to avoid a collision with another entry in the same storage. |

## Behavior

- On every client navigation, the position of the page being left is saved. On Back/Forward
  (`pop`), the saved position of the page being entered is restored. Pushes and replaces keep
  core's scroll-to-top.
- Positions are keyed by pathname plus query string, like core's: `/search?q=a` and
  `/search?q=b` keep their own positions. They live in `sessionStorage` for the tab's
  lifetime.
- A destination with a hash is left to core, which scrolls to the fragment.
- Every storage and scroll call is wrapped, so a disabled or full storage never breaks a
  navigation.

## What it does not do

- It restores the **window** only. Nested scroll containers stay with core's
  `useScrollRestoration` hook.
- It does not change pushes. To keep the current scroll on a link click, use
  `<Link scroll={false}>`.
- It never reads or writes core's `farm-scroll-*` entries.
