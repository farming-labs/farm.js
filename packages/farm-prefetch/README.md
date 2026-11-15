# `@farm.js/prefetch`

**Give plain `<a>` links the same prefetching as core `Link`, app-wide.**

Core `Link` prefetches its own anchors. Links in rendered HTML, Markdown and
CMS content are plain `<a>` elements, so core never sees them. This plugin
gives them `Link`'s modes (`intent`, `viewport`, `render`, `none`) and sends
every prefetch through the router: `router.prefetch` for intent and render,
`router.observeForPrefetch` for viewport.

It does not fetch, cache or queue anything itself. Dedupe, the route data
cache, the viewport queue and islands-mode router loading are core's.

## Install

```bash
pnpm add @farm.js/prefetch
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { prefetch } from "@farm.js/prefetch";

export default defineConfig({
  plugins: [prefetch()],
});
```

That prefetches a plain link 50ms after it is hovered, focused or touched.

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

Invalid options fail the build with every problem listed at once.

## Per link

A link picks its own mode with `data-farm-prefetch`, which takes the same
values as `Link`'s `prefetch` prop:

```html
<a href="/pricing" data-farm-prefetch="render">Pricing</a>
<a href="/export" data-farm-prefetch="none">Export</a>
```

An unknown value, such as `"off"` or a typo, never prefetches.

## What is skipped

Only links the router would navigate on click are prefetched. These are
skipped:

- `Link` anchors (`data-farm-link`), which prefetch themselves
- `download` links and links with a `target` other than `_self`
- absolute URLs, including same-origin ones (`https://…`, `//…`, `mailto:`):
  core loads them as a new document
- `#hash` links and links to the current page and query
- paths `deny` rejects or `allow` leaves out
- every link on pages rendered by the built-in docs engine

## Limits

- Server Components mode (`experimental.serverComponents: "rsc"`) has no
  router prefetch, so the plugin stays off there.
- `Save-Data` or `prefers-reduced-data: reduce` keeps the plugin off.
- `"viewport"` needs a router with `observeForPrefetch`. Farm's dev,
  production and islands routers all have it.
- Register `prefetch()` once per app. A second instance fails the build.
