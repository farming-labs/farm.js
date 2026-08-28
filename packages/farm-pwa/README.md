# @farm.js/pwa

Installable, offline-aware Progressive Web Apps for Farm.js. The plugin generates a route-aware
service worker or copies a custom one during the production build, then registers it through Farm's
browser plugin lifecycle.

Farm.js is currently in beta.

## Install

```bash
pnpm add @farm.js/pwa
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { pwa } from "@farm.js/pwa";

export default defineConfig({
  plugins: [
    pwa({
      offline: "/offline",
      cache: "auto",
    }),
  ],
});
```

Create `src/app/offline/page.tsx` as a static route and define application metadata in
`src/app/manifest.ts`. Farm already serves that manifest at `/manifest.webmanifest`, so the plugin
does not duplicate it.

## Short cache configuration

`auto` precaches emitted static pages and uses SWR for public same-origin images. It is the default,
so you can omit `cache` when you want this behavior:

```ts
pwa({
  offline: "/offline",
  cache: "auto",
});
```

The previous `recommended` value remains available as a compatibility alias for `auto`.

The explicit short form is:

```ts
pwa({
  cache: {
    staticRoutes: true,
    images: "swr",
  },
});
```

`swr` means stale while revalidate. A cached image is returned immediately while the worker fetches
and stores a newer response in the background. The default keeps 100 entries fresh for 30 days.

Override those limits only when needed:

```ts
pwa({
  cache: {
    staticRoutes: ["/", "/pricing"],
    images: {
      strategy: "swr",
      limit: 200,
      ttl: "7d",
    },
  },
});
```

## Bring your own service worker

Advanced applications can replace the generated worker with a prebuilt JavaScript file:

```ts
pwa({
  serviceWorker: {
    source: "src/service-worker.js",
    type: "module",
  },
});
```

The source path is relative to the Farm project root. Farm copies the file verbatim to the final
`sw.js` location and keeps its production registration and update lifecycle. A custom worker owns
all fetch, offline, and cache behavior, so `serviceWorker` cannot be combined with `offline` or
`cache`. It must handle the `FARM_PWA_SKIP_WAITING` message for Farm's update action to activate a
waiting worker.

## Updates

`update: "prompt"` is the default. The plugin dispatches `farm:pwa:update-available` when a new
worker is waiting:

```ts
window.addEventListener("farm:pwa:update-available", (event) => {
  const { applyUpdate } = (event as CustomEvent).detail;
  showUpdateButton(applyUpdate);
});
```

The same action is available as `window.__FARM_PWA__?.applyUpdate()`. Use `update: "auto"` only when
an automatic reload cannot discard unsaved user work.

## Safety boundaries

The generated worker only intercepts `GET` requests. It never caches cross-origin traffic,
mutations, API requests as pages, server actions, integrations, or workflows. Image requests with
an `Authorization` header and responses marked `private`, `no-store`, or `no-cache` are not stored.
Treat `images: "swr"` as an opt-in for public images, not private account media.

Service workers register only in production. Test the complete behavior with `farm build` and a
production server over HTTPS or localhost.
