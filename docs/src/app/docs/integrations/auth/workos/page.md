---
title: "WorkOS Integration"
description: "Add WorkOS AuthKit login, sealed sessions, logout, and protected routes to Farm."
section: "Integrations"
---

# WorkOS Integration

Use WorkOS for B2B authentication when AuthKit, enterprise SSO, and organization-aware sessions should sit behind Farm-owned routes.

This adapter covers AuthKit sign-in and sealed sessions. Directory Sync and other WorkOS APIs remain separate application integrations.

## Add WorkOS

**Terminal**

```bash
farm add integration workos --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { workos } from "@farm.js/workos";

export const appIntegrations = {
  auth: workos({
    clientId: process.env.WORKOS_CLIENT_ID,
    apiKey: process.env.WORKOS_API_KEY,
    cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
    callbackPath: "/callback",
    protectedRoutes: ["/dashboard(.*)"],
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

Farm builds the absolute redirect URI from the incoming request origin and `callbackPath`. Register that exact URL in WorkOS, for example `https://app.example.com/callback`.

## Environment variables

| Variable                      | Required    | Purpose                                        |
| ----------------------------- | ----------- | ---------------------------------------------- |
| `WORKOS_CLIENT_ID`            | Yes         | AuthKit client ID.                             |
| `WORKOS_API_KEY`              | Yes         | Server-side WorkOS API key.                    |
| `WORKOS_COOKIE_PASSWORD`      | Production  | Encrypts and seals the AuthKit session cookie. |
| `FARM_WORKOS_COOKIE_PASSWORD` | Alternative | Backward-compatible cookie password name.      |

Development has a local fallback cookie password. Production startup fails without an explicit password.

## Choose SDK ownership

### Let Farm construct WorkOS

The configuration above is the default path. When `instance` is omitted, Farm constructs one
WorkOS client from `clientId` and `apiKey`, supplied directly or through environment variables.

### Provide an application-owned instance

Pass a configured SDK through `instance` when the app needs WorkOS constructor options that Farm
does not own. Farm uses the instance directly, so `apiKey` is no longer required by the integration.
The AuthKit client ID can come from the instance, while the cookie password remains required because
Farm owns the sealed session cookie.

When both are present, the supplied instance wins. Integration-owned route, cookie, and protection
options stay beside `instance` in the declarative integration object.

```ts
import { defineConfig } from "@farm.js/core";
import { WorkOS } from "@workos-inc/node";

const workosClient = new WorkOS({
  apiKey: process.env.WORKOS_API_KEY,
  clientId: process.env.WORKOS_CLIENT_ID,
});

export default defineConfig({
  integrations: {
    auth: {
      provider: "workos",
      instance: workosClient,
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
      protectedRoutes: ["/dashboard(.*)"],
    },
  },
});
```

Farm loads the installed `@farm.js/workos` adapter from `provider`; application code does not import
or call `workos(...)` for this path.

## Routes and methods

| Method | Default route   | Purpose                                                          |
| ------ | --------------- | ---------------------------------------------------------------- |
| `GET`  | `/login`        | Starts AuthKit sign-in.                                          |
| `GET`  | `/signup`       | Starts AuthKit sign-up.                                          |
| `GET`  | `/callback`     | Exchanges the code and stores the sealed session.                |
| `POST` | `/logout`       | Clears the cookie and redirects through WorkOS logout.           |
| `GET`  | `/auth/session` | Returns the authenticated user, session ID, and organization ID. |

Override these routes with `loginPath`, `signUpPath`, `callbackPath`, `logoutPath`, and `sessionPath`.

## Start an AuthKit flow

Document navigation redirects directly:

```tsx
<a href="/login?returnTo=/dashboard">Sign in</a>
<a href="/signup?returnTo=/dashboard">Create account</a>
```

The typed client returns the provider URL:

```ts
const result = await apiClient.auth.login.get({
  query: {
    returnTo: "/dashboard",
  },
});

if (result.data) {
  window.location.assign(result.data.redirectTo);
}
```

## Read the sealed session

```ts
const result = await api.auth.session.get();

if (result.error && "status" in result.error && result.error.status === 401) {
  // No authenticated WorkOS session.
}

const organizationId = result.data?.organizationId;
const user = result.data?.user;
```

An authenticated response contains:

```ts
{
  authenticated: true;
  sessionId?: string;
  organizationId?: string;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
  };
}
```

The organization ID is useful for looking up your app's tenant record. Authorization roles and permissions still need to be resolved by your application.

## Logout

```ts
const result = await apiClient.auth.logout.post();

if (result.data) {
  window.location.assign(result.data.redirectTo);
}
```

Farm clears the local cookie first. If a sealed session exists, WorkOS supplies the final logout URL; otherwise the user returns to the app origin.

## Protect app routes

```ts
workos({
  protectedRoutes: ["/dashboard(.*)", "/settings(.*)"],
});
```

Signed-out requests receive a `307` redirect to `/login` with the original root-relative path in `returnTo`.

## Options

| Option            | Default            | Use                                          |
| ----------------- | ------------------ | -------------------------------------------- |
| `instance`        | None               | Existing WorkOS SDK instance.                |
| `clientId`        | `WORKOS_CLIENT_ID` | AuthKit client ID.                           |
| `apiKey`          | `WORKOS_API_KEY`   | Server API key when no instance is supplied. |
| `cookiePassword`  | WorkOS cookie env  | Sealed-session password.                     |
| `cookieName`      | `wos-session`      | Session cookie name.                         |
| `loginPath`       | `/login`           | Sign-in route.                               |
| `signUpPath`      | `/signup`          | Sign-up route.                               |
| `callbackPath`    | `/callback`        | AuthKit callback route.                      |
| `logoutPath`      | `/logout`          | Logout route.                                |
| `sessionPath`     | `/auth/session`    | Session JSON route.                          |
| `protectedRoutes` | None               | One matcher or a list of matchers.           |

## Production checklist

- Register the production callback URL in WorkOS.
- Use a strong `WORKOS_COOKIE_PASSWORD`.
- Confirm the public request origin is preserved by your proxy.
- Test personal and organization-backed sessions.
- Map `organizationId` to an application tenant before authorizing tenant data.
