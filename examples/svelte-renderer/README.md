# FARMJS Svelte Renderer Example

This example exercises Svelte 5 route components with FARMJS routing, server rendering, browser
hydration, generated API types, and a colocated `createServerFn` handler.

```bash
pnpm install
pnpm --filter farm-svelte-renderer-example dev
```

The home page is server-rendered through `@farm.js/svelte`. Its button hydrates with Svelte and
calls the typed `/api/greeting` endpoint, which invokes the server function.
