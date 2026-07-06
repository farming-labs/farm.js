---
title: "Supabase Integration"
description: "Use Supabase auth sessions, callback routes, and protected Farm routes."
section: "Integrations"
---

# Supabase Integration

Supabase brings hosted auth, Postgres-backed user data, OAuth providers, magic links, and session helpers into Farm's integration API.

## Add Supabase

**Terminal**

```bash
farm add integration supabase --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { supabase } from "@farmjs/integrations/supabase";

export const integrations = {
  auth: supabase({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    callbackUrl: "/auth/callback",
  }),
};
```

## Use it

**Caller**

```ts
const session = await api.auth.session.get();
```

## What Supabase adds

| Route | Purpose |
| --- | --- |
| `/auth/login` | Email/password login or OAuth redirect start. |
| `/auth/signup` | Email/password signup. |
| `/auth/callback` | OAuth callback/session exchange. |
| `/auth/logout` | Sign out and clear session state. |
| `/auth/session` | Read the current session. |

Farm derives callers from these paths, so `api.auth.session.get()` reads `/auth/session` and `api.auth.oauth.get(...)` starts OAuth through the login path.

## OAuth login

```ts
const oauth = await api.auth.oauth.get({
  query: {
    provider: "github",
    returnTo: "/dashboard",
  },
});

if (oauth.data?.redirectTo) {
  window.location.href = oauth.data.redirectTo;
}
```

## Email and password

```ts
const login = await api.auth.login.post({
  body: {
    email: "ada@example.com",
    password: "correct-horse-battery-staple",
    returnTo: "/dashboard",
  },
});
```

## Production notes

- Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only if the app uses it.
- Configure OAuth callback URLs in Supabase.
- Use protected route matchers for dashboards and private API routes.
- Test email/password, OAuth, callback, logout, and session refresh flows.
