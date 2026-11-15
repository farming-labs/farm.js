---
title: "Prefetch"
description: "Give plain anchors in HTML, Markdown and CMS content the same prefetch modes as core Link, through the router's own prefetch."
section: "Plugin Ecosystem"
---

# Prefetch

`@farm.js/prefetch` gives plain `<a>` links the same prefetching as core `Link`, app-wide. Links in
rendered HTML, Markdown and CMS content are plain anchors, so core never sees them. The plugin gives
them `Link`'s modes and sends every prefetch through the router: `router.prefetch` for intent and
render, `router.observeForPrefetch` for viewport.

It does not fetch, cache or queue anything itself. Dedupe, the
[route data cache](/docs/routing#route-data-cache), the viewport queue and islands-mode router
loading stay in core.

## Install

```bash
pnpm add @farm.js/prefetch
```

## Complete example

Register the plugin once in Farm config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { prefetch } from "@farm.js/prefetch";

export default defineConfig({
  plugins: [prefetch()],
});
```

That is the whole setup. A plain link is prefetched 50ms after it is hovered, focused or touched.
`Link` anchors are left to `Link`.

## Options

```ts
prefetch({
  mode: "viewport",
  intentDelayMs: 50,
  allow: ["/posts/[id]", "/docs/[[...slug]]"],
  deny: ["/admin/[...rest]"],
});
```

| Option          | Default    | Description                                                                                                                                             |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`          | `"intent"` | When plain links are prefetched: `"intent"` on hover, focus or touch, `"viewport"` when near the viewport, `"render"` once on the page, `"none"` never. |
| `intentDelayMs` | `50`       | Delay before an intent prefetch. The same default as `Link`'s `prefetchDelay`.                                                                          |
| `allow`         | `[]`       | Route patterns that may be prefetched, in Farm route syntax. Empty allows every path.                                                                   |
| `deny`          | `[]`       | Route patterns that are never prefetched. Checked first, so `deny` wins.                                                                                |

Patterns use core's route matcher, so `[id]` matches one segment, `[...rest]` one or more, and
`[[...slug]]` zero or more. Invalid options fail the build with every problem listed at once.

## Per link

A link picks its own mode with `data-farm-prefetch`, which takes the same values as `Link`'s
`prefetch` prop:

```html
<a href="/pricing" data-farm-prefetch="render">Pricing</a>
<a href="/export" data-farm-prefetch="none">Export</a>
```

An unknown value, such as `"off"` or a typo, never prefetches.

## Behavior

- Only links the router would navigate on click are prefetched. `Link` anchors, `download` links,
  links with a `target` other than `_self`, absolute URLs (core loads them as a new document),
  `#hash` links and links to the current page and query are skipped.
- Intent uses one delegated listener per event on the document, so links added later need no
  setup. Moving the pointer inside a link keeps the pending prefetch; leaving it cancels.
- Viewport and render links are found on start and as they are added. A removed viewport link is
  handed back to the router with `unobserveForPrefetch`.
- A prefetch that fails is ignored, like `Link`'s: the click fetches the page.
- When the plugin closes, it removes its listeners, cancels a pending intent and hands back every
  observed link.

## Limits

- Server Components mode (`experimental.serverComponents: "rsc"`) has no router prefetch, so the
  plugin stays off there.
- `Save-Data` or `prefers-reduced-data: reduce` keeps the plugin off.
- Pages rendered by the built-in docs engine navigate with their own runtime and are skipped.
- Register `prefetch()` once per app. A second instance fails the build.
