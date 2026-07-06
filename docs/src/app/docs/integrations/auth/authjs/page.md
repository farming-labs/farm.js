---
title: "Auth.js Integration"
description: "Mount Auth.js routes and session helpers through Farm's integration API."
section: "Integrations"
---

# Auth.js Integration

Auth.js works well when a project already uses NextAuth-style providers and callbacks but wants Farm to own routing, typed callers, and middleware wiring.

## Add Auth.js

**Terminal**

```bash
farm add integration authjs --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { authjs } from "@farmjs/integrations/auth";

export const integrations = {
  auth: authjs({
    secret: process.env.AUTH_SECRET,
    providers: [],
  }),
};
```

## Use it

**Caller**

```ts
const session = await api.auth.session.get();
```
