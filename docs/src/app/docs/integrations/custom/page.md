---
title: "Custom Integrations"
description: "Build a first-class Farm integration with typed APIs, route handlers, lifecycle hooks, config validation, middleware, providers, storage schemas, and runtime logs."
section: "Integrations"
---

# Custom Integrations

Use a custom integration when a service is bigger than a helper function. A good integration owns the contract between the app and the service: config, routes, typed callers, storage, lifecycle checks, request behavior, and any UI/provider setup the app needs.

Farm integrations are declared with `defineIntegration`. They are registered in `farm.config.ts`, then Farm turns them into pre-plugins during config resolution.

## Minimal integration

**src/integrations/acme.ts**

```ts
import { defineIntegration, integrationRoute } from "@farmjs/core";

export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  routes: [
    integrationRoute.get("/api/acme/status", {
      handler() {
        return Response.json({
          ok: true,
        });
      },
    }),
  ],
});
```

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";
import { acme } from "./src/integrations/acme";

export default defineConfig({
  integrations: {
    acme,
  },
});
```

The route is now mounted at `/api/acme/status`. Because it was created with `integrationRoute.get`, Farm can also derive the callable API shape.

## Choose the HTTP surface

`routes`, `endpoints`, and `api` are not three steps that every integration must configure. They
describe two different responsibilities:

```text
typed routes or endpoints -> mount HTTP handlers -> derive api and apiClient callers
plain route objects       -> mount HTTP handlers only
api                       -> describe callers only; no HTTP handler is mounted
```

| Field       | Runtime responsibility                                                       | Caller names come from                                       | Best use                                                                  |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `routes`    | Mounts a flat list of handlers.                                              | The route URL when you use `integrationRoute.*`.             | Most integrations. Start here.                                            |
| `endpoints` | Recursively flattens an object of handlers into `routes` and mounts them.    | The route URL when you use `endpoint.*`, not the object key. | Large integrations that are clearer when handlers are grouped by feature. |
| `api`       | Defines typed operations that call existing URLs. It never mounts a handler. | The keys in the `api` object.                                | Routes implemented elsewhere, or a deliberately customized caller tree.   |

A plain object in `routes` or `endpoints` still mounts its handler. Only the typed
`integrationRoute.*` and `endpoint.*` builders attach the operation metadata Farm needs to infer
`api` and `apiClient` request and response types.

The three formats below are alternatives. Each example exports an integration named `billing` and
uses the same registration and caller setup.

### Shared registration

Register the integration once. The `billing` key becomes the first segment after `api` or
`apiClient`.

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";
import { billing } from "./src/integrations/billing";

export default defineConfig({
  integrations: {
    billing,
  },
});
```

Create the browser and server callers once as well:

**src/lib/integrations.ts**

```ts
import { createIntegrations } from "@farmjs/core/client";
import type { billing } from "../integrations/billing";

type AppIntegrations = {
  billing: typeof billing;
};

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

`apiClient` is the browser caller. `api` is the server caller; it dispatches directly to a
registered integration handler when possible and falls back to `fetch` when no runtime is
available.

### 1. `routes`: flat owned handlers

Use `routes` when the integration owns the HTTP handlers and a flat list is easy to read. This is
the recommended default.

**src/integrations/billing.ts**

```ts
import { defineIntegration, integrationRoute } from "@farmjs/core";
import { z } from "zod";

export const billing = defineIntegration({
  category: "payment",
  type: "acme-billing",
  instance: {},
  routes: [
    integrationRoute.post<"/api/billing/checkout", { priceId: string }, { url: string }>(
      "/api/billing/checkout",
      {
        body: z.object({ priceId: z.string() }),
        handler(_request, ctx) {
          return Response.json({
            url: `https://checkout.example/${ctx.input.body!.priceId}`,
          });
        },
      },
    ),
  ],
});
```

Farm mounts `POST /api/billing/checkout` and derives the caller from that URL.

**client code**

```tsx
"use client";

import { apiClient } from "../lib/integrations";

export async function startCheckout() {
  const result = await apiClient.billing.checkout.post({
    body: { priceId: "price_123" },
  });

  if (result.error) throw result.error;
  return result.data;
}
```

**server code**

```ts
import { api } from "../lib/integrations";

export async function startCheckoutOnServer() {
  const result = await api.billing.checkout.post({
    body: { priceId: "price_123" },
  });

  if (result.error) throw result.error;
  return result.data;
}
```

Both calls have typed input, typed `data`, and typed `error`. The Zod body schema also validates the
incoming request at runtime.

### 2. `endpoints`: grouped owned handlers

Use `endpoints` when the integration still owns the handlers, but an object is easier to organize
than a flat list.

**src/integrations/billing.ts**

```ts
import { defineIntegration } from "@farmjs/core";
import { z } from "zod";

export const billing = defineIntegration({
  category: "payment",
  type: "acme-billing",
  instance: {},
  endpoints: ({ endpoint }) => ({
    checkout: endpoint.post<"/api/billing/checkout", { priceId: string }, { url: string }>(
      "/api/billing/checkout",
      {
        body: z.object({ priceId: z.string() }),
        handler(_request, ctx) {
          return Response.json({
            url: `https://checkout.example/${ctx.input.body!.priceId}`,
          });
        },
      },
    ),
  }),
});
```

Farm flattens this object into `routes`, mounts the same HTTP handler, and generates the same typed
callers:

**client code**

```tsx
"use client";

import { apiClient } from "../lib/integrations";

export async function startCheckout() {
  const result = await apiClient.billing.checkout.post({
    body: { priceId: "price_123" },
  });

  if (result.error) throw result.error;
  return result.data;
}
```

**server code**

```ts
import { api } from "../lib/integrations";

export async function startCheckoutOnServer() {
  const result = await api.billing.checkout.post({
    body: { priceId: "price_123" },
  });

  if (result.error) throw result.error;
  return result.data;
}
```

The `checkout` object key is only an authoring label. The URL `/api/billing/checkout` determines the
derived caller path. If the key were `start` but the URL stayed the same, the caller would still be
`api.billing.checkout.post(...)`.

### 3. `api`: callers for existing handlers

Use `api` when this integration does not own the handler, or when you intentionally want caller
names that do not follow route URLs.

**src/integrations/billing.ts**

```ts
import { defineIntegration, endpoint } from "@farmjs/core";

export const billing = defineIntegration({
  category: "payment",
  type: "acme-billing",
  instance: {},
  api: {
    startCheckout: endpoint.post<{ priceId: string }, { url: string }>("/api/billing/checkout", {
      responseFormat: "json",
    }),
  },
});
```

This creates typed callers named `startCheckout`:

**client code**

```tsx
"use client";

import { apiClient } from "../lib/integrations";

export async function startCheckout() {
  const result = await apiClient.billing.startCheckout({
    body: { priceId: "price_123" },
  });

  if (result.error) throw result.error;
  return result.data;
}
```

**server code**

```ts
import { api } from "../lib/integrations";

export async function startCheckoutOnServer() {
  const result = await api.billing.startCheckout({
    body: { priceId: "price_123" },
  });

  if (result.error) throw result.error;
  return result.data;
}
```

Unlike `routes` and `endpoints`, `api` does **not** create `POST /api/billing/checkout`. The app or
another service must implement that URL.

If you provide `api` together with `routes` or `endpoints`, Farm still mounts the handlers, but the
explicit `api` object replaces all automatic caller derivation for that integration. Use that
combination only when you intentionally want caller names or operations that differ from the route
paths, and keep the declared methods and paths synchronized. Built-in integrations may use this
advanced combination to keep a stable public caller contract; most application integrations do not
need it.

The integration's `api:` field is a contract. It is different from the returned `api` value, which
is the server caller for that contract. `apiClient` is the browser caller.

## Full shape

The full interface is intentionally flat. Lifecycle hooks are top-level fields instead of being wrapped in a `lifecycle` object.

```ts
type IntegrationAuthoringShape = {
  category: string;
  type: string;
  instance: unknown;
  routes?: readonly unknown[]; // Flat HTTP handler definitions.
  endpoints?: object; // Grouped HTTP handler definitions.
  api?: object; // Caller definitions only; does not mount handlers.
  middleware?: readonly unknown[];
  providers?: readonly unknown[];
  documentNavigations?: readonly unknown[];
  schema?: object;
  config?: object;
  validate?: (ctx: unknown) => void | Promise<void>;
  setup?: (ctx: unknown) => void | Promise<void>;
  ready?: (ctx: unknown) => void | Promise<void>;
  dispose?: (ctx: unknown) => void | Promise<void>;
  log?: (event: unknown) => void | Promise<void>;
  plugins?: readonly unknown[];
};
```

In normal app code you do not need to write this type by hand. `defineIntegration` preserves the exact route, endpoint, config, and schema types for inference.

## Config validation

Use `config` when an integration needs secrets or user options. Farm resolves config in this order:

1. `defaults`
2. values loaded from `env`
3. explicit `input`
4. `resolve(ctx)`
5. `schema` validation

**src/integrations/acme.ts**

```ts
import { defineIntegration } from "@farmjs/core";
import { z } from "zod";

const acmeConfigSchema = z.object({
  apiKey: z.string().min(1),
  webhookSecret: z.string().optional(),
  mode: z.enum(["test", "live"]).default("test"),
});

export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  config: {
    schema: acmeConfigSchema,
    env: {
      apiKey: "ACME_API_KEY",
      webhookSecret: "ACME_WEBHOOK_SECRET",
    },
    defaults: {
      mode: "test",
    },
  },
  validate(ctx) {
    if (ctx.integrationConfig.mode === "live" && !ctx.integrationConfig.webhookSecret) {
      throw new Error("ACME_WEBHOOK_SECRET is required in live mode.");
    }
  },
});
```

`ctx.integrationConfig` is the parsed config. If validation fails, the app fails during integration startup instead of later during a request.

## Lifecycle hooks

Lifecycle hooks receive the same base context plus the parsed `integrationConfig`, a `log` helper, and cleanup support.

| Hook | When it runs | Use it for |
| --- | --- | --- |
| `validate(ctx)` | During integration init | Check API keys, required URLs, config combinations, and app prerequisites. |
| `setup(ctx)` | During integration init after validation | Prepare storage, register webhooks, create queues, warm clients, or schedule cleanup. |
| `ready(ctx)` | When the app/plugin manager is ready | Emit ready logs or start background listeners. |
| `dispose(ctx)` | During shutdown | Close clients, flush buffers, unregister listeners, or stop workers. |

```ts
export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  config: {
    schema: acmeConfigSchema,
    env: {
      apiKey: "ACME_API_KEY",
    },
  },
  async validate(ctx) {
    if (!ctx.integrationConfig.apiKey.startsWith("acme_")) {
      throw new Error("Invalid ACME_API_KEY.");
    }
  },
  async setup(ctx) {
    const interval = setInterval(() => {
      ctx.log.info("ACME heartbeat");
    }, 30_000);

    await ctx.cleanup(() => {
      clearInterval(interval);
    });
  },
  ready(ctx) {
    ctx.log.info("ACME integration ready", {
      key: ctx.key,
    });
  },
  dispose(ctx) {
    ctx.log.info("ACME integration disposed", {
      reason: ctx.reason,
    });
  },
});
```

`ctx.cleanup(callback)` registers cleanup that runs after `dispose`. Calling `ctx.cleanup()` with no callback runs the registered cleanups immediately.

## Typed routes

`integrationRoute` is the route factory. It supports `get`, `post`, `put`, `patch`, `delete`, `options`, and `head`.

```ts
import { defineIntegration, integrationRoute } from "@farmjs/core";
import { z } from "zod";

const createCheckoutBody = z.object({
  priceId: z.string(),
  successPath: z.string(),
  cancelPath: z.string(),
});

export const billing = defineIntegration({
  category: "payment",
  type: "acme-billing",
  instance: {},
  routes: [
    integrationRoute.post<
      "/api/billing/checkout",
      z.output<typeof createCheckoutBody>,
      { redirectTo: string }
    >("/api/billing/checkout", {
      body: createCheckoutBody,
      async handler(_request, ctx) {
        const checkout = await createCheckoutSession(ctx.input.body!);

        return Response.json({
          redirectTo: checkout.url,
        });
      },
    }),
  ],
});
```

For body and query validation you can use Zod, any parser with `parse`, any parser with `safeParse` or `safeParseAsync`, or a Standard Schema compatible validator through `~standard.validate`.

## Endpoints object

Use `endpoints` when you want to organize handler definitions in an object instead of a flat array.
Farm recursively flattens the object into `routes` and derives callers from each route URL. The
object keys are organizational; they do not control the caller namespace.

```ts
import { z } from "zod";

const checkoutBody = z.object({
  priceId: z.string(),
});

export const billing = defineIntegration({
  category: "payment",
  type: "acme-billing",
  instance: {},
  endpoints: ({ endpoint }) => ({
    checkout: endpoint.post<
      "/api/billing/checkout",
      { priceId: string },
      { url: string }
    >("/api/billing/checkout", {
      body: checkoutBody,
      handler(_request, ctx) {
        return Response.json({
          url: `https://checkout.example/${ctx.input.body?.priceId}`,
        });
      },
    }),
    status: endpoint.get<"/api/billing/status", { active: boolean }>(
      "/api/billing/status",
      {
        handler() {
          return Response.json({
            active: true,
          });
        },
      },
    ),
  }),
});
```

The URLs in this example produce `api.billing.checkout.post(...)` and
`api.billing.status()`. Those names match the object keys because the final URL segments are also
`checkout` and `status`.

## Explicit API trees

Use `api` when routes are implemented elsewhere, when the integration only needs typed callers, or
when you intentionally want caller names that do not follow the URLs. An `api` operation never
registers an HTTP handler.

```ts
import { defineIntegration, endpoint } from "@farmjs/core";

export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  api: {
    profile: endpoint.get<{ id: string }, { id: string; name: string }>("/api/acme/profile", {
      responseFormat: "json",
    }),
    messages: endpoint.route(
      "/api/acme/messages",
      endpoint.get<{ items: string[] }>({
        responseFormat: "json",
      }),
      endpoint.post<{ text: string }, { id: string }>({
        responseFormat: "json",
      }),
    ),
  },
});
```

`endpoint.route(path, ...)` is useful when multiple methods share one path. A namespace with one method can be called directly and still keeps the method accessor.

If the integration also declares `routes` or `endpoints`, this explicit tree replaces the caller
tree Farm would derive from them. It does not replace or remove their HTTP handlers.

## Hooks around a route

Route-level `middleware`, `before`, and `after` run in this order:

1. Input validation
2. `route.middleware`
3. `route.before`
4. `handler`
5. `route.after`

```ts
integrationRoute.get("/api/acme/admin", {
  middleware: [
    {
      handler(_request, ctx) {
        ctx.req.set("startedAt", Date.now());
      },
    },
  ],
  before: [
    (_request, ctx) => {
      if (!ctx.data.tenantId) {
        return Response.json(
          {
            error: "tenantId is required",
          },
          {
            status: 400,
          },
        );
      }
    },
  ],
  handler() {
    return Response.json({
      ok: true,
    });
  },
  after: [
    (_request, ctx) => {
      ctx.response?.headers.set("x-integration", ctx.integration.type);
    },
  ],
});
```

`before` can return a `Response` to short-circuit the handler. `after` receives `ctx.response` for both normal handler responses and short-circuit responses, and can mutate it or return a replacement.

## Integration middleware

Top-level `middleware` is for request behavior that is not tied to one route. It uses a matcher and can short-circuit the request.

```ts
export const authGate = defineIntegration({
  category: "auth",
  type: "auth-gate",
  instance: {},
  middleware: [
    {
      matcher: "/dashboard/[section]",
      handler(_request, ctx) {
        if (!ctx.req.get("user.id")) {
          return new Response("Unauthorized", {
            status: 401,
          });
        }
      },
    },
  ],
});
```

Use top-level middleware for auth gates, tenant loading, rewrites, rate-limit checks, or provider-specific request enrichment.

## Context reference

Route handlers, route middleware, and route hooks receive `ctx` with these fields:

| Field | What it contains |
| --- | --- |
| `request` | The web `Request` passed to the handler. |
| `requestId` | Request ID from headers or Farm-generated fallback. |
| `url` | Parsed `URL`. |
| `pathname` | Current pathname. |
| `method` | HTTP method. |
| `params` | Dynamic route params, including catch-all arrays. |
| `input.body` | Parsed and validated body, if a body schema exists. |
| `input.query` | Parsed and validated query, if a query schema exists. |
| `args.db` | Lazy ORM client for the integration schema. |
| `args.getDb()` | Promise-based ORM client resolver. |
| `args.storage.getClient()` | Raw `storage.client`, if configured. |
| `data` | Small sanitized metadata from `createIntegrations({ data })` and per-call data. |
| `integration` | Category, type, slot alias, and original `instance`. |
| `route` | Route kind, path, and methods. |
| `req` | Request-scoped key/value store shared with plugins and hooks. |
| `config` | Resolved Farm config. |
| `isDev` / `isProd` | Runtime mode flags. |

`ctx.req.set(key, value, { exposeToPage: true })` can expose values to page props. Avoid exposing secrets.
`ctx.requestContext` remains as a deprecated compatibility alias for existing integrations.

## Storage schema

Declare `schema` when an integration owns data. Farm maps that schema to the integration ORM so route handlers and lifecycle hooks can use `ctx.args.db`.

```ts
import { defineIntegration, defineIntegrationSchema, integrationRoute } from "@farmjs/core";

const billingSchema = defineIntegrationSchema({
  models: {
    billingAccount: {
      name: "billing_account",
      fields: {
        id: {
          type: "id",
          primaryKey: true,
        },
        ownerId: {
          type: "string",
          name: "owner_id",
          required: true,
          index: true,
        },
        status: {
          type: "enum",
          required: true,
          values: ["free", "active"],
          default: "free",
        },
        createdAt: {
          type: "datetime",
          required: true,
          default: "now",
        },
      },
      constraints: [
        {
          type: "unique",
          fields: ["ownerId"],
        },
      ],
    },
  },
});

export const billing = defineIntegration({
  category: "payment",
  type: "custom-billing",
  instance: {},
  schema: billingSchema,
  routes: [
    integrationRoute.get("/api/billing/account", {
      async handler(_request, ctx) {
        const account = await ctx.args.db.billingAccount.findFirst({
          where: {
            ownerId: String(ctx.data.ownerId),
          },
        });

        return Response.json({
          account,
        });
      },
    }),
  ],
});
```

If an integration does not define `schema`, `ctx.args.db` throws. Use `ctx.args.storage.getClient()` when you only need the app's raw storage client.

## Storage config

The app supplies the storage client once:

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";
import { DatabaseSync } from "node:sqlite";
import { billing } from "./src/integrations/billing";

const sqlite = new DatabaseSync("farm.sqlite");

export default defineConfig({
  storage: {
    client: sqlite,
  },
  integrations: {
    billing,
  },
});
```

The integration code still uses `ctx.args.db`, not SQLite-specific APIs. If the app later switches to another supported client, the integration surface stays the same.

## Providers

Use `providers` for client SDKs, context providers, or integration metadata that the app shell can compose.

```tsx
import type { FarmIntegrationProviderProps } from "@farmjs/core";

function AcmeProvider({ children }: FarmIntegrationProviderProps) {
  return <>{children}</>;
}

export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  providers: [
    {
      name: "acme",
      type: "client",
      props: {
        publishableKey: process.env.ACME_PUBLISHABLE_KEY,
      },
      component: AcmeProvider,
    },
  ],
});
```

Keep provider props public-safe. Secrets belong in server config and lifecycle hooks.

## Logging

The `log` callback receives lifecycle and request events. Use it for observability, tests, and debugging integration behavior.

```ts
export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  log(event) {
    console.log("[integration]", event.phase, {
      type: event.type,
      route: event.route?.path,
      durationMs: event.durationMs,
    });
  },
});
```

Common phases are `registered`, `validate`, `setup`, `ready`, `dispose`, `request:start`, `request:end`, and `request:error`.

## Client and server usage

Automatic callers read the registered integration API manifest in the browser and the registered runtime on the server.

```ts
import { createIntegrations } from "@farmjs/core/client";
import type { acme } from "../integrations/acme";

type AppIntegrations = {
  acme: typeof acme;
};

export const { api, apiClient } = createIntegrations<AppIntegrations>({
  data: {
    tenantId: "tenant_123",
  },
});
```

For library tests or isolated packages, pass explicit sources:

```ts
export const { api, apiClient } = createIntegrations({
  acme,
});
```

## Security checklist

- Validate config during startup with `config.schema` and `validate`.
- Validate all route body and query input before touching provider SDKs.
- Treat `ctx.data` as untrusted when it arrives from a browser.
- Do not expose secrets through provider props, page props, response bodies, or logs.
- Prefer `responseFormat: "json"` for typed callers and return structured errors.
- Keep webhook routes strict about method, body format, signature verification, and replay windows.
- Use `before` or route middleware for authorization checks close to the route they protect.
- Use `dispose` and `ctx.cleanup` for open handles, background listeners, and timers.

## Production checklist

- Define a stable `category` and `type`.
- Keep app namespace keys predictable in `farm.config.ts`.
- Add integration tests for valid input, invalid input, middleware short-circuiting, hooks, and client caller inference.
- Add storage tests with real data when `schema` is present.
- Log enough request metadata to debug failures without logging secrets.
- Document env vars, route paths, API callers, and storage models for app teams.
