# Farm docs integration example

This example shows Farm's docs runtime and the docs API surface inspired by
`@farming-labs/docs`. Enabling docs in `farm.config.ts` automatically serves both the human docs
entry and `/api/docs/*` machine routes.

```ts
// farm.config.ts
import { defineConfig } from '@farmjs/core';

export default defineConfig({
  docs: {
    entry: '/docs',
  },
});
```

You only need app route wrappers when you want to override the default handler:

```ts
// src/app/api/docs/route.ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
export const revalidate = false;
```

Add the same exports in `src/app/api/docs/[...docs]/route.ts` when your override should also own
path-style URLs like `/api/docs/getting-started.md`.

Try:

- `/docs`
- `/docs/getting-started`
- `/docs/server-wrapper`
- `/docs/getting-started.md`
- `/api/docs/getting-started.md`
- `/api/docs?format=config`
- `/api/docs?format=markdown&path=getting-started`
- `/api/docs?query=api`
- `/api/docs?format=llms`
- `/api/docs?format=llms-full`
- `/api/docs?format=sitemap-xml`
- `/api/docs?format=sitemap-md`
- `/api/docs?format=robots`
- `/api/docs?format=skill`
- `/api/docs/agent/spec`
