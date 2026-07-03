# Farm docs integration example

This example shows the Farm docs runtime and the Next-style API wrapper.

```ts
// src/app/api/docs/route.ts
import { createDocsAPI } from '@farmjs/core/docs';

export const { GET, POST } = createDocsAPI();
```

Try:

- `/docs`
- `/docs/getting-started`
- `/docs/getting-started.md`
- `/api/docs?format=config`
- `/api/docs?format=markdown&path=getting-started`
- `/api/docs?query=api`
