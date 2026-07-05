---
title: "Auth0 Integration"
description: "Wire Auth0 login, callback, logout, and session routes from Farm config."
section: "Integrations"
---

# Auth0 Integration

Auth0 fits teams that want hosted identity, enterprise providers, and a config-first login and callback flow.

## Add Auth0

**Terminal**

```bash
farm add integration auth0 --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { auth0 } from "@farmjs/integrations/auth";

export const integrations = {
  auth: auth0({
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    callbackUrl: "/api/auth/callback",
  }),
};
```

## Use it

**Caller**

```ts
await api.auth.login.get();
```
