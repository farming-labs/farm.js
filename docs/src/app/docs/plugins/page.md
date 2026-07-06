---
title: "Plugin Ecosystem"
description: "Use server plugins to extend config, request handling, routing, rendering, bundling, HMR, and lifecycle hooks."
section: "Extending"
---

# Plugin Ecosystem

Plugins are the low-level extension surface for Farm itself. Use them when you need to participate in framework lifecycle events: config resolution, route discovery, request handling, rendering, API handlers, HMR, bundling, Nitro output, errors, and shutdown.

Integrations are built on top of plugins. If you are wrapping Stripe, Auth, Resend, Inngest, a UI registry, or a company service, start with an integration. If you are changing how Farm handles requests, pages, builds, or runtime behavior globally, use a plugin.

## Use plugins

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";
import { createCompressionPlugin, createLoggerPlugin } from "@farmjs/core/plugin/server";

export default defineFarmConfig({
  plugins: [
    createLoggerPlugin({}),
    createCompressionPlugin({}),
  ],
});
```

Integration plugins are added before user plugins during config resolution. Every integration is registered as an `enforce: "pre"` plugin, then any extra integration plugins are added, then `farm.config.ts` plugins run.

## Built-in plugins

| Plugin | What it handles |
| --- | --- |
| Logger | Request and lifecycle logging. |
| Compression | Production response encoding. |
| Redirects | Redirect rules from config. |
| Rewrites | Rewrite rules from config. |
| Headers | Response header rules from config. |
| Env helpers | Loading and exposing runtime configuration. |

## Lifecycle surface

Plugins can observe or transform these phases:

| Hook | Purpose |
| --- | --- |
| `init` | Initialize plugin state. |
| `ready` | Run after the plugin manager is ready. |
| `devServerCreated` | Access the Vite dev server. |
| `config` | Return a modified Farm config. |
| `configResolved` | Observe the final resolved config. |
| `buildStart` / `buildEnd` | Run around Farm build work. |
| `routeDiscovered` | Observe every discovered page or layout. |
| `routesGenerated` | Observe the final route graph summary. |
| `middlewareDiscovered` | Observe discovered middleware files. |
| `apiRouteDiscovered` | Observe discovered API route files and methods. |
| `beforeRouteMatch` / `afterRouteMatch` | Observe runtime page route matching. |
| `beforeRender` / `afterRender` | Observe or transform rendered HTML. |
| `beforeApiHandler` / `afterApiHandler` | Transform API `Request` or `Response`. |
| `beforeRequest` / `afterResponse` | Work with Node request/response objects. |
| `hmrUpdate` | Observe hot module updates. |
| `beforeBundle` / `afterBundle` | Run around bundling. |
| `beforeNitroBuild` / `afterNitroBuild` | Modify or observe Nitro build output. |
| `onError` | Capture framework lifecycle errors. |
| `shutdown` | Release resources. |
| `transformHTML` | Transform HTML output. |
| `transformPage` | Transform page components. |

Hooks that return a value can transform the current value when Farm runs them serially. Request hooks that can short-circuit run in deterministic plugin order.

## Ordering

Plugins can set `enforce`:

```ts
export default defineFarmConfig({
  plugins: [
    {
      name: "early",
      enforce: "pre",
    },
    {
      name: "normal",
    },
    {
      name: "late",
      enforce: "post",
    },
  ],
});
```

Farm orders plugins as `pre`, normal, then `post`. Use `pre` when another plugin must see your request context or config changes. Use `post` when you want to observe final output.

## Request context

Plugins can share request-scoped values with other plugins, integrations, and pages.

```ts
import { definePlugin } from "@farmjs/core";
import { randomUUID } from "node:crypto";

export const tracePlugin = definePlugin({
  name: "trace",
  beforeRequest(req, _res, ctx) {
    ctx.requestContext.set(req, "traceId", randomUUID(), {
      exposeToPage: true,
    });

    ctx.requestContext.set(req, "internalToken", "secret");
  },
});
```

Only values marked with `exposeToPage: true` are available to page props through `props.context?.data`.

## Plugin or integration

| Choose | When |
| --- | --- |
| Integration | You are wrapping a product/service and need routes, typed callers, config validation, storage schema, or providers. |
| Plugin | You are changing framework behavior, rendering, routing, request handling, HMR, build output, or global app instrumentation. |
| Both | A product integration needs low-level hooks in addition to its routes and API. Put the product API in the integration and ship extra hooks through `plugins`. |

## Production checklist

- Give every plugin a stable `name`.
- Use `enforce` only when ordering matters.
- Keep request hooks fast because they run on every matching request.
- Do not expose secrets through request context.
- Return transformed `Request`, `Response`, HTML, or config only from hooks that support transforms.
- Release timers, sockets, file watchers, and background workers in `shutdown`.
- Add tests for hook order and transformed output when a plugin changes behavior.
