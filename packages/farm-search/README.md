# `@farm.js/search`

Build-time static page search for Farm.js applications, powered by Pagefind.

```ts
import { defineConfig } from "@farm.js/core";
import { search } from "@farm.js/search";

export default defineConfig({
  plugins: [search({ include: ["/docs/**", "/blog/**"] })],
});
```

Create a renderer-neutral browser client and query the generated index:

```ts
import { createSearch } from "@farm.js/search/client";

const siteSearch = createSearch();
const response = await siteSearch.search("server functions");
```

The plugin indexes only HTML emitted by static generation. It automatically respects Farm's
`basePath`, writes a deployment-ready chunked index, and keeps dynamic or authenticated content out
unless it was deliberately emitted as public static HTML.

See the [Farm Search documentation](https://farmjs.dev/docs/plugins/search) for route selection,
filters, result types, and production behavior.
