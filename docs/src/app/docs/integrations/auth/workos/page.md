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
const login = await api.auth.login.get({
  query: {
    returnTo: "/dashboard",
  },
});

if (login.data?.redirectTo) {
  window.location.href = login.data.redirectTo;
}
```

## What WorkOS adds

| Route | Purpose |
| --- | --- |
| `/login` | Starts WorkOS sign-in. |
| `/signup` | Starts WorkOS sign-up. |
| `/callback` | Exchanges the authorization code and stores the sealed session. |
| `/logout` | Clears the local session and redirects through WorkOS logout. |
| `/auth/session` | Reads the current sealed-session-backed user state. |

The route paths can be overridden when the app wants `/auth/login` style URLs.

## Protected routes

```ts
workos({
  clientId: process.env.WORKOS_CLIENT_ID,
  apiKey: process.env.WORKOS_API_KEY,
  cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
  protectedRoutes: ["/dashboard(.*)", "/api/private/[...path]"],
});
```

## Production notes

- Set `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and `WORKOS_COOKIE_PASSWORD`.
- Use a strong cookie password in production.
- Configure redirect URIs in WorkOS to match your Farm callback route.
- Test sign-in, sign-up, callback, logout, and session reads.
- Decide how organizations and roles map into your app database.
