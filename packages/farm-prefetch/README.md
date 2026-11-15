# `@farm.js/prefetch`

**Prefetch plain `<a>` links like core `Link`, with one set of rules for every link.**

Core `Link` prefetches its own anchors. Links in rendered HTML, Markdown and
CMS content are plain `<a>` elements, so core never sees them. This plugin:

- gives plain links `Link`'s modes (`intent`, `viewport`, `render`, `none`)
- applies `allow`, `deny` and data saving to every prefetch, `Link`'s included

It does not fetch, cache or queue anything itself. Every prefetch still goes
through the router (`router.prefetch`, `router.observeForPrefetch`), so dedupe,
the route data cache, the viewport queue and islands-mode router loading stay
in core.

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
| `allow`         | `[]`       | Route patterns that may be prefetched, `Link`'s included, in Farm route syntax. Empty allows every path.                                                |
| `deny`          | `[]`       | Route patterns that are never prefetched, `Link`'s included. Checked first, so `deny` wins.                                                             |

Invalid options fail the build with every problem listed at once.

## Rules for every link

`Link`, the router's viewport queue, the `prefetch()` helper and this plugin
all call one method, `router.prefetch`. The plugin puts its rules in front of
it, so they hold everywhere:

- a path `deny` names, or `allow` leaves out, is never prefetched
- under `Save-Data` or `prefers-reduced-data: reduce`, nothing is prefetched

A blocked prefetch resolves without a request, and the click fetches the page.
To keep `Link`'s prefetching as it is and only add rules, use `mode: "none"`:

```ts
prefetch({ mode: "none", deny: ["/admin/[...rest]"] });
```

When the plugin closes, `router.prefetch` is restored.

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
- Patterns match the path the browser requests. With a `basePath` or a
  locale prefix, include it: `/base/admin/[...rest]`, `/[locale]/admin/[...rest]`.
- `"viewport"` needs a router with `observeForPrefetch`. Farm's dev,
  production and islands routers all have it.
- Register `prefetch()` once per app. A second instance fails the build.
