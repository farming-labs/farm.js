# Farm end-to-end tests

Run the complete browser suite with:

```sh
pnpm test:e2e
```

Run the recent-feature integration lab, including the required framework build, with:

```sh
pnpm test:e2e:recent
```

## Recent feature coverage

`recent-features.spec.ts` runs the features together in `examples/basic` and verifies:

- Farm layers, route rules, redirects, programmatic routes, static paths, and generated route types
- typed params/search, request context, guards, route data lifecycle, caching, and invalidation
- pending, error, and not-found route states
- typed links, prefetch navigation, navigation pending state, blockers, page state, and view transitions
- typed public/server environment values and client/server/isomorphic environment boundaries
- metadata image routes and executable workflows

Focused core, plugin, CLI, preview-gateway, and example type-check suites remain the source of truth for lower-level behavior such as form actions, server-function security, migrations, and gateway queue handling. Public DNS, tunnel-provider availability, and hosted deployment behavior require provider-level smoke tests and are intentionally outside the deterministic local suite.
