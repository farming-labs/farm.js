---
title: "Plugin Ecosystem"
description: "Extend Farm's server and browser lifecycle with typed runtime, router, render, build, navigation, and development hooks."
section: "Plugin Ecosystem"
---

# Plugin Ecosystem

Plugins are Farm's framework extension surface. Use a plugin to change how Farm configures an app, handles requests, discovers routes, renders HTML, builds output, observes browser hydration and navigation, or responds to development events.

Use an [integration](/docs/integrations) for a product or service such as authentication, payments, email, analytics, or a database. Integrations own product config, endpoints, typed callers, and providers. Plugins own framework lifecycle behavior.

## Official plugins

| Plugin                             | Purpose                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Analyzer](/docs/plugins/analyzer) | Explain page, client, and server build size and enforce readable CI limits.                    |
| [PWA](/docs/plugins/pwa)           | Generate a route-aware service worker for offline navigation, caching, and safe updates.       |
| [Sentry](/docs/plugins/sentry)     | Report server errors with Farm event and route context, trace requests, and flush on shutdown. |

Each published plugin has its own setup page in this section. Use [Create a Plugin](/docs/plugins/create-plugin) when the behavior is specific to your application or package.

## Plugin authoring

Start with [Create a Plugin](/docs/plugins/create-plugin) for the server and build lifecycle. Add the [Client Plugin API](/docs/plugins/client) only when the plugin also needs browser hydration, navigation, error, performance, or cleanup hooks. Client plugins are an authoring capability, not a separately installed package.

## What framework-focused means

A framework-focused plugin changes **how Farm operates**, rather than adding one application's business feature. It runs at stable framework boundaries and can be reused across unrelated applications.

| Question                                                                                    | Usually choose |
| ------------------------------------------------------------------------------------------- | -------------- |
| Does it observe or transform every request, response, route, render, or build?              | Plugin         |
| Does it wrap a product and expose config, endpoints, storage, providers, or a typed client? | Integration    |
| Is it request policy owned by one application or route tree?                                | Middleware     |
| Is it a shared application foundation containing config, routes, integrations, and plugins? | Layer          |

For example, request tracing is framework-focused because it should work for pages, APIs, actions, docs, and integrations without knowing their business logic. A Stripe checkout extension is product-focused because it owns Stripe config, webhook endpoints, and a typed API.

## What plugins can build

The lifecycle is intentionally broad enough for infrastructure and tooling without turning plugins into product modules.

| Category             | Example plugin                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Observability        | Create trace IDs, record latency, export spans, or report route failures.                     |
| Security             | Apply CSP and security headers, enforce request policy, or attach nonces.                     |
| Traffic              | Implement global redirects, rewrites, compression, maintenance mode, or response tagging.     |
| Routing              | Generate route manifests, enforce route conventions, or report conflicting patterns.          |
| Rendering            | Inject metadata, transform final HTML, or measure server rendering.                           |
| Browser runtime      | Observe hydration, navigation, errors, performance entries, and cleanup.                      |
| Deployment           | Configure Nitro output, add platform metadata, or validate runtime capabilities.              |
| Development          | Add a route inspector, HMR diagnostics, performance reporting, or custom dev-server behavior. |
| Organization tooling | Package shared logging, security, and build policy for every company application.             |

A plugin can cover several lifecycle phases, but focused plugins are easier to order, test, and reuse. Product endpoints and typed product callers should remain in an integration even when that integration contributes a plugin internally.

## Register a plugin

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { requestTracingPlugin } from "./src/plugins/request-tracing";

export default defineConfig({
  plugins: [requestTracingPlugin()],
});
```

## Interface

`definePlugin()` infers private setup state and request context across the plugin.

```ts
import { definePlugin } from "@farm.js/core";

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

  client: {
    public: { release: "2026.07" },
    setup({ public: config }) {
      return { release: config.release };
    },
    navigation: {
      rendered({ state, to }) {
        console.log(state.release, to.pathname);
      },
    },
  },
});
```

Only define the groups your plugin needs.

| Surface     | Purpose                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| `configure` | Transform Farm config before the development or production pipeline is created. |
| `setup`     | Create private, typed plugin state for one plugin manager.                      |
| `runtime`   | Wrap Web `Request` and `Response` handling.                                     |
| `router`    | Observe route discovery, generation, and matching.                              |
| `render`    | Observe rendering or transform final HTML.                                      |
| `build`     | Run around bundling and configure the Nitro build.                              |
| `dev`       | Access the Vite server and HMR updates.                                         |
| `client`    | Define browser setup, hydration, navigation, errors, performance, and cleanup.  |

## Complete lifecycle reference

### Plugin definition

| Property    | Required | Behavior                                                                               |
| ----------- | -------- | -------------------------------------------------------------------------------------- |
| `name`      | Yes      | Stable plugin identity. Package authors should namespace it, such as `acme:security`.  |
| `version`   | No       | Optional plugin version metadata for package authors and tooling.                      |
| `enforce`   | No       | Places the plugin in the `pre` or `post` ordering group. Omit it for normal order.     |
| `configure` | No       | Receives Farm config before pipeline creation and may return replacement config.       |
| `setup`     | No       | Runs once per plugin manager and returns private state inferred by every grouped hook. |
| `runtime`   | No       | Handles portable Web `Request` and `Response` lifecycle work.                          |
| `router`    | No       | Observes route discovery, route graph generation, and page matching.                   |
| `render`    | No       | Observes page rendering and may transform final HTML.                                  |
| `build`     | No       | Observes bundling and may configure the Nitro build.                                   |
| `dev`       | No       | Accesses the Vite development server and HMR updates.                                  |
| `client`    | No       | Defines the browser lifecycle and explicitly public client data.                       |

Both hooks receive Farm's plugin context. `setup` additionally receives the resolved `env`. Its returned state is private to that plugin instance and is not serialized to the browser.

### Runtime hooks

| Hook              | Runs                                                         | May return                                                       |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `runtime.start`   | Once when the runtime manager starts.                        | Nothing.                                                         |
| `runtime.context` | At the start of every request.                               | A plain object merged into typed request `ctx`.                  |
| `runtime.before`  | Before Farm invokes the matched handler.                     | A replacement `Request`, a short-circuit `Response`, or nothing. |
| `runtime.after`   | After a handler or short circuit produces a response.        | A replacement `Response` or nothing.                             |
| `runtime.error`   | When runtime context, before, handler, or after work throws. | Nothing.                                                         |
| `runtime.close`   | During graceful shutdown in long-running Node output.        | Nothing.                                                         |

Runtime hooks apply to page, API, server-action, integration, docs, asset, and general requests. Use the event's `kind` and `route` values when behavior should apply only to part of the application.

### Runtime event values

| Value         | Available in                  | Meaning                                                                     |
| ------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `request`     | Context, before, after, error | Current Web `Request`, including transformations from earlier plugins.      |
| `response`    | After                         | Current Web `Response`, including transformations from earlier plugins.     |
| `state`       | Every grouped hook            | Private value returned by this plugin's `setup`.                            |
| `ctx`         | Before, after, error          | Read-only merge of all plugin request-context results.                      |
| `req`         | Context, before, after, error | Mutable request store shared with middleware and server rendering.          |
| `kind`        | Runtime request hooks         | Request category such as `page`, `api`, `action`, `integration`, or `docs`. |
| `route`       | Runtime request hooks         | Matched pathname, route pattern, and params when Farm has them.             |
| `signal`      | Runtime request hooks         | Abort signal for cancelled or disconnected requests.                        |
| `waitUntil()` | Runtime request hooks         | Registers non-blocking work with hosts that support background tasks.       |
| `durationMs`  | After, error                  | Elapsed request time at that lifecycle phase.                               |

### Router hooks

| Hook                | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `router.discovered` | Observe each page, layout, middleware, or API route as Farm discovers it. |
| `router.generated`  | Inspect the completed page/layout route summary.                          |
| `router.before`     | Observe a pathname and method before page-route matching.                 |
| `router.after`      | Inspect the match result, params, route pattern, and layouts.             |

Router hooks are useful for diagnostics, conventions, manifests, and instrumentation. They should not silently replace application authorization or handler-level validation.

### Render hooks

| Hook            | Purpose                                           | May return                   |
| --------------- | ------------------------------------------------- | ---------------------------- |
| `render.before` | Observe the matched page before rendering starts. | Nothing.                     |
| `render.html`   | Inspect or transform the completed HTML document. | Replacement HTML or nothing. |

Adding `render.html` requires Farm to buffer the final document. Prefer `render.before` when observation is enough and preserving streaming matters.

### Build hooks

| Hook              | Purpose                                                                           | May return                           |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| `build.before`    | Observe the root, preset, output paths, and universal-build mode before bundling. | Nothing.                             |
| `build.configure` | Read or transform the Nitro build configuration.                                  | Replacement build config or nothing. |
| `build.after`     | Observe build success and resolved output information.                            | Nothing.                             |

### Development hooks

| Hook         | Purpose                                                      |
| ------------ | ------------------------------------------------------------ |
| `dev.server` | Access the created Vite development server.                  |
| `dev.update` | Observe changed files and invalidated module IDs during HMR. |

Development hooks do not run as part of the deployed request lifecycle.

## Client lifecycle

The optional `client` property keeps browser behavior under the same plugin identity and ordering as its server hooks. Farm extracts the known lifecycle hooks into its generated browser runtime without copying the server plugin, server setup state, or private environment values.

```ts
client: {
  public: {
    release: "2026.07",
  },
  setup({ public: config }) {
    return { release: config.release };
  },
  navigation: {
    rendered({ state, to }) {
      console.log(state.release, to.pathname);
    },
  },
},
```

Farm runs `client.setup` once, surrounds initial hydration, emits navigation phases from the active router, isolates hook failures, aborts superseded navigation sessions, and closes plugins during page hide or HMR disposal.

Only JSON-safe values in `client.public` enter the browser bundle. Server setup state, request context, and private environment values never cross this boundary. See [Client Plugins](/docs/plugins/client) for the complete interface and security model.

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

| Value   | Lifetime       | Use                                                                                     |
| ------- | -------------- | --------------------------------------------------------------------------------------- |
| `state` | Plugin manager | Clients, compiled matchers, loggers, or other resources returned by `setup`.            |
| `ctx`   | One request    | Typed values returned by `runtime.context`.                                             |
| `req`   | One request    | A shared key/value store for plugins, middleware, integrations, and optional page data. |

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

| Choose      | When                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration | The extension represents a product or service and needs validated config, endpoints, typed callers, storage, or providers.                     |
| Plugin      | The extension changes framework requests, rendering, routing, builds, HMR, or global instrumentation.                                          |
| Both        | A product integration also needs framework hooks. Keep the product API in the integration and expose its framework behavior through `plugins`. |

## How the ecosystem composes

Plugins can be local to one repository, published as packages, bundled by a [Farm layer](/docs/layers), or contributed internally by an integration. They all enter the same ordered lifecycle.

```ts
import { defineConfig } from "@farm.js/core";
import { securityPlugin } from "@acme/farm-plugin-security";
import { tracingPlugin } from "@acme/farm-plugin-tracing";
import { routePolicyPlugin } from "./src/plugins/route-policy";

export default defineConfig({
  plugins: [
    securityPlugin({ csp: true }),
    tracingPlugin({ service: "storefront" }),
    routePolicyPlugin,
  ],
});
```

Each plugin owns its private `state`. At runtime, `ctx` is the read-only aggregate of plugin context results, while `req` is the explicit mutable request store shared with other server lifecycle code. Use stable, namespaced plugin names and context keys so independently published plugins compose without hidden shared globals or collisions.

## Built-in plugins

Farm includes plugins for logging, compression, redirects, rewrites, headers, and environment helpers. Register them from `@farm.js/core/plugin/server`.

The production compression plugin negotiates Brotli or gzip from `Accept-Encoding`, streams the
encoded response body, adds `Vary: Accept-Encoding`, and removes the identity `Content-Length`.
Responses that are already encoded, partial, marked `no-transform`, or sent as server-sent events
are left unchanged.

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
- Release timers, sockets, and watchers in `runtime.close`. Long-running Node output invokes it for handled shutdown signals; serverless and edge hosts remain platform-specific.
- Test server and client hook ordering, short circuits, transformed bodies and headers, context collisions, hydration, SPA navigation, and production output.

Continue with [Create a Plugin](/docs/plugins/create-plugin) for complete examples.
