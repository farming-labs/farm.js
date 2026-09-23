# Farm content demo

A small editorial site proving `@farm.js/content` in development, static generation, nested routes,
generated types, schema errors, transforms, and the Nitro production bundle.

```bash
pnpm --filter farm-content-demo dev
pnpm --filter farm-content-demo type-check
pnpm --filter farm-content-demo build
```

The collections are configured in `farm.config.ts`. The home page reads the typed collection and
the catch-all post route turns nested entry IDs into static paths.
