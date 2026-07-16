---
title: "Docs Engine"
description: "Serve a @farming-labs/docs-powered docs runtime from Farm config, including human pages and agent-readable API routes."
section: "Content"
---

# Docs Engine

Serve a @farming-labs/docs-powered docs runtime from Farm config, including human pages and agent-readable API routes.

## Enable docs

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  docs: {
    entry: "/docs",
  },
});
```

## Automatic docs routes

When docs.entry is enabled, Farm can serve the docs entry and /api/docs machine endpoints automatically. Route wrappers are only needed when you want to override the default behavior.

- /docs
- /docs/getting-started
- /docs/getting-started.md
- /api/docs?format=llms
- /api/docs?format=sitemap-xml
- /api/docs/agent/spec

## Config discovery

Farm scans docs.config.ts, docs.config.js, docs.config.mjs, docs.config.cjs, and docs.json by default. Inline config in farm.config.ts can override discovered values.

## docs.config.ts shape

**docs.config.ts**

```ts
import { defineDocs } from "@farming-labs/docs";
import { pixelBorder } from "@farming-labs/theme/pixel-border";

export default defineDocs({
  entry: "docs",
  docsPath: "/docs",
  nav: {
    title: "Farm.js Docs",
  },
  search: {
    provider: "simple",
    enabled: true,
  },
  pageActions: {
    copyMarkdown: {
      enabled: true,
    },
  },
  theme: pixelBorder(),
});
```

## Agent-readable output

The docs runtime can serve human pages and machine-readable output from the same markdown source:

- `.md` mirrors for individual pages.
- `llms.txt` style summary output.
- Sitemap output.
- Agent discovery/spec routes.
- Search metadata.

That means docs content only needs to be written once.

## Last updated dates

When `lastUpdated` is enabled, Farm uses the latest Git commit for each markdown page instead of
trusting deployment file timestamps. Production builds preserve those dates in the bundled docs
content, so archive or copy metadata cannot turn into a misleading footer date.

Set an explicit date in frontmatter when a page needs editorial control:

```md
---
title: "Release Policy"
lastModified: "2026-07-16"
---
```

Explicit frontmatter wins over generated Git metadata. When Git history is unavailable, local docs
fall back to the source file timestamp and copied production docs fall back to the build date.

## Override behavior

When `docs.entry` is enabled in `farm.config.ts`, Farm can mount docs pages and docs API routes automatically. Add explicit route wrappers only when the app wants to override default rendering, authentication, or response behavior.

## Production notes

- Keep docs content in markdown so human pages and agent-readable pages stay in sync.
- Use `docs.config.ts` for navigation, page actions, icons, theme, and metadata.
- Keep generated docs routes public unless product docs require auth.
- Verify docs build output before publishing package docs.
