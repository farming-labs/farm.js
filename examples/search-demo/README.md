# Farm Search demo

This example builds a static Pagefind index for the home page and every `/guides/**` route, then
queries it through the renderer-neutral `@farm.js/search/client` API.

The index exists only in production output:

```bash
pnpm --filter farm-search-demo build
pnpm --filter farm-search-demo start
```

Open the printed URL and search for `authorization`, `routing`, or `compiler`. The `/account` page
is static but deliberately excluded, so its billing text never appears in results.
