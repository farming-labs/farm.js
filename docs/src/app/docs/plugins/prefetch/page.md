---
title: "Prefetch"
description: "Prefetch plain anchors app-wide — hover and viewport triggers through the same router.prefetch primitive core Link uses."
section: "Plugin Ecosystem"
---

# Prefetch

`@farm.js/prefetch` prefetches plain `<a>` elements app-wide: the links core
never sees, in rendered HTML, Markdown and CMS content. It prefetches through
the same `router.prefetch` primitive core `Link` uses, so fetching, caching
and dedupe stay in one place. It does not fetch pages itself.

Core `Link` already prefetches its own links (intent / viewport / render).
This plugin covers the rest.

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
  plugins: [
    prefetch({
      strategy: "both",
      maxConcurrent: 6,
      allow: ["/posts/[id]", "/docs/[...slug]"],
      deny: ["/admin/[...rest]"],
    }),
  ],
});
```

That is the whole setup. Plain anchors are prefetched on hover and when they
enter the viewport; `Link`-managed anchors are left to core.

## Options

```ts
prefetch({
  strategy: "both",
  maxConcurrent: 6,
  hoverDelayMs: 50,
});
```

| Option          | Default    | Description                                                                                            |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `strategy`      | `"both"`   | `"hover"` (pointerenter/focus after `hoverDelayMs`), `"viewport"` (IntersectionObserver), or `"both"`. |
| `maxConcurrent` | `6`        | Maximum concurrent `router.prefetch` calls. The core router already dedupes in-flight and cached URLs. |
| `allow`         | `[]` (all) | Route patterns that may be prefetched, in Farm route syntax (`/posts/[id]`, `/docs/[...slug]`).        |
| `deny`          | `[]`       | Route patterns that are never prefetched. Checked before `allow`, so a denied pattern wins.            |
| `hoverDelayMs`  | `50`       | Delay after pointerenter/focus before a hover prefetch fires (same default as core `Link`).            |

## Behavior

- Same-origin `http(s)` links only; cross-origin, `mailto:` and hash-only
  jumps are skipped.
- `Link`-managed anchors (`data-farm-link`) are skipped — core already
  handles them.
- `download` links, `target="_blank"` (and any non-`_self` target) links and
  `data-farm-prefetch="off"` links are skipped.
- When `Save-Data` is on or `prefers-reduced-data` matches, the runtime
  stays inert: no observers, no prefetches.
- Dynamically added anchors are picked up through a `MutationObserver`.
  `close()` (called by the plugin manager) disconnects every observer and
  drops the queue.
- Per-link behaviour still belongs on `Link` itself
  (`prefetch="viewport"`, `prefetchDelay`, …).
