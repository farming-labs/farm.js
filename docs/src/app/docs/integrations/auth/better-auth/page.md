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

**Mounted route**

```ts
const response = await fetch("/api/auth/session", {
  credentials: "include",
});

const session = await response.json();
```

Farm mounts the Better Auth handler and keeps it discoverable in the integration registry. The session shape, sign-in methods, plugins, and adapter behavior still come from your Better Auth instance, so use the Better Auth client helpers when you want the full provider DX.

## What Better Auth adds

Better Auth is mounted at `/api/auth/[...auth]` with `GET` and `POST` handlers. The integration delegates to your Better Auth instance, so providers, sessions, plugins, and storage stay in your Better Auth config while Farm owns registration, route discovery, logging, and typed integration wiring.

## Full app shape

**src/lib/auth.ts**

```ts
import { betterAuth as createBetterAuth } from "better-auth";

export const auth = createBetterAuth({
  database: {
    provider: "sqlite",
    url: "file:./auth.sqlite",
  },
  emailAndPassword: {
    enabled: true,
  },
});
```

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

## Production notes

- Keep the Better Auth secret and database credentials server-only.
- Let Better Auth own provider callbacks and session persistence.
- Use Farm middleware or integration route hooks for app-specific authorization.
- Test sign-in, sign-up, session reads, logout, and callback routes through the Farm dev server.
