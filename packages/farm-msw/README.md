# @farm.js/msw

Run one set of [Mock Service Worker](https://mswjs.io/) handlers in the browser and during Farm
development SSR.

## Install

```bash
pnpm add -D @farm.js/msw
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { msw } from "@farm.js/msw";

export default defineConfig({
  plugins: [msw({ handlers: "./src/mocks/handlers.ts" })],
});
```

```ts
import { delay, http, HttpResponse } from "@farm.js/msw/handlers";

export const handlers = [
  http.get("/api/products", async () => {
    await delay(200);
    return HttpResponse.json([{ id: "tractor", name: "Tractor" }]);
  }),
];
```

The plugin starts MSW's Node interceptor before development requests reach Farm and starts the
browser worker before hydration. Handler changes are reloaded through Vite HMR. During a production
build the plugin removes itself from Farm's resolved configuration, so MSW is not bundled or
started.

## Options

```ts
msw({
  handlers: "./src/mocks/handlers.ts",
  browser: true,
  server: true,
  onUnhandledRequest: "bypass",
});
```

Set `browser` or `server` to `false` when only one development runtime should be mocked. Use
`onUnhandledRequest: "warn"` or `"error"` when every request is expected to have a handler.
