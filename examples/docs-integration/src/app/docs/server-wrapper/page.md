---
title: Automatic API Route
description: How Farm registers the docs API while keeping a Next-style override.
---

# Automatic API Route

Farm registers the docs API automatically from `farm.config.ts`:

```ts
import { defineConfig } from '@farm.js/core';

export default defineConfig({
  docs: {
    entry: '/docs',
  },
});
```

That gives the app the human docs entry and the machine routes without adding files under
`src/app/api/docs`.

When you need to customize the server behavior, add a route file and Farm will use it instead of
the default for that matched path:

```ts
import { createDocsAPI } from '@farm.js/core/docs';

export const { GET, POST } = createDocsAPI();
export const revalidate = false;
```

Add the same exports in `src/app/api/docs/[...docs]/route.ts` when your override should also own
path-style URLs. The automatic default supports both compact query routes and path-style routes:

- `/api/docs?format=markdown&path=getting-started`
- `/api/docs/getting-started.md`
- `/api/docs/agent/spec`
