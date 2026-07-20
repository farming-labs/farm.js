---
title: "Plugin Ecosystem"
description: "Extend Farm's framework lifecycle with typed config, runtime, router, render, build, and development hooks."
section: "Extending"
---

# Plugin Ecosystem

Plugins are Farm's framework extension surface. Use a plugin to change how Farm configures an app, handles requests, discovers routes, renders HTML, builds output, or responds to development events.

Use an [integration](/docs/integrations) for a product or service such as authentication, payments, email, analytics, or a database. Integrations own product config, endpoints, typed callers, and providers. Plugins own framework lifecycle behavior.

## Register a plugin

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";
import { requestTracingPlugin } from "./src/plugins/request-tracing";

export default defineConfig({
  plugins: [requestTracingPlugin()],
});
```

## Interface

`definePlugin()` infers private setup state and request context across the plugin.

```ts
import { definePlugin } from "@farmjs/core";

export const frameworkPlugin = definePlugin({
  name: "framework-plugin",
  enforce: "pre",

  configure(config) {},
  setup({ env }) {
    return { startedAt: Date.now() };
  },

  runtime: {
    start({ state }) {},
    context({ request, state, req }) {
      return { pathname: new URL(request.url).pathname };
    },
    before({ request, ctx, state }) {},
    after({ response, ctx, state }) {},
    error({ error, ctx, state }) {},
    close({ reason, state }) {},
  },

  router: {
    discovered(route, { state }) {},
    generated(routes, { state }) {},
    before(route, { state }) {},
    after(result, { state }) {},
  },

  render: {
    before(render, { state }) {},
    html(html, render, { state }) {},
  },

  build: {
    before(bundle, { state }) {},
    configure(buildConfig, { state }) {},
    after(result, { state }) {},
  },

  dev: {
    server(viteServer, { state }) {},
    update(update, { state }) {},
  },
});
```

Only define the groups your plugin needs.

| Surface | Purpose |
| --- | --- |
| `configure` | Transform Farm config before resolution. |
| `setup` | Create private, typed plugin state for one plugin manager. |
| `runtime` | Wrap Web `Request` and `Response` handling. |
| `router` | Observe route discovery, generation, and matching. |
| `render` | Observe rendering or transform final HTML. |
| `build` | Run around bundling and configure the Nitro build. |
| `dev` | Access the Vite server and HMR updates. |

## Runtime flow

For each application request, Farm runs the runtime hooks in this order:

1. Every `runtime.context` creates request-local values.
2. Every `runtime.before` runs in plugin order.
3. Farm calls the page, API route, or integration handler unless a plugin returned a `Response`.
4. Every `runtime.after` can transform the response.
5. `runtime.error` observes an error if any preceding phase throws.

`runtime.before` may return a new `Request`, return a `Response` to short-circuit, or return nothing. A short-circuit response still passes through `runtime.after`. `runtime.after` may return a new `Response` or return nothing.

Runtime hooks use Web APIs, so the same plugin works in development and universal production builds. The event includes `kind`, route metadata, the request `AbortSignal`, and `waitUntil()` for background work supported by the host.

## State and context

There are three different kinds of plugin data:

| Value | Lifetime | Use |
| --- | --- | --- |
| `state` | Plugin manager | Clients, compiled matchers, loggers, or other resources returned by `setup`. |
| `ctx` | One request | Typed values returned by `runtime.context`. |
| `req` | One request | A shared key/value store for plugins, middleware, integrations, and optional page data. |

Farm merges all `runtime.context` results before running `runtime.before`. Context keys must be unique; Farm throws and names both plugins when two plugins return the same key.

`ctx` remains server-only. To expose a safe value to a page, write it to `req` explicitly:

```ts
runtime: {
  context({ req }) {
    const traceId = crypto.randomUUID();

    req.set("traceId", traceId, { exposeToPage: true });
    req.set("internalToken", "server-only");

    return { traceId };
  },
},
```

Only values marked `exposeToPage: true` appear in `props.context?.data`. Farm preserves the request store when a plugin returns a transformed `Request`.

## Ordering

Set `enforce` only when hook order is part of the plugin contract:

```ts
definePlugin({ name: "auth-context", enforce: "pre" });
definePlugin({ name: "metrics" });
definePlugin({ name: "response-reporting", enforce: "post" });
```

Farm runs `pre` plugins first, normal plugins second, and `post` plugins last. Hooks that transform a shared value run serially in that order.

## Plugin or integration

| Choose | When |
| --- | --- |
| Integration | The extension represents a product or service and needs validated config, endpoints, typed callers, storage, or providers. |
| Plugin | The extension changes framework requests, rendering, routing, builds, HMR, or global instrumentation. |
| Both | A product integration also needs framework hooks. Keep the product API in the integration and expose its framework behavior through `plugins`. |

## Built-in plugins

Farm includes plugins for logging, compression, redirects, rewrites, headers, and environment helpers. Register them from `@farmjs/core/plugin/server`.

## Legacy hooks

Existing flat hooks such as `beforeRequest`, `afterResponse`, `beforeApiHandler`, `afterRender`, `beforeBundle`, and `shutdown` remain supported. They are deprecated where a structured equivalent exists. New plugins should use the grouped interface; do not define both versions of the same phase in one plugin because Farm will run both.

The Node-specific `beforeRequest` and `afterResponse` hooks remain available as compatibility escape hatches. Prefer `runtime.before` and `runtime.after` for portable plugins.

## Production checklist

- Give every plugin a stable, namespaced `name`.
- Keep per-request hooks fast and cancellation-aware.
- Return a new `Request` or `Response` instead of mutating Web objects.
- Never place credentials or secrets in page-exposed request data.
- Use `waitUntil()` only for work that may safely outlive the response.
- Make `runtime.error` resilient; an error reporter must not hide the original failure.
- Release timers, sockets, and watchers in `runtime.close` when the host exposes shutdown.
- Test hook ordering, short circuits, transformed bodies and headers, context collisions, and production output.

Continue with [Create a Plugin](/docs/plugins/create-plugin) for complete examples.
