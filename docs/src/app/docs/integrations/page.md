---
title: "Integrations"
description: "Register services once, get owned routes, typed callers, agent runtimes, providers, middleware, storage access, lifecycle hooks, and validation."
section: "Integrations"
---

# Integrations

Integrations are the Farm layer for connecting product services to your app. A payment provider, auth system, email service, job runner, API-key platform, UI registry, or internal company SDK can register everything it owns in one place: route handlers, typed client/server callers, request middleware, React providers, storage schemas, lifecycle hooks, and runtime logs.

Farm treats every integration as a small server plugin. That means an integration can participate in framework startup and shutdown, own HTTP routes, and still expose a compact typed API to the rest of the app.

## Register integrations

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { stripe } from "@farm.js/integrations/stripe";
import { betterAuth } from "@farm.js/integrations/better-auth";

export default defineConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    }),
    auth: betterAuth({
      baseURL: process.env.BETTER_AUTH_URL,
      secret: process.env.BETTER_AUTH_SECRET,
    }),
  },
});
```

The object key is the application namespace. If you register Stripe as `billing`, the typed caller lives at `api.billing`. If you register it as `stripe`, it lives at `api.stripe`.

## Create callers

**src/lib/api.ts**

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>({
  data: {
    appName: "farm-dashboard",
  },
});
```

`apiClient` is the browser caller. `api` is the server caller. Both preserve the same integration namespace so a route like `/api/billing/checkout` can become `api.billing.checkout.post(...)`, and a single-method endpoint can be called directly when there is only one method.

## Integration surface

An integration can contribute any of these pieces. The three HTTP fields are alternatives for
different authoring needs; you normally do not define all three.

| HTTP field  | Handles requests? | Produces typed callers?                    | Use it when                                                                                                                             |
| ----------- | ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `routes`    | Yes               | Yes, when entries use `integrationRoute.*` | The integration owns the handlers and a flat array or route factory is easiest to read. This is the recommended default.                |
| `endpoints` | Yes               | Yes, when entries use `endpoint.*`         | The integration owns the handlers, but a nested object makes a large set of routes easier to organize. Farm flattens it into `routes`.  |
| `api`       | No                | Yes                                        | The HTTP handlers already exist elsewhere, or you deliberately need a custom caller tree. It is a caller contract, not a route handler. |

For typed `routes` and `endpoints`, Farm derives the caller tree from each URL. For example,
`/api/billing/checkout` becomes `api.billing.checkout.post(...)` after the integration is registered
as `billing`. The object keys inside `endpoints` only organize the source code; they do not rename
the derived caller.

Plain route objects still mount handlers, but they do not carry typed caller metadata. Use
`integrationRoute.*` or the `endpoint.*` factory when you want Farm to infer request and response
types for `api` and `apiClient`.

An explicit `api` field replaces that derived caller tree for the integration. It does not mount an
HTTP handler, so every operation in it must point to a route implemented by `routes`, `endpoints`,
the app, or another server.

The `api:` field in an integration definition is the **caller contract**. The `api` returned by
`createIntegrations` is the **server caller** built from that contract; `apiClient` is its browser
counterpart. See [Choosing `routes`, `endpoints`, or `api`](/docs/integrations/custom#choose-the-http-surface)
for side-by-side examples.

Other integration fields are independent of that HTTP choice:

| Surface               | What it is for                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `middleware`          | Integration-owned request behavior for matchers outside a single endpoint.                          |
| `providers`           | React provider metadata and optional wrapper components.                                            |
| `schema`              | Storage models used by `ctx.args.db` through the ORM layer.                                         |
| `config`              | Schema-validated config from defaults, env, input, and resolver output.                             |
| `validate`            | Early checks before the integration starts.                                                         |
| `setup`               | Bootstrapping work such as storage checks or webhook registration.                                  |
| `ready`               | Post-start work once the app is ready.                                                              |
| `dispose`             | Shutdown cleanup.                                                                                   |
| `log`                 | Runtime events for registration, request start, request end, request error, and lifecycle messages. |
| `plugins`             | Extra Farm plugins that ship with the integration.                                                  |
| `documentNavigations` | Route matchers that tell docs/navigation systems where the integration owns pages.                  |

## Route ownership

Integration handlers declared through either `routes` or `endpoints` use the same web primitives as
normal route handlers. The handler receives the `Request` and a context object with params, parsed
input, request metadata, shared request context, integration metadata, and `args` for storage.

**src/integrations/local-demo.ts**

```ts
import { defineIntegration, integrationRoute } from "@farm.js/core";
import { z } from "zod";

export const localDemo = defineIntegration({
  category: "custom",
  type: "local-demo",
  instance: {},
  routes: [
    integrationRoute.post<
      "/api/local-demo/messages",
      { message: string },
      { message: string; count: number },
      { count: number }
    >("/api/local-demo/messages", {
      body: z.object({
        message: z.string().min(2),
      }),
      query: z.object({
        count: z.coerce.number().int().positive(),
      }),
      handler(_request, ctx) {
        return Response.json({
          message: ctx.input.body?.message,
          count: ctx.input.query?.count ?? 1,
        });
      },
    }),
  ],
});
```

Farm validates the body and query before route middleware, `before` hooks, or the handler run. Invalid input returns a `400` response with validation issues.

## Caller shape

Typed routes derive their caller tree from their path, so this integration does not need an explicit
`api` field:

**src/lib/api.ts**

```ts
import { createIntegrations } from "@farm.js/core/client";
import { localDemo } from "../integrations/local-demo";

export const { api, apiClient } = createIntegrations({
  localDemo,
});
```

**client component**

```tsx
"use client";

import { apiClient } from "../lib/api";

export function SendMessageButton() {
  async function send() {
    const result = await apiClient.localDemo.messages.post({
      body: {
        message: "hello",
      },
      query: {
        count: 2,
      },
    });

    if (result.error) {
      throw result.error;
    }

    console.log(result.data.message);
  }

  return <button onClick={send}>Send</button>;
}
```

**server code**

```ts
import { api } from "../lib/api";

export async function loadMessage() {
  const result = await api.localDemo.messages.post({
    body: {
      message: "server hello",
    },
  });

  return result.data;
}
```

On the server, Farm first tries to dispatch to the registered integration runtime directly. If no runtime is available, it falls back to `fetch` with forwarded request headers.

## Agent runtimes

Agent integrations connect a provider runtime to the Farm lifecycle without replacing that provider's SDK. Farm starts the runtime beside the app in development, owns its same-origin route prefixes, and composes supported production output. The client still uses the provider-native hooks and typed RPC APIs.

```ts
import { defineConfig } from "@farm.js/core";
import { eve } from "@farm.js/eve";

export default defineConfig({
  integrations: {
    agent: eve(),
  },
});
```

`agent` is a conventional namespace, not a reserved key. Agent runtime routes do not generate `api` or `apiClient` callers because streaming and WebSocket protocols are handled by the provider SDK.

| Runtime                                          | Farm manages                                                                                             | Application uses                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Eve](/docs/integrations/eve)                    | Eve development process, `/eve` and workflow routes, Vercel build composition.                           | `agent/` files and `useEveAgent()`.                                     |
| [Cloudflare Agents](/docs/integrations/cf-agent) | Wrangler development process, `/agents` WebSocket proxy, combined Worker output and deployment metadata. | Agent classes, Durable Object bindings, `useAgent()`, and callable RPC. |

Same-origin routing is not an authorization boundary. Authenticate agent HTTP and WebSocket requests in application middleware or provider routing hooks, and authorize every sensitive tool or callable method on the server.

## Shared data

`createIntegrations({ data })` adds small per-call metadata to integration requests. It is useful for tenant IDs, locale, analytics context, or feature flags.

```ts
export const { apiClient } = createIntegrations<AppIntegrations>({
  data: {
    tenantId: "tenant_123",
    locale: "en",
  },
});

await apiClient.billing.checkout.post(
  {
    body: {
      priceId: "price_123",
    },
  },
  {
    data: {
      source: "settings-page",
    },
  },
);
```

The route reads that value from `ctx.data`. Browser-provided data is client controlled, size limited, and sanitized before it reaches the handler. Validate it before using it for authorization.

## Built-in groups

| Group     | Built-ins                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Payment   | Stripe, Autumn, and Polar expose checkout, subscription, portal, webhook, entitlement, and billing snapshot patterns.    |
| Auth      | Better Auth, Auth.js, Clerk, Auth0, WorkOS, and Supabase expose routes, providers, session helpers, and auth middleware. |
| Messaging | Resend sends transactional mail, previews templates, and receives provider webhooks.                                     |
| Workflows | Trigger.dev and Inngest expose trigger, schedule, batch, status, and cancel APIs.                                        |
| Agents    | Eve and Cloudflare Agents run beside Farm in development and compose with supported deployment targets.                  |
| API Keys  | Unkey can create, verify, revoke, update, and delete customer or service keys.                                           |
| Interface | UI registry entries scaffold shadcn-style integration screens when `--ui` is enabled.                                    |
| Storage   | ORM storage gives schema-backed integrations a provider-neutral `ctx.args.db`.                                           |

## When to build your own

Create a custom integration when a service needs one or more of these:

- Routes or webhooks that should be mounted automatically.
- Typed client/server functions that should not be hand-written in each app.
- Config validation that should fail during startup.
- Storage models shared by routes, hooks, and built-in UI.
- Request middleware that belongs to the service.
- Setup or teardown work such as webhook registration, queue consumers, or health checks.

For the full authoring interface, see [Custom Integrations](/docs/integrations/custom).
