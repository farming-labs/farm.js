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
