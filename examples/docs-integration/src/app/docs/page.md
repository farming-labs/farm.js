---
title: Farm Docs
description: Docs rendered from Markdown by Farm.
---

# Farm Docs

This page is loaded from `src/app/docs/page.md` through the Farm docs integration.

The matching API route uses the same shape as a Next.js route handler:

```ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
```
