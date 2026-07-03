# Farm docs integration example

This example shows Farm's docs runtime and the Next-style docs API wrapper inspired by
`@farming-labs/docs`.

```ts
// src/app/api/docs/route.ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
```

The catch-all route uses the same wrapper so path-style machine routes work too:

```ts
// src/app/api/docs/[...docs]/route.ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
export const revalidate = false;
```

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
