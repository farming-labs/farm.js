---
title: "Auth.js Integration"
description: "Mount an Auth.js handler at Farm's catch-all auth route and keep using Auth.js native helpers."
section: "Integrations"
---

# Auth.js Integration

Use this adapter when Auth.js should own providers, callbacks, cookies, and sessions while Farm mounts its `GET` and `POST` handlers.

Farm creates the catch-all route. It does not reimplement Auth.js or generate a separate Farm auth client.

## Add Auth.js

**Terminal**

```bash
farm add integration authjs --ui
```

Install Auth.js and the provider packages used by the app.

## Create the Auth.js instance

**src/lib/auth.ts**

```ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const authInstance = NextAuth({
  providers: [GitHub],
});

export const { auth, handlers, signIn, signOut } = authInstance;
```

The Farm adapter only requires the `handlers` property, so the normal object returned by `NextAuth(...)` can be passed directly.

## Register it

**src/lib/integrations.ts**

```ts
import { authjs } from "@farm.js/integrations/authjs";
import { authInstance } from "./auth";

export const appIntegrations = {
  auth: authjs({
    instance: authInstance,
  }),
} as const;
```

Farm mounts:

```text
GET  /api/auth/[...nextauth]
POST /api/auth/[...nextauth]
```

Requests such as `/api/auth/session`, `/api/auth/signin`, and provider callbacks are handled by that catch-all route and delegated to Auth.js.

## Use Auth.js helpers

Use the native helpers exported from the same instance:

```ts
import { auth } from "@/lib/auth";

const session = await auth();
```

Use the browser helpers supplied by the Auth.js client package that matches your installed version. You can also call provider-owned endpoints directly when that fits the Auth.js API:

```ts
const response = await fetch("/api/auth/session", {
  credentials: "include",
});
```

There is no generated `api.auth.session` operation because the integration mounts a provider catch-all route without declaring a separate Farm caller contract.

## Protect application routes

`authjs(...)` does not accept `protectedRoutes`. Protect pages using the Auth.js `auth()` helper or add [Farm middleware](/docs/middleware) that calls your Auth.js instance.

Keep authentication and authorization separate:

- Auth.js establishes the user session.
- Your app decides which users can access a project, organization, or resource.

## Handler behavior

| Request                         | Behavior                                               |
| ------------------------------- | ------------------------------------------------------ |
| `GET` under the catch-all path  | Delegated to `instance.handlers.GET`.                  |
| `POST` under the catch-all path | Delegated to `instance.handlers.POST`.                 |
| Missing matching handler        | Returns `405 Method Not Allowed`.                      |
| Provider callback               | Auth.js processes it through the same catch-all route. |

## Adapter options

| Option     | Required | Use                                                  |
| ---------- | -------- | ---------------------------------------------------- |
| `instance` | Yes      | Object containing Auth.js `GET` and `POST` handlers. |
| `log`      | No       | Farm integration lifecycle and route logger.         |

All provider credentials, callbacks, adapters, events, and session settings belong in the Auth.js configuration.

## Production checklist

- Set `AUTH_SECRET` and every provider credential required by Auth.js.
- Register provider callback URLs under `/api/auth/callback/<provider>`.
- Configure trusted hosts and proxy behavior according to the Auth.js deployment.
- Test both `GET` and `POST` actions through the Farm production server.
- Add explicit application authorization around tenant and resource access.
