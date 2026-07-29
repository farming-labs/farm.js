---
title: Farm Docs
description: Docs rendered from Markdown by Farm.
---

# Farm Docs

This page is loaded from `src/app/docs/page.md` through the Farm docs integration. The matching
machine API route is registered automatically when docs are enabled in `farm.config.ts`:

```ts
import { defineConfig } from '@farm.js/core';

export default defineConfig({
  docs: {
    entry: '/docs',
  },
});
```

If you need custom behavior, you can still add `src/app/api/docs/route.ts` and export
`createDocsAPI()` handlers as an override. Add the same exports in
`src/app/api/docs/[...docs]/route.ts` when the override should own path-style URLs too.

## Machine routes

- Search JSON: `/api/docs?query=api`
- Config JSON: `/api/docs?format=config`
- Markdown by query: `/api/docs?format=markdown&path=getting-started`
- Markdown by path: `/api/docs/getting-started.md`
- LLM summary: `/api/docs?format=llms`
- Full LLM document: `/api/docs?format=llms-full`
- Sitemap XML: `/api/docs?format=sitemap-xml`
- Sitemap Markdown: `/api/docs?format=sitemap-md`
- Robots text: `/api/docs?format=robots`
- Skill Markdown: `/api/docs?format=skill`
- Agent spec JSON: `/api/docs/agent/spec`
