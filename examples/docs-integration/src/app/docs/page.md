---
title: Farm Docs
description: Docs rendered from Markdown by Farm.
---

# Farm Docs

This page is loaded from `src/app/docs/page.md` through the Farm docs integration.

The matching API route uses the same shape as the `@farming-labs/docs` Next.js adapter:

```ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
```

The example also uses the same handler in `src/app/api/docs/[...docs]/route.ts`, so the same server
wrapper can answer path-style machine routes.

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
