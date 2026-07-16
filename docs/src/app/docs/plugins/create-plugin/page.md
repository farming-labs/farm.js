---
title: "Create a Plugin"
description: "Build a plugin with definePlugin when app behavior belongs in reusable framework lifecycle hooks."
section: "Extending"
---

# Create a Plugin

Build a plugin when the behavior belongs to the framework runtime instead of one product integration. Plugins are good for instrumentation, HTML transforms, request IDs, security headers, build adapters, custom route discovery reporting, and runtime debugging.

## Define a plugin

**src/lib/request-id-plugin.ts**

```ts
import { definePlugin } from "@farmjs/core";
import { randomUUID } from "node:crypto";

export const requestIdPlugin = definePlugin({
  name: "request-id",
  beforeRequest(req, _res, ctx) {
    const header = req.headers["x-request-id"];
    const requestId = Array.isArray(header) ? header[0] : header || randomUUID();

    ctx.req.set("request.id", requestId, {
      exposeToPage: true,
    });
  },
});
```

## Register it

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";
import { requestIdPlugin } from "./src/lib/request-id-plugin";

export default defineFarmConfig({
  plugins: [requestIdPlugin],
});
```

## Add options

Make plugins factory functions when users should configure them.

**src/lib/security-headers-plugin.ts**

```ts
import { definePlugin } from "@farmjs/core";

type SecurityHeadersOptions = {
  frameAncestors?: string;
};

export function securityHeadersPlugin(options: SecurityHeadersOptions = {}) {
  return definePlugin({
    name: "security-headers",
    afterApiHandler(response) {
      const headers = new Headers(response.headers);

      headers.set("x-content-type-options", "nosniff");
      headers.set("x-frame-options", "DENY");

      if (options.frameAncestors) {
        headers.set("content-security-policy", `frame-ancestors ${options.frameAncestors}`);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  });
}
```

## Transform config

Use `config` to modify config before it is resolved. Return the updated config.

```ts
export const observabilityDefaults = definePlugin({
  name: "observability-defaults",
  config(config) {
    return {
      ...config,
      observability: config.observability ?? {
        events: true,
        runtime: true,
      },
    };
  },
  configResolved(config) {
    console.log("Observability enabled:", Boolean(config.observability));
  },
});
```

Keep config transforms predictable. If two plugins edit the same field, ordering matters.

## Transform API requests

`beforeApiHandler` can return a new `Request`. `afterApiHandler` can return a new `Response`.

```ts
export const apiTracePlugin = definePlugin({
  name: "api-trace",
  beforeApiHandler(request, api, ctx) {
    ctx.req.set("api.traceId", crypto.randomUUID());

    const headers = new Headers(request.headers);
    headers.set("x-farm-route", api.routePath || api.pathname);

    return new Request(request, {
      headers,
    });
  },
  afterApiHandler(response) {
    const headers = new Headers(response.headers);
    headers.set("x-powered-by", "farm");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
});
```

`ctx.req` stays attached when a plugin returns a transformed `Request`, so later plugins and the API handler can read the same request data.

## Transform HTML

Use `afterRender` when you need route-aware HTML changes. Use `transformHTML` for a general HTML transform.

```ts
export const htmlMarkerPlugin = definePlugin({
  name: "html-marker",
  afterRender(html, render) {
    if (render.pathname.startsWith("/docs")) {
      return html.replace("</body>", '<meta name="docs-runtime" content="farm"></body>');
    }
  },
});
```

## Observe routes and builds

Plugins can gather metadata from route discovery and build hooks.

```ts
export const routeManifestPlugin = definePlugin({
  name: "route-manifest",
  routesGenerated(payload) {
    console.log("Pages:", payload.pageCount);
    console.log("Layouts:", payload.layoutCount);
  },
  apiRouteDiscovered(route) {
    console.log("API route:", route.path, route.methods);
  },
  beforeBundle(bundle) {
    console.log("Bundling for:", bundle.preset);
  },
  afterBundle(result) {
    console.log("Bundle success:", result.success);
  },
});
```

## Handle HMR

In development, `hmrUpdate` receives changed file and module IDs.

```ts
export const hmrDebugPlugin = definePlugin({
  name: "hmr-debug",
  hmrUpdate(update) {
    console.log("Updated file:", update.file);
    console.log("Modules:", update.modules);
  },
});
```

## Shutdown cleanup

Use `shutdown` for long-lived resources.

```ts
export function intervalPlugin() {
  let interval: ReturnType<typeof setInterval> | undefined;

  return definePlugin({
    name: "interval",
    ready() {
      interval = setInterval(() => {
        console.log("tick");
      }, 30_000);
    },
    shutdown(payload) {
      if (interval) {
        clearInterval(interval);
      }

      console.log("shutdown reason:", payload.reason);
    },
  });
}
```

## Expose data to pages

Only explicitly exposed request context values appear on page props.

**src/lib/trace-plugin.ts**

```ts
export const tracePlugin = definePlugin({
  name: "trace",
  beforeRequest(_req, _res, ctx) {
    ctx.req.set("traceId", "trace_123", {
      exposeToPage: true,
    });

    ctx.req.set("secret", "do-not-expose");
  },
});
```

**src/app/dashboard/page.tsx**

```tsx
import type { PageProps } from "@farmjs/core";

export default function DashboardPage(props: PageProps) {
  const traceId = props.context?.data.get("traceId");

  return <p>{traceId}</p>;
}
```

## Hook behavior

- `config`, `beforeApiHandler`, `afterApiHandler`, `afterRender`, `beforeNitroBuild`, `transformHTML`, and `transformPage` can return transformed values.
- `beforeRequest` and `afterResponse` run sequentially because they work with mutable Node request and response objects.
- `beforeRequest` can short-circuit by ending the response.
- Other observational hooks can run in parallel.
- `enforce: "pre"` runs before normal plugins. `enforce: "post"` runs after normal plugins.

## Testing checklist

- Test hook order when using `enforce`.
- Test transformed requests, responses, HTML, or config values.
- Test request context exposure with and without `exposeToPage`.
- Test cleanup by running the `shutdown` hook.
- Test that request hooks do not run unnecessary work after a response is already ended.
