# FARMJS Vue renderer example

This example combines Vue SFC rendering with FARMJS server primitives:

- `farm.config.ts` selects the `@farm.js/vue` renderer.
- `src/app/page.vue` and `src/app/layout.vue` are server-rendered and hydrated by FARMJS.
- `src/features/greeting/greeting-panel.vue` is an interactive Vue component.
- `src/features/greeting/server.ts` colocates the typed `createServerFn` declaration and its HTTP transport with the feature.
- `src/app/api/greeting/route.ts` is the thin filesystem-route alias FARMJS uses for discovery.

The browser calls the typed API client. The endpoint invokes `createGreeting` on the server, so input/output validation and the server-only handler remain active without shipping the handler to the browser.

```bash
pnpm --filter farm-vue-renderer-example dev
```
