---
title: "MSW Plugin"
description: "Share Mock Service Worker handlers between Farm development SSR and browser requests without shipping mocks to production."
section: "Plugin Ecosystem"
---

# MSW Plugin

`@farm.js/msw` loads one [Mock Service Worker](https://mswjs.io/) handler module in both sides of a
Farm development server. It starts MSW's Node interceptor before SSR and server code run, then
starts the browser service worker before hydration. This keeps mocked responses consistent when a
request moves between a server-rendered page and client code.

The plugin is development-only. Farm removes it from the resolved production configuration, so the
MSW runtimes, handlers, and worker are not included in the production client or server output.

## Install and configure

```bash
pnpm add -D @farm.js/msw
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { msw } from "@farm.js/msw";

export default defineConfig({
  plugins: [
    msw({
      handlers: "./src/mocks/handlers.ts",
    }),
  ],
});
```

`handlers` is resolved from the Farm app root. The module may use a named `handlers` export, which
is recommended, or default-export the array.

## Define shared handlers

```ts title="src/mocks/handlers.ts"
import { delay, http, HttpResponse } from "@farm.js/msw/handlers";

export const handlers = [
  http.get("/api/products", async () => {
    await delay(200);
    return HttpResponse.json([
      { id: "tractor", name: "Tractor" },
      { id: "harvester", name: "Harvester" },
    ]);
  }),
];
```

The `/handlers` entry re-exports MSW's common `http`, `graphql`, `ws`, `HttpResponse`, `delay`,
`bypass`, and `passthrough` APIs. No separate `msw` install is needed.

Use an absolute request URL when server code calls an external service. Relative handlers remain
useful for same-origin browser and Farm API requests.

```ts title="src/mocks/handlers.ts"
import { http, HttpResponse } from "@farm.js/msw/handlers";

export const handlers = [
  http.get("https://inventory.example.com/status", () => HttpResponse.json({ available: true })),
];
```

## What the plugin owns

| Development surface | Behavior                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server              | Starts `setupServer()` before Farm handles requests, covering SSR, API routes, queries, actions, and other Node-side fetches.                    |
| Browser             | Serves MSW's worker under the configured Farm `basePath` and starts `setupWorker()` before hydration.                                            |
| HMR                 | Reloads the server handler list when the handler module or one of its imported modules changes. Browser changes use Vite's normal module update. |
| Shutdown            | Stops the Node interceptor and browser worker when the corresponding Farm runtime closes.                                                        |
| Production          | Removes the plugin before production client and server bundles are generated.                                                                    |

This is the value over wiring MSW manually: the app does not need separate browser and server
bootstrap files, a copied worker in `public`, custom startup ordering, or cleanup and HMR glue.

## Options

```ts
msw({
  handlers: "./src/mocks/handlers.ts",
  browser: true,
  server: true,
  onUnhandledRequest: "bypass",
  enabled: true,
});
```

| Option               | Default    | Purpose                                                             |
| -------------------- | ---------- | ------------------------------------------------------------------- |
| `handlers`           | Required   | Root-relative module containing the handler array.                  |
| `browser`            | `true`     | Start the browser service worker.                                   |
| `server`             | `true`     | Start the Node interceptor used by development SSR and server code. |
| `onUnhandledRequest` | `"bypass"` | Bypass, warn about, or reject requests without a matching handler.  |
| `enabled`            | `true`     | Disable both runtimes without removing the config block.            |

Use `onUnhandledRequest: "error"` when the mock environment should be completely deterministic.
The default is `"bypass"` because a Farm development server also makes ordinary framework and
asset requests that usually should continue normally.

## Choose one runtime

Some apps need mocks on only one side:

```ts
msw({
  handlers: "./src/mocks/handlers.ts",
  browser: false,
});
```

With `browser: false`, SSR and server code are mocked but browser requests reach their normal
destination. Set `server: false` for the inverse. Disabling the browser runtime also prevents the
browser MSW entry from being added to the development client bundle.

## PWA compatibility

`@farm.js/msw` and [`@farm.js/pwa`](/docs/plugins/pwa) own service workers in different modes. MSW
runs only in development, while the PWA worker registers only in production. Their default workers
therefore do not compete for the same Farm page.

## Scope and safety

Mocks change development network behavior globally for the app. Keep handler modules free of
secrets, and do not treat a mocked authorization response as an authorization check. Production
routes must still validate sessions, permissions, input, and provider responses normally.

The runnable [`examples/msw-demo`](https://github.com/farming-labs/farm.js/tree/main/examples/msw-demo)
shows the same intentionally nonexistent endpoint being intercepted from a Farm API route and
after browser hydration.
