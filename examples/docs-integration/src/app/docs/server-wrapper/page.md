---
title: Server Wrapper
description: How the Farm docs API mirrors the farming-labs docs adapter shape.
---

# Server Wrapper

Farm keeps the app route small:

```ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
export const revalidate = false;
```

That shape intentionally follows the `@farming-labs/docs` adapter pattern where a docs server owns
the shared `GET` and `POST` handlers for search, markdown, agent, and AI surfaces.

The catch-all route uses the same wrapper:

```ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
export const revalidate = false;
```

With both files in place, the example supports the compact query API and the path-style API:

- `/api/docs?format=markdown&path=getting-started`
- `/api/docs/getting-started.md`
- `/api/docs/agent/spec`
