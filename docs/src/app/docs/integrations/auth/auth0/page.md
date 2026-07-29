---
title: "Auth0 Integration"
description: "Add Auth0 login, callback, logout, profile, and protected-route flows to Farm."
section: "Integrations"
---

# Auth0 Integration

Use Auth0 when the identity provider should host login and enterprise connections while Farm owns the application-facing OAuth routes and local session.

The built-in flow uses Authorization Code with PKCE, validates signed state, reads the user profile, and stores that profile in a signed HTTP-only cookie.

## Add Auth0

**Terminal**

```bash
farm add integration auth0 --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { auth0 } from "@farm.js/integrations/auth0";

export const appIntegrations = {
  auth: auth0({
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    secret: process.env.AUTH0_SECRET,
    appBaseUrl: process.env.APP_BASE_URL,
    callbackPath: "/auth/callback",
    protectedRoutes: ["/dashboard(.*)"],
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

`callbackPath` stays root-relative. Farm combines it with `APP_BASE_URL`, or the incoming request origin, to create the callback URL sent to Auth0.

You can use `callbackUrl` instead, but it must be absolute:

```ts
auth0({
  callbackUrl: "https://app.example.com/auth/callback",
});
```

## Environment variables

| Variable              | Required                  | Purpose                                                                   |
| --------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `AUTH0_DOMAIN`        | Yes                       | Tenant domain without a required protocol, such as `tenant.us.auth0.com`. |
| `AUTH0_CLIENT_ID`     | Yes                       | OAuth application client ID.                                              |
| `AUTH0_CLIENT_SECRET` | Depends on client type    | Used by confidential clients during code exchange.                        |
| `AUTH0_SECRET`        | Production                | Signs state and local session cookies.                                    |
| `APP_BASE_URL`        | Recommended in production | Public app origin used for callbacks and protected-route redirects.       |

Farm provides a development-only fallback for `AUTH0_SECRET`. Production startup fails when no secret is configured.

## Routes and methods

| Method | Default route    | Purpose                                                            |
| ------ | ---------------- | ------------------------------------------------------------------ |
| `GET`  | `/auth/login`    | Starts login. Accepts `returnTo`.                                  |
| `GET`  | `/auth/signup`   | Starts signup with Auth0's signup screen hint.                     |
| `GET`  | `/auth/callback` | Validates state, exchanges the code, and writes the local session. |
| `GET`  | `/auth/logout`   | Clears the local session and redirects through Auth0 logout.       |
| `GET`  | `/auth/profile`  | Returns the current local profile or `401`.                        |

Every path can be changed with `loginPath`, `signUpPath`, `callbackPath`, `logoutPath`, or `profilePath`.

## Start login

Normal document navigation redirects directly:

```tsx
<a href="/auth/login?returnTo=/dashboard">Sign in</a>
```

The typed integration client asks for the redirect URL as JSON:

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

Signup uses the same shape through `apiClient.auth.signup.get(...)`.

## Read the profile

```ts
const result = await api.auth.profile.get();

if (result.error && "status" in result.error && result.error.status === 401) {
  // No valid local Auth0 session.
}

const user = result.data?.user;
```

The session cookie contains the fetched Auth0 profile and an expiry derived from the token response. The integration does not persist refresh tokens, so an expired local session requires a new login.

## Protect app routes

```ts
auth0({
  protectedRoutes: ["/dashboard(.*)", "/settings(.*)"],
});
```

A signed-out request is redirected with status `307` to:

```text
/auth/login?returnTo=/the/original/path
```

Only root-relative `returnTo` values are accepted. Invalid or external values fall back to `/dashboard`.

## Options

| Option                    | Default                | Use                                                                          |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `domain`                  | `AUTH0_DOMAIN`         | Auth0 tenant domain.                                                         |
| `clientId`                | `AUTH0_CLIENT_ID`      | OAuth client ID.                                                             |
| `clientSecret`            | `AUTH0_CLIENT_SECRET`  | OAuth client secret for confidential clients.                                |
| `secret`                  | `AUTH0_SECRET`         | Cookie and state signing secret.                                             |
| `appBaseUrl`              | `APP_BASE_URL`         | Public app origin.                                                           |
| `callbackUrl`             | None                   | Absolute callback URL.                                                       |
| `callbackPath`            | `/auth/callback`       | Callback route when `callbackUrl` is not supplied.                           |
| `audience`                | None                   | Optional Auth0 API audience.                                                 |
| `scopes`                  | `openid profile email` | Requested OAuth scopes.                                                      |
| `tokenEndpointAuthMethod` | `auto`                 | `client_secret_basic`, `client_secret_post`, `none`, or automatic selection. |
| `protectedRoutes`         | None                   | One matcher or a list of matchers.                                           |

Advanced adapters can pass `instance: { middleware, matcher }`. In that mode Farm mounts the supplied middleware and does not create the built-in login, callback, logout, or profile routes.

## Production checklist

- Allow the exact callback URL in Auth0.
- Allow the app origin as a logout URL.
- Use a strong `AUTH0_SECRET`.
- Set `APP_BASE_URL` behind proxies or custom domains.
- Test bad state, callback errors, expired cookies, login return paths, and logout.
