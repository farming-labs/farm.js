---
title: "PWA Plugin"
description: "Generate a route-aware service worker with safe offline navigation, update prompts, and concise SWR image caching."
section: "Plugin Ecosystem"
---

# PWA Plugin

`@farm.js/pwa` turns a production Farm build into an installable, offline-aware Progressive Web App.
It generates a service worker from the final client output, maps emitted static routes to their HTML
files, and registers the worker through Farm's browser lifecycle.

## Install

```bash
pnpm add @farm.js/pwa
```

## Start with the short configuration

```ts title="farm.config.ts"
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

The worker always precaches immutable build assets. `cache: "auto"` additionally means:

- Precache every HTML page Farm emitted as a static route.
- Cache public same-origin images with SWR.
- Keep up to 100 image responses fresh for 30 days.

`auto` is the default, so you can omit `cache` for the same behavior. The previous `recommended`
value remains available as a compatibility alias. Service worker updates separately default to
`update: "prompt"`.

The worker only intercepts `GET` requests and same-origin URLs. Dynamic pages, APIs, actions,
integrations, and workflows remain network-owned.

## Add the offline page

The fallback has to be static because the worker must download it during installation.

```tsx title="src/app/offline/page.tsx"
export const ssg = true;

export default function OfflinePage() {
  return (
    <main>
      <h1>You are offline</h1>
      <p>Reconnect to load fresh server data.</p>
    </main>
  );
}
```

The production build fails with a clear message if `offline` does not resolve to emitted static
HTML. This prevents a worker from installing with a fallback that can never work.

## Add the application manifest

Use Farm's existing metadata route. Farm serves it at `/manifest.webmanifest`, so the plugin does
not ask you to repeat application metadata in PWA configuration.

```ts title="src/app/manifest.ts"
import type { MetadataRoute } from "@farm.js/core";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Acme Field App",
    short_name: "Acme",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16a34a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

## SWR in one line

Use the explicit form when you want individual cache controls instead of the automatic preset:

```ts
pwa({
  cache: {
    staticRoutes: true,
    images: "swr",
  },
});
```

`swr` means stale while revalidate:

1. The first request downloads and stores the image.
2. A later request returns the cached image immediately.
3. The worker fetches a newer response in the background.
4. The next request receives the refreshed image.

Image requests with an `Authorization` header and responses marked `Cache-Control: private`,
`no-store`, or `no-cache` are never stored. Only use this option for public images because Cache
Storage survives sign-out in the same browser profile.

Customize the storage bounds with short names:

```ts
pwa({
  cache: {
    staticRoutes: ["/", "/help", "/pricing"],
    images: {
      strategy: "swr",
      limit: 200,
      ttl: "7d",
    },
  },
});
```

`limit` is the maximum image count. `ttl` accepts milliseconds or `s`, `m`, `h`, `d`, and `w`
durations such as `30s`, `5m`, `6h`, `30d`, or `2w`.

## Update behavior

The default is `update: "prompt"`. When a new service worker finishes installing, the plugin
dispatches an event instead of reloading a page that may contain unsaved work:

```ts title="src/client.ts"
window.addEventListener("farm:pwa:update-available", (event) => {
  const { applyUpdate } = (event as CustomEvent).detail;
  showUpdateButton({ onClick: applyUpdate });
});
```

Application code can also call:

```ts
window.__FARM_PWA__?.applyUpdate();
```

Set `update: "auto"` only when reloading cannot discard user input. Auto mode activates a waiting
worker and reloads once the new worker controls the page.

## Options

| Option    | Default    | Description                                                           |
| --------- | ---------- | --------------------------------------------------------------------- |
| `enabled` | `true`     | Generate and register the worker.                                     |
| `offline` | `false`    | Static route served after an offline navigation misses the cache.     |
| `update`  | `"prompt"` | Prompt or automatically activate and reload for a waiting worker.     |
| `cache`   | `"auto"`   | Automatic caching, a custom object, or `false` for build assets only. |

| Cache option   | Default under `auto` | Description                                          |
| -------------- | -------------------- | ---------------------------------------------------- |
| `staticRoutes` | `true`               | Every emitted static page, a route list, or `false`. |
| `images`       | `"swr"`              | SWR options, `true`, `"swr"`, or `false`.            |

## Production lifecycle

During `farm build`, the plugin:

1. Finds the preset's final public output.
2. Hashes precached files and caching options into a deployment-specific cache ID.
3. Writes `sw.js` under Farm's configured `basePath`.
4. Maps clean static route URLs to emitted HTML files.
5. Fails if the configured offline page is missing.

In the browser, the plugin registers only for production builds. Service workers require HTTPS in
production; browsers also permit localhost for development and local production testing.

See the complete runnable source in
[`examples/pwa-demo`](https://github.com/farming-labs/farm.js/tree/main/examples/pwa-demo).
