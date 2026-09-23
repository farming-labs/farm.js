---
title: "Create a Plugin"
description: "Build a typed Farm plugin with private state, request context, Web Request transforms, and framework lifecycle hooks."
section: "Plugin Ecosystem"
---

# Create a Plugin

Build a plugin when behavior belongs to the framework rather than one product integration. Good examples include request tracing, security policy, HTML transforms, route analysis, deployment adapters, development tooling, and global instrumentation.

## Typed API routes

Plugins can own API handlers without creating files in the app's routing directory. Declare
them in `routes`, using the same API request pipeline as file routes:

```ts
import { definePlugin } from "@farm.js/core";
import { z } from "zod";

export const projectRoutes = definePlugin({
  name: "acme:project-routes",
  routes: ({ route }) => {
    const project = route.scope("/api/projects/[projectId]");

    return [
      project.post("uploads/[uploadId]", {
        input: {
          params: z.object({ projectId: z.string(), uploadId: z.string() }),
          body: z.object({ title: z.string().trim().min(1) }),
          query: z.object({ view: z.enum(["summary", "full"]).default("summary") }),
          headers: z.object({ "x-request-id": z.string().optional() }),
        },
        output: z.object({ id: z.string(), title: z.string() }),
        handler(_request, { input }) {
          return { id: input.params.uploadId, title: input.body.title };
        },
      }),
    ];
  },
});
```

Register `projectRoutes` in `defineConfig({ plugins: [projectRoutes] })`. Farm mounts
`POST /api/projects/[projectId]/uploads/[uploadId]`. Scopes are immutable prefix builders;
they do not register a route until you return a method definition. Nested scopes work too.
Paths must be literal, canonical `/api` paths without query strings or trailing slashes.

All `input` fields and `output` are optional. Zod and Standard Schema validators are supported,
including asynchronous refinements and transformations. Handlers receive parsed values and
defaults; callers use the schema's input type for bodies, query strings, and headers. URL
parameters remain strings (or arrays of strings for catch-alls) on the caller side. A params
schema must describe the named parameters in the complete composed path.

Invalid input produces a JSON `400` response before endpoint middleware or the handler runs.
Malformed JSON and the configured request body size limit retain the normal API behavior.
The optional `output` schema validates and transforms plain JSON handler results; an output
validation failure is a server error, not a client `400`. Raw `Response` results bypass output
validation so cookies, files, and streams are not consumed or rewritten. Do not use `output`
to claim a type for arbitrary raw response bodies.

Use the existing endpoint `middleware` array for authentication and authorization. A scoped
project ID is routing data, not proof that the caller owns the project. Runtime plugin hooks,
app middleware, HEAD/405 handling, and response headers still apply in development and Nitro
production output. File and plugin routes may contribute different methods to the same path;
duplicate methods and equivalent dynamic shapes fail registration.
Plugin routes require the default universal production build; the legacy `universal: false`
build fails with an actionable error instead of silently omitting these handlers.

Route factories run synchronously during discovery/build and again at production startup.
Keep paths and methods stable across environments; put per-request decisions in handlers or
middleware. Production checks the runtime table against the build manifest. Restart the dev
server after changing a config-owned plugin factory, and run `farm generate` to refresh checked-in
artifacts. Request-driven registration and hot replacement of config-owned plugin state are not
part of this initial API.

Use `definePlugin()` and retain its inferred return type: annotating the value as the broad
`FarmPlugin` type erases its route literals. The factory and handlers stay server-only. See
[scoped API callers](/docs/api-client#scoped-dynamic-routes) for the generated browser/server caller.
Existing provider integration route factories are unchanged; `routes` here adds handlers to the
plugin interface, not a second integration registry.

## A complete runtime plugin

This plugin creates typed private state, derives typed context for every request, forwards a request ID to the handler, and adds the ID to the response.

**src/plugins/request-tracing.ts**

```ts
import { definePlugin } from "@farm.js/core";
import { randomUUID } from "node:crypto";

type RequestTracingOptions = {
  header?: string;
};

export function requestTracingPlugin(options: RequestTracingOptions = {}) {
  return definePlugin({
    name: "acme:request-tracing",

    setup() {
      return {
        header: options.header ?? "x-request-id",
      };
    },

    runtime: {
      context({ request, req, state }) {
        const requestId = request.headers.get(state.header) ?? randomUUID();

        req.set("requestId", requestId, { exposeToPage: true });
        return { requestId };
      },

      before({ request, ctx, state }) {
        const headers = new Headers(request.headers);
        headers.set(state.header, ctx.requestId);
        return new Request(request, { headers });
      },

      after({ response, ctx, state }) {
        const headers = new Headers(response.headers);
        headers.set(state.header, ctx.requestId);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },

      error({ error, ctx }) {
        console.error("Request failed", {
          requestId: ctx.requestId,
          error,
        });
      },
    },
  });
}
```

`state.header`, `ctx.requestId`, and their return types are inferred without manually supplying generics.

## Register it

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { requestTracingPlugin } from "./src/plugins/request-tracing";

export default defineConfig({
  plugins: [
    requestTracingPlugin({
      header: "x-acme-request-id",
    }),
  ],
});
```

Use a factory when consumers need options. Return `definePlugin()` directly so inference is preserved.

## Add browser behavior

Add `client` when the same framework plugin needs hydration, navigation, browser error, performance, or cleanup hooks. Define those hooks in the same plugin object.

```ts
export function requestTracingPlugin(options: RequestTracingOptions = {}) {
  return definePlugin({
    name: "acme:request-tracing",

    // Server lifecycle hooks stay here.
    runtime: {
      context() {},
    },

    client: {
      public: {
        header: options.header ?? "x-request-id",
      },

      setup({ public: config }) {
        return { header: config.header, navigations: 0 };
      },

      navigation: {
        rendered({ state, to }) {
          state.navigations += 1;
          console.log(state.header, to.pathname);
        },
      },
    },
  });
}
```

Farm extracts the client hooks and generates their runtime registration in development and production. Do not put secrets in `client.public`; it is embedded in application JavaScript. Client hooks cannot close over surrounding server values, so use event data, browser globals, dynamic imports inside a hook, and state returned by `client.setup`. Read [Client Plugins](/docs/plugins/client) for every hook, lifecycle order, cancellation behavior, and packaging rules.

## Choose the plugin's scope

Start local, then package the plugin when more than one application needs the same framework behavior.

| Scope              | Use it for                                                                      |
| ------------------ | ------------------------------------------------------------------------------- |
| Local plugin       | One application's route policy, diagnostics, or temporary framework experiment. |
| Published plugin   | Reusable tracing, security, rendering, build, or development behavior.          |
| Layer plugin       | Organization defaults shipped together with shared config and integrations.     |
| Integration plugin | Low-level framework behavior required internally by one product integration.    |

A published plugin should expose an options factory and keep its setup state private:

**packages/farm-plugin-security/src/index.ts**

```ts
import { definePlugin } from "@farm.js/core";

export interface SecurityPluginOptions {
  frameAncestors?: string;
}

export function securityPlugin(options: SecurityPluginOptions = {}) {
  return definePlugin({
    name: "acme:security",
    version: "1.0.0",

    setup() {
      return {
        frameAncestors: options.frameAncestors ?? "'none'",
      };
    },

    runtime: {
      after({ response, state }) {
        const headers = new Headers(response.headers);
        headers.set("x-content-type-options", "nosniff");
        headers.set("content-security-policy", `frame-ancestors ${state.frameAncestors}`);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },
    },
  });
}
```

Keep the public surface small: export the factory, its options, and any intentionally shared types. Consumers should not need to understand the plugin's internal state or lifecycle wiring.

## Transform config

`configure` runs after Farm loads the app config and before it creates the development or production pipeline. Return only when the plugin needs to replace the current value.

```ts
export const observabilityDefaults = definePlugin({
  name: "acme:observability-defaults",

  configure(config) {
    return {
      ...config,
      observability: config.observability ?? {
        events: true,
        runtime: true,
      },
    };
  },
});
```

Keep config transforms deterministic. Use `enforce: "pre"` or `enforce: "post"` only when another plugin's output is part of your contract.

## Short-circuit a request

Return a `Response` from `runtime.before` to skip Farm's route handler. The response still passes through every `runtime.after` hook.

```ts
export const maintenancePlugin = definePlugin({
  name: "acme:maintenance",

  runtime: {
    before({ request }) {
      const url = new URL(request.url);

      if (process.env.MAINTENANCE === "1" && !url.pathname.startsWith("/health")) {
        return Response.json({ error: "Service temporarily unavailable" }, { status: 503 });
      }
    },
  },
});
```

Authorization plugins may reject requests here, but handlers should still enforce resource-level permissions close to protected data.

## Background work and cancellation

Every runtime event includes the request `signal` and `waitUntil()`.

```ts
runtime: {
  after({ request, response, durationMs, signal, waitUntil }) {
    if (!signal.aborted) {
      waitUntil(
        metrics.write({
          pathname: new URL(request.url).pathname,
          status: response.status,
          durationMs,
        }),
      );
    }
  },
},
```

Do not use `waitUntil()` for work the response depends on. Await required writes in the hook itself.

## Observe routes

The router group handles discovery and page-route matching.

```ts
export const routeReportPlugin = definePlugin({
  name: "acme:route-report",

  setup() {
    return { discovered: 0 };
  },

  router: {
    discovered(route, { state }) {
      state.discovered += 1;
      if (route.kind === "page" || route.kind === "layout") {
        console.log(route.kind, route.pattern);
      } else {
        console.log(route.kind, route.path);
      }
    },

    generated(summary, { state }) {
      console.log("Route entries", state.discovered);
      console.log("Pages", summary.pageCount);
    },

    after(result) {
      if (!result.matched) {
        console.log("Page miss", result.pathname);
      }
    },
  },
});
```

`discovered` receives page, layout, middleware, and API route records. Narrow with `route.kind` before reading kind-specific fields.

## Transform rendered HTML

Use `render.before` for route-aware setup and `render.html` to return changed HTML.

```ts
export const htmlMarkerPlugin = definePlugin({
  name: "acme:html-marker",

  render: {
    html(html, render) {
      if (render.pathname.startsWith("/docs")) {
        return html.replace("</head>", '<meta name="docs-runtime" content="farm"></head>');
      }
    },
  },
});
```

HTML transforms require Farm to buffer the rendered document before sending it. Keep streaming intact by using `render.before` when no HTML rewrite is required.

## Extend builds

Build hooks receive the state returned by `setup`.

```ts
export const deploymentReportPlugin = definePlugin({
  name: "acme:deployment-report",

  setup() {
    return { startedAt: Date.now() };
  },

  build: {
    before(bundle, { state }) {
      console.log("Building", bundle.preset, state.startedAt);
    },

    configure(nitroConfig) {
      return {
        ...nitroConfig,
        sourceMap: true,
      };
    },

    after(result) {
      console.log("Build complete", result.success);
    },
  },
});
```

`setup` can run in a build manager and again in a deployed runtime. Keep it deterministic and avoid assuming it represents one global process forever.

## Development hooks

```ts
export const devInspectorPlugin = definePlugin({
  name: "acme:dev-inspector",

  dev: {
    server(vite) {
      console.log("Dev server", vite.config.root);
    },

    update(update) {
      console.log("Updated", update.file, update.modules);
    },
  },
});
```

Development hooks are not bundled into the production request lifecycle.

## Start and close resources

Use `runtime.start` for runtime-only startup and `runtime.close` for plugin cleanup. Long-running Node output completes startup before listening and invokes close after active requests and streams drain.

```ts
export const queuePlugin = definePlugin({
  name: "acme:queue",

  setup() {
    return { client: createQueueClient() };
  },

  runtime: {
    async start({ state }) {
      await state.client.connect();
    },

    async close({ state, reason }) {
      await state.client.close();
      console.log("Queue closed", reason);
    },
  },
});
```

Use `context.lifecycle.onShutdown()` when setup creates a resource that should be disposed independently of the plugin's structured runtime hooks:

```ts
export const redisPlugin = definePlugin({
  name: "acme:redis",

  setup({ lifecycle }) {
    const redis = createRedisClient();
    lifecycle.onShutdown(() => redis.quit());
    return { redis };
  },
});
```

Farm runs registered disposers once, in reverse registration order, after attempting every plugin shutdown hook. One failing hook does not prevent later hooks or resource disposers from running.

Request-driven serverless and edge hosts may initialize lazily and may not expose a reliable shutdown event. Correctness must not depend solely on cleanup hooks there; use transactions, leases, and idempotent queue handling for externally visible work.

## Context rules

- `runtime.context` must return a plain object or nothing.
- Farm merges context from all plugins before `runtime.before`.
- Duplicate top-level context keys fail the request and name both owners.
- `ctx` is server-only and read-only at the top level.
- `req` is the shared mutable request store.
- Only `req.set(key, value, { exposeToPage: true })` exposes data to page props.
- Returning a new `Request` preserves both `ctx` and `req` for later hooks.

## Legacy compatibility

Flat hooks continue to work for existing plugins:

| Legacy hook                                         | Structured hook                                    |
| --------------------------------------------------- | -------------------------------------------------- |
| `config`                                            | `configure`                                        |
| `ready` / `shutdown`                                | `runtime.start` / `runtime.close`                  |
| `beforeRequest` / `beforeApiHandler`                | `runtime.before`                                   |
| `afterResponse` / `afterApiHandler`                 | `runtime.after`                                    |
| `routeDiscovered` / `routesGenerated`               | `router.discovered` / `router.generated`           |
| `beforeRouteMatch` / `afterRouteMatch`              | `router.before` / `router.after`                   |
| `beforeRender` / `afterRender`                      | `render.before` / `render.html`                    |
| `beforeBundle` / `beforeNitroBuild` / `afterBundle` | `build.before` / `build.configure` / `build.after` |
| `devServerCreated` / `hmrUpdate`                    | `dev.server` / `dev.update`                        |

Do not define both the legacy and structured form of the same phase in one plugin. Farm intentionally executes both for compatibility.

## Testing checklist

- Verify `setup` state and `runtime.context` inference with a type test.
- Test `pre`, normal, and `post` hook order.
- Test transformed requests, responses, status codes, headers, and bodies.
- Test a `runtime.before` short circuit and confirm `runtime.after` still runs.
- Test context-key collisions and error-hook failures.
- Test page HTML transforms separately from API responses.
- Test client hydration, navigation, cancellation, browser errors, and reverse-order cleanup when the plugin has a client module.
- Run the plugin against both the dev server and a production preset build.
