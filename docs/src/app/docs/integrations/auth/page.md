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
import { defineFarmConfig } from "@farmjs/core";
import { supabase } from "@farmjs/integrations/supabase";

export default defineFarmConfig({
  integrations: {
    auth: supabase({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
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
import { createIntegrations } from "@farmjs/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();

const sessionOnServer = await api.auth.session.get();
const sessionInBrowser = await apiClient.auth.session.get();
```

This explicit session caller is the shape for providers that define Farm-owned session endpoints, such as Supabase. Provider-owned integrations such as Better Auth, Auth.js, and Clerk mount their provider handlers or wrappers and should use that provider's native client/server helpers for session reads.

## What auth integrations share

| Area | Details |
| --- | --- |
| Routes | Login, callback, logout, session/profile, or provider-owned handler routes, depending on the provider. |
| Typed callers | Farm-owned routes get browser/server callers; provider-owned handlers use provider helpers. |
| Middleware | Optional protected route matchers. |
| Providers | Client provider metadata for hosted auth SDKs. |
| Navigation | Sign-in/sign-up route matchers for docs and app navigation. |
| Request context | Session or user data can be exposed to downstream handlers and pages. |

## Choosing a provider

| Provider | Best when |
| --- | --- |
| Better Auth | You want local-first auth and control over storage and callbacks. |
| Auth.js | You already like the NextAuth/Auth.js provider model. |
| Clerk | You want hosted account UI, organizations, and polished auth UX quickly. |
| Auth0 | You need hosted identity with enterprise connections and custom domains. |
| WorkOS | You need enterprise SSO, organizations, directory sync, or B2B workflows. |
| Supabase | You want hosted auth plus Postgres-backed app data. |

## Protected routes

Most hosted auth integrations accept protected route matchers. The integration can redirect to sign-in or return `401` before the page/API handler runs.

```ts
supabase({
  protectedRoutes: ["/dashboard(.*)", "/api/private/[...path]"],
  pages: {
    signIn: "/sign-in",
    signUp: "/sign-up",
  },
});
```

## Production notes

- Keep server secrets out of client components.
- Set `APP_BASE_URL` when callback URLs need to be absolute.
- Configure callback URLs in the provider dashboard and in Farm config.
- Test login, signup, callback, logout, session refresh, and protected-route redirects.
- Decide whether the source of truth for user metadata is the provider, your database, or both.
