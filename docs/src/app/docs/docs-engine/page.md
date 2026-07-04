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
export default defineFarmConfig({
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
