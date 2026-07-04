---
title: "Auth Integrations"
description: "Use Better Auth, Auth.js, Clerk, Auth0, WorkOS, or Supabase without hand-rolling every auth route."
section: "Integrations"
---

# Auth Integrations

Use Better Auth, Auth.js, Clerk, Auth0, WorkOS, or Supabase without hand-rolling every auth route.

## Auth providers

- **Better Auth**: Owns Better Auth routes and can pair with local SQLite in examples.
- **Auth.js**: Mounts the /api/auth/[...nextauth] style route internally.
- **Clerk**: Adds provider wrappers, protected route middleware, and SDK-backed auth.
- **Auth0, WorkOS, Supabase**: Config-first login, callback, logout, session, and protected route flows.

## Supabase example

**farm.config.ts**

```ts
import { supabase } from "@farmjs/integrations/supabase";

export default defineFarmConfig({
  integrations: {
    auth: supabase({
      callbackUrl: "http://localhost:3000/auth/callback",
      protectedRoutes: ["/dashboard(.*)"],
      pages: {
        signIn: "/sign-in",
        signUp: "/sign-up",
      },
    }),
  },
});
```

## Server and client callers

**src/lib/api.ts**

```ts
export const { api, apiClient } = createIntegrations<AppIntegrations>();

const sessionOnServer = await api.auth.session.get();
const sessionInBrowser = await apiClient.auth.session.get();
```
