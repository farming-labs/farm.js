---
title: "Better Auth Integration"
description: "Own Better Auth routes, sessions, and callbacks from Farm's integration layer."
section: "Integrations"
---

# Better Auth Integration

Better Auth is the local-first auth option for apps that want to own routes, sessions, storage, and callbacks without losing Farm's typed integration API.

## Add Better Auth

**Terminal**

```bash
farm add integration better-auth --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { betterAuth } from "@farmjs/integrations/auth";
import { auth } from "./auth";

export const integrations = {
  auth: betterAuth({
    instance: auth,
  }),
};
```

## Use it

**Caller**

```ts
const session = await api.auth.session.get();
```
