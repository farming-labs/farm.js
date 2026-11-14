# `@farm.js/prefetch`

App-wide link prefetching for Farm.js, as the default policy layer beside
core `Link`.

Core `Link` already prefetches its own links (intent / viewport / render).
This plugin covers the links core never sees — plain `<a>` elements in
rendered HTML, Markdown and CMS content — through the same
`router.prefetch` primitive, so fetching, caching and dedupe stay in one
place. It does not fetch pages itself.

## Install

```bash
pnpm add @farm.js/prefetch
```

```ts
// farm.config.ts
import { prefetch } from "@farm.js/prefetch";

export default {
  plugins: [
    prefetch({
      strategy: "both",
      maxConcurrent: 6,
      allow: ["/posts/[id]", "/docs/[...slug]"],
      deny: ["/admin/[...rest]"],
    }),
  ],
};
```

## Options

| Option          | Default    | Notes                                                                                                  |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `strategy`      | `"both"`   | `"hover"` (pointerenter/focus after `hoverDelayMs`), `"viewport"` (IntersectionObserver), or `"both"`. |
| `maxConcurrent` | `6`        | Maximum concurrent `router.prefetch` calls. The core router already dedupes in-flight and cached URLs. |
| `allow`         | `[]` (all) | Route patterns that may be prefetched, in Farm route syntax (`/posts/[id]`, `/docs/[...slug]`).        |
| `deny`          | `[]`       | Route patterns that are never prefetched. Checked before `allow`, so a denied pattern wins.            |
| `hoverDelayMs`  | `50`       | Delay after pointerenter/focus before a hover prefetch fires (same default as core `Link`).            |

## What is (and is not) prefetched

- Same-origin `http(s)` links only; cross-origin, `mailto:` and hash-only
  jumps are skipped.
- `Link`-managed anchors (`data-farm-link`) are skipped — core already
  handles them.
- `download` links, `target="_blank"` (and any non-`_self` target) links
  and `data-farm-prefetch="off"` links are skipped.
- When `Save-Data` is on or `prefers-reduced-data` matches, the runtime
  stays inert: no observers, no prefetches.
- Dynamically added anchors are picked up through a `MutationObserver`.
  `close()` (called by the plugin manager) disconnects every observer and
  drops the queue.

## Scope note

This is the app-wide default policy layer the issue asks for, scoped to
what core `Link` does not do. Per-link behaviour still belongs on `Link`
itself (`prefetch="viewport"`, `prefetchDelay`, …).
