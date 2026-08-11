# FARMJS Solid renderer example

This example combines Solid rendering with FARMJS server primitives:

- `farm.config.ts` selects the `@farm.js/solid` renderer.
- `src/app/page.tsx` is server-rendered by FARMJS.
- `src/features/greeting/greeting-panel.tsx` is an interactive Solid client component.
- `src/features/greeting/server.ts` colocates the typed `createServerFn` declaration and its HTTP transport with the feature.
- `src/app/api/greeting/route.ts` is only the thin filesystem-route alias FARMJS uses for discovery.

The browser calls the typed API client. The endpoint invokes `createGreeting` on the server, so its input/output validation and server-only handler remain active without shipping the handler to the browser.

```bash
pnpm --filter farm-solid-renderer-example dev
```
