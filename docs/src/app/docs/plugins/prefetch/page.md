---
title: "Prefetch"
description: "Prefetch plain anchors in HTML, Markdown and CMS content like core Link, with one set of allow, deny and data-saving rules for every link."
section: "Plugin Ecosystem"
---

# Prefetch

`@farm.js/prefetch` prefetches plain `<a>` links the way core `Link` does, with one set of rules for
every link. Links in rendered HTML, Markdown and CMS content are plain anchors, so core never sees
them. The plugin:

- gives plain links `Link`'s modes (`intent`, `viewport`, `render`, `none`)
- applies `allow`, `deny` and data saving to every prefetch, `Link`'s included

It does not fetch, cache or queue anything itself. Every prefetch still goes through the router
(`router.prefetch`, `router.observeForPrefetch`), so dedupe, the
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
| `allow`         | `[]`       | Route patterns that may be prefetched, `Link`'s included, in Farm route syntax. Empty allows every path.                                                |
| `deny`          | `[]`       | Route patterns that are never prefetched, `Link`'s included. Checked first, so `deny` wins.                                                             |

Patterns use core's route matcher, so `[id]` matches one segment, `[...rest]` one or more, and
`[[...slug]]` zero or more. They match the path the browser requests, so include a `basePath` or
locale prefix: `/base/admin/[...rest]`, `/[locale]/admin/[...rest]`. Invalid options fail the build
with every problem listed at once.

## Rules for every link

`Link`, the router's viewport queue, the `prefetch()` helper and this plugin all call one method,
`router.prefetch`. The plugin puts its rules in front of it, so they hold everywhere:

- a path `deny` names, or `allow` leaves out, is never prefetched
- when `Save-Data` or `prefers-reduced-data: reduce` becomes active, subsequent prefetches are skipped, including those from plain links added after startup

A blocked prefetch resolves without a request, and the click fetches the page. To keep `Link`'s
prefetching as it is and only add rules, use `mode: "none"`:

```ts
prefetch({ mode: "none", deny: ["/admin/[...rest]"] });
```

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
- When the plugin closes, it removes its listeners, cancels a pending intent, hands back every
  observed link and restores `router.prefetch`.

## Limits

- Server Components mode (`experimental.serverComponents: "rsc"`) has no router prefetch, so the
  plugin stays off there.
- Pages rendered by the built-in docs engine navigate with their own runtime and are skipped.
- Register `prefetch()` once per app. A second instance fails the build.
