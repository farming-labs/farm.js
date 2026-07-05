---
title: "Integrations"
description: "Register services once, get owned routes, typed callers, providers, middleware, storage access, lifecycle hooks, and validation."
section: "Integrations"
---

# Integrations

Register services once, get owned routes, typed callers, providers, middleware, storage access, lifecycle hooks, and validation.

## Register integrations

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";
import { stripe } from "@farmjs/integrations/stripe";

export default defineFarmConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
      products: [],
    }),
  },
});
```

## Create shared callers

**src/lib/api.ts**

```ts
import { createIntegrations } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>({
  data: {
    appName: "farm-dashboard",
  },
});
```

## What an integration can contribute

- api: typed client and server callable operations.
- routes and endpoints: HTTP handlers with zod or standard-schema input validation.
- middleware: request behavior for protected routes, rate limits, webhooks, and redirects.
- providers: app wrappers for client SDKs or context providers.
- schema: models used by Farm's integration ORM layer.
- config, validate, setup, ready, dispose: lifecycle and configuration validation.

## Built-in groups

- Payment: Stripe, Autumn, and Polar integrations share checkout, subscription, portal, webhook, entitlement, and billing snapshot patterns.
- Auth: Better Auth, Auth.js, Clerk, Auth0, WorkOS, and Supabase can expose routes, providers, and typed session helpers.
- Messaging: Email integrations can render templates, send transactional mail, preview messages, and receive provider webhooks.
- Workflows: Jobs integrations expose trigger, schedule, batch, status, and cancel APIs for task backends.
- API Keys: Unkey integrations create, verify, revoke, update, and delete customer or service keys.
- Interface: UI registry entries can scaffold shadcn-style screens for built-in integrations when `--ui` is enabled.
- Storage: ORM storage keeps integration schema reads and writes behind ctx.args.db.
