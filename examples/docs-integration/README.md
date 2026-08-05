# Farm docs integration example

This example shows Farm using the official `@farming-labs/farmjs` adapter. Enabling the adapter in
`farm.config.ts` automatically serves both the human docs entry and `/api/docs/*` machine routes.

```ts
// farm.config.ts
import { defineConfig } from '@farm.js/core';
import { withDocs } from '@farming-labs/farmjs/config';

export default withDocs(
  defineConfig({
    deploy: { target: 'vercel' },
  }),
  {
    config: {
      entry: '/docs',
      metadata: {
        description: 'Farm docs integration example',
      },
      nav: {
        title: 'Farm Docs',
      },
      search: {
        provider: 'simple',
        enabled: true,
      },
      pageActions: {
        copyMarkdown: { enabled: true },
      },
      llmsTxt: true,
      sitemap: true,
      robots: true,
    },
  },
);
```

Place markdown in `src/app/docs`. The folder structure becomes the docs URL structure, so
`src/app/docs/getting-started/page.md` is served at `/docs/getting-started` and
`/docs/getting-started.md`. A separate `docs.config.*` or `docs.json` file is supported for large
serializable configurations but is not required.

You only need app route wrappers when you want to override the default handler:

```ts
// src/app/api/docs/route.ts
import { createDocsAPI } from '@farm.js/core/docs';

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
