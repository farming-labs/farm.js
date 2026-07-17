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
    metadata: {
      description: "Product guides and API reference.",
    },
    nav: {
      title: "Acme Docs",
    },
  },
});
```

Farm uses `src/app/docs` for content when `entry` is `/docs`. Add markdown pages using the normal
app directory structure:

```txt
src/app/docs/
  page.md
  getting-started/
    page.md
  api-reference/
    page.md
```

Use frontmatter for page metadata:

```md
---
title: "Getting Started"
description: "Install Farm and create your first application."
---

# Getting Started
```

## Automatic docs routes

When `docs.entry` is enabled, Farm serves the docs entry and `/api/docs` machine endpoints
automatically. Route wrappers are only needed when you want to override the default behavior.

- /docs
- /docs/getting-started
- /docs/getting-started.md
- /api/docs?format=llms
- /api/docs?format=sitemap-xml
- /api/docs/agent/spec

## Configure the docs experience

Keep docs configuration alongside the rest of the application in `farm.config.ts`:

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  docs: {
    entry: "/docs",
    nav: {
      title: "Acme Docs",
      url: "/",
    },
    search: {
      provider: "simple",
      enabled: true,
      maxResults: 10,
    },
    pageActions: {
      copyMarkdown: {
        enabled: true,
      },
    },
    llmsTxt: {
      enabled: true,
      siteTitle: "Acme Docs",
    },
    sitemap: true,
    robots: true,
  },
});
```

The `docs` object controls the public path, metadata, navigation, search, page actions, agent output,
theme, icons, reading time, last-updated display, sitemap, and robots output. `defineDocs` is not
required for a Farm application.

### Optional external config

Large documentation sites may move the serializable docs options into `docs.config.ts`,
`docs.config.js`, `docs.config.mjs`, `docs.config.cjs`, or `docs.json`. Farm discovers those files
automatically. Values declared in `farm.config.ts` take priority, so applications can still override
the entry or any shared setting.

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

```ts
// src/app/api/docs/route.ts
import { createDocsAPI } from "@farmjs/core/docs";

export const { GET, POST } = createDocsAPI();
```

Add the same exports to `src/app/api/docs/[...docs]/route.ts` when the override should also own
path-style machine routes. Most applications do not need either wrapper.

## Production notes

- Keep docs content in markdown so human pages and agent-readable pages stay in sync.
- Keep the canonical docs configuration in the `docs` property of `farm.config.ts`.
- Use an external docs config only when a large navigation or theme definition is easier to maintain separately.
- Keep generated docs routes public unless product docs require auth.
- Verify docs build output before publishing package docs.
