---
title: "Clerk Integration"
description: "Use Clerk sessions, protected routes, and provider wrappers through Farm."
section: "Integrations"
---

# Clerk Integration

Clerk is the hosted auth path for projects that want prebuilt account UI, organizations, and SDK-backed session helpers while keeping Farm route conventions.

## Add Clerk

**Terminal**

```bash
farm add integration clerk --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { clerk } from "@farmjs/integrations/auth";

export const integrations = {
  auth: clerk({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  }),
};
```

## Use it

**Caller**

```ts
const user = await api.auth.user.get();
```
