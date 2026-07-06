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
const login = await api.auth.login.get({
  query: {
    returnTo: "/dashboard",
  },
});

if (login.data?.redirectTo) {
  window.location.href = login.data.redirectTo;
}
```

## What Auth0 adds

| Route | Purpose |
| --- | --- |
| `/auth/login` | Starts login and returns or performs a redirect. |
| `/auth/signup` | Starts signup and returns or performs a redirect. |
| `/auth/callback` | Exchanges the authorization code and writes the session cookie. |
| `/auth/logout` | Clears the local session and redirects to Auth0 logout. |
| `/auth/profile` | Reads the local Auth0 session profile. |

The route paths can be overridden when the app needs a different URL structure.

## Protected routes

```ts
auth0({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  secret: process.env.AUTH0_SECRET,
  protectedRoutes: ["/dashboard(.*)"],
});
```

## Production notes

- Set `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, and `APP_BASE_URL`.
- Register the callback URL in the Auth0 dashboard.
- Use `returnTo` for post-login navigation.
- Test state validation, callback errors, logout redirects, and expired sessions.
