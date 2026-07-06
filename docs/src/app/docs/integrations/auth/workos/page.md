---
title: "WorkOS Integration"
description: "Add WorkOS auth, organizations, and enterprise-ready callback flows through Farm."
section: "Integrations"
---

# WorkOS Integration

WorkOS is the enterprise auth option for SSO, organizations, directory sync, and role-aware app flows.

## Add WorkOS

**Terminal**

```bash
farm add integration workos --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { workos } from "@farmjs/integrations/auth";

export const integrations = {
  auth: workos({
    apiKey: process.env.WORKOS_API_KEY,
    clientId: process.env.WORKOS_CLIENT_ID,
    redirectUri: "/api/auth/callback",
  }),
};
```

## Use it

**Caller**

```ts
const organization = await api.auth.organization.get();
```
