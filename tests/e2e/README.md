# Farm end-to-end tests

Run the complete framework end-to-end suite with:

```sh
pnpm test:e2e:framework
```

This is the single CI entry point for framework behavior. It builds the required packages and
verifies:

- development and production rendering, routing, hydration, navigation, route boundaries,
  prefetch controls, and global state
- emitted docs and SSR/SSG production servers
- internationalization routing, persistence, hydration, and localized API context
- React Server Components, server actions, middleware, server queries, and optimized boundaries

Focused commands remain available while developing an individual area:

```sh
pnpm test:e2e
pnpm test:e2e:production
pnpm test:e2e:production:sites
pnpm test:e2e:i18n
pnpm test:e2e:rsc
```

For example, run only the production internationalization coverage with:

```sh
pnpm test:e2e:i18n
```

The i18n suite builds the framework and `examples/i18n`, starts the Nitro production server, and
verifies locale signal precedence, canonical redirects, cache boundaries, localized API context,
hydration, client locale switching, cookie persistence, and RTL rendering.

Run only the emitted docs and SSR/SSG production smoke coverage with:

```sh
pnpm test:e2e:production:sites
```

This builds both sites with the Node production preset, boots only their emitted server entries,
and verifies docs navigation, SSR responses, middleware-covered SSG routes, client hydration, and
API handlers. CI can use `test:e2e:production:sites:run` after the framework packages are built.

Run only the emitted React Server Components coverage with:

```sh
pnpm test:e2e:rsc
```

It verifies the standalone server, hashed CSS, navigation metadata, client hydration, server
actions, API middleware, post-response work, server-function middleware, and server-query refresh.

## Framework feature coverage

`framework-features.spec.ts` runs the features together in `examples/basic` and verifies:

- Farm layers, route rules, redirects, programmatic routes, static paths, and generated route types
- typed params/search, request context, guards, route data lifecycle, caching, and invalidation
- pending, error, and not-found route states
- typed links, prefetch navigation, navigation pending state, blockers, page state, and view transitions
- typed public/server environment values and client/server/isomorphic environment boundaries
- metadata image routes and executable workflows

Focused core, plugin, CLI, preview-gateway, and example type-check suites remain the source of truth for lower-level behavior such as form actions, server-function security, migrations, and gateway queue handling. Public DNS, tunnel-provider availability, and hosted deployment behavior require provider-level smoke tests and are intentionally outside the deterministic local suite.
