---
title: "Auth Integrations"
description: "Choose and configure Better Auth, Auth.js, Clerk, Auth0, WorkOS, or Supabase in a Farm app."
section: "Integrations"
---

# Auth Integrations

For the simplest email/password application, start with [Farm's built-in Authentication](/docs/auth):

```ts
export default defineConfig({
  auth: true,
});
```

This is a top-level framework feature, not an `integrations.auth` provider. It supplies a Farm-owned server API and React hook without a provider instance in application config.

The integration path remains fully supported when an application needs provider-specific behavior or wants to own a lower-level auth engine. For example, `integrations.auth: { provider: "better-auth", instance }` lets the application control the complete Better Auth configuration without importing the Farm adapter factory. The two paths are alternatives: configure either top-level `auth` or `integrations.auth`, never both.

## Start from the matching starter

| Authentication owner                                             | Complete starter                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Farm owns the default email/password flow through `auth: true`   | [Farm.js Auth Starter](https://github.com/farming-labs/farmjs-auth-starter)               |
| Your app owns a Better Auth instance through `integrations.auth` | [Farm.js Better Auth Starter](https://github.com/farming-labs/farmjs-better-auth-starter) |

Farm supports two auth integration styles:

- **Farm-owned auth flows** create login, callback, logout, and session or profile routes. Auth0, WorkOS, and Supabase use this model.
- **Provider-owned auth flows** mount a provider handler or app wrapper. Better Auth, Auth.js, and Clerk use this model.

That distinction determines whether you call auth through Farm's generated `api` clients or through the provider's native SDK.

SDK construction is a separate choice. WorkOS, Supabase, and Clerk can construct their SDK client from integration options or documented environment variables when `instance` is omitted; pass `instance` when the application should construct and own that client instead. An injected instance always wins over constructor options. Auth.js and Better Auth require an application-owned instance because their providers, adapters, callbacks, and plugins are application-specific. Auth0's optional `instance` is a middleware adapter for mounting an existing auth implementation, not an Auth0 SDK client.

## Choose by ownership

| Provider                                           | Farm owns                                                                                                   | Your app or provider owns                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Auth0](/docs/integrations/auth/auth0)             | OAuth routes, PKCE/state validation, local session cookie, profile route, protected-route redirects         | Auth0 tenant, connections, actions, and user records                        |
| [WorkOS](/docs/integrations/auth/workos)           | AuthKit redirects, callback, sealed session cookie, session route, protected-route redirects                | WorkOS organizations, SSO configuration, and user management                |
| [Supabase](/docs/integrations/auth/supabase)       | Email/password and OAuth routes, SSR cookies, optional auth pages, session route, protected-route redirects | Supabase project, providers, policies, and user data                        |
| [Clerk](/docs/integrations/auth/clerk)             | `ClerkProvider` registration and optional request middleware                                                | Clerk UI, hooks, sessions, organizations, and account flows                 |
| [Auth.js](/docs/integrations/auth/authjs)          | The `/api/auth/[...nextauth]` catch-all route                                                               | Auth.js providers, callbacks, session strategy, and native helpers          |
| [Better Auth](/docs/integrations/auth/better-auth) | The `/api/auth/[...auth]` catch-all route                                                                   | Better Auth database adapter, plugins, methods, sessions, and native client |

## Register a provider

Keep the integration object in a shared server module so `farm.config.ts` and typed callers can refer to the same shape.

**src/lib/integrations.ts**

```ts
import { supabase } from "@farm.js/supabase";

export const appIntegrations = {
  auth: supabase({
    appBaseUrl: process.env.APP_BASE_URL,
    callbackPath: "/auth/callback",
    protectedRoutes: ["/dashboard(.*)"],
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { appIntegrations } from "./src/lib/integrations";

export default defineConfig({
  integrations: appIntegrations,
});
```

Provider credentials can be passed directly, but every built-in provider also resolves its documented environment variables.

## Farm-owned callers

Auth0, WorkOS, and Supabase expose typed operations for their Farm-owned routes.

**src/lib/api.ts**

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

Use `api` in server code and `apiClient` in client components:

```ts
const serverSession = await api.auth.session.get();
const browserSession = await apiClient.auth.session.get();
```

The available operation names depend on the provider:

| Provider | Main operations                                                        |
| -------- | ---------------------------------------------------------------------- |
| Auth0    | `login.get`, `signup.get`, `logout.get`, `profile.get`                 |
| WorkOS   | `login.get`, `signup.get`, `logout.post`, `session.get`                |
| Supabase | `login.post`, `signup.post`, `oauth.get`, `logout.post`, `session.get` |

Auth.js, Better Auth, and Clerk do not create this Farm auth caller tree. Use their native helpers and clients instead. The top-level Farm Auth feature uses `@farm.js/auth/server` and `@farm.js/auth/client`.

## Protected routes

Auth0, WorkOS, Supabase, and Clerk accept `protectedRoutes`:

```ts
auth0({
  protectedRoutes: ["/dashboard(.*)", "/settings(.*)"],
});
```

When a signed-out request matches, the provider integration redirects it to the configured sign-in route and keeps the current path as a return target. A session or profile endpoint can still return `401` when called directly.

Auth.js and Better Auth only mount their provider handlers. Protect application pages with the provider's server helper or with your own [Farm middleware](/docs/middleware).

## Callback and return URLs

- Auth0 and Supabase accept an absolute `callbackUrl` or a root-relative `callbackPath`.
- WorkOS accepts `callbackPath` and builds the absolute callback from the request origin.
- Set `APP_BASE_URL` for Auth0 or Supabase when the public production origin cannot be inferred from the incoming request.
- Register the same absolute callback URL in the provider dashboard.
- `returnTo` values are intentionally limited to root-relative app paths. External URLs are ignored.

## Production checklist

- Keep client secrets, cookie passwords, and provider secret keys in server-only environment variables.
- Use a strong Auth0 `AUTH0_SECRET` or WorkOS `WORKOS_COOKIE_PASSWORD`.
- Confirm callback, logout, sign-in, and sign-up URLs in both Farm and the provider dashboard.
- Test expired sessions and direct access to every protected page.
- Decide which provider fields are copied into your application database and when they are synchronized.
