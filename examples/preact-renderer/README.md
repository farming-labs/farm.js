# FARMJS Preact Renderer Example

This example exercises Preact route components with FARMJS routing, server rendering and streaming,
browser hydration, generated API types, and a colocated `createServerFn` handler.

```bash
pnpm install
pnpm --filter farm-preact-renderer-example dev
```

The home page is server-rendered through `@farm.js/preact`. Its button hydrates with Preact and
calls the typed `/api/greeting` endpoint, which invokes the server function.
