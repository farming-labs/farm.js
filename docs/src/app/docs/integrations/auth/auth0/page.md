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
import { auth0 } from "@farm.js/auth0";

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

## Choose route ownership

### Let Farm construct the Auth0 flow

The configuration above is the default path. When `instance` is omitted, Farm constructs the OAuth
flow from the Auth0 domain, client credentials, session secret, callback settings, and scopes. Farm
then owns the login, signup, callback, logout, profile, and protected-route behavior.

### Provide application-owned middleware

```ts
auth0({
  instance: {
    matcher: ["/auth(.*)", "/dashboard(.*)"],
    middleware(request) {
      return myAuth0Middleware(request);
    },
  },
});
```

This advanced path accepts a compatible middleware adapter rather than the Auth0 SDK itself. The
supplied instance wins and Farm only mounts its middleware; it does not create the built-in login,
callback, logout, or profile routes.

## Environment variables

| Variable              | Required                  | Purpose                                                                   |
| --------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `AUTH0_DOMAIN`        | Yes                       | Tenant domain without a required protocol, such as `tenant.us.auth0.com`. |
| `AUTH0_CLIENT_ID`     | Yes                       | OAuth application client ID.                                              |
| `AUTH0_CLIENT_SECRET` | Depends on client type    | Used by confidential clients during code exchange.                        |
| `AUTH0_SECRET`        | Production                | Signs state and local session cookies.                                    |
| `APP_BASE_URL`        | Recommended in production | Public app origin used for callbacks and protected-route redirects.       |

Without `AUTH0_SECRET`, development generates a random secret once per app in `.farm/auth0-secret` (gitignored) and reuses it across restarts. Production startup fails when no secret is configured.

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

## Session lifetime and sign-out

The session is a signed cookie, not a server-side record. Sign-out clears the cookie in that
browser, but a copy of it (from another device, a log, or malware) keeps working until it expires,
which by default is the token lifetime Auth0 returns (often 24 hours). Two options narrow that:

```ts
const revoked = new Set<string>(); // use a shared store (Redis, your database) in production

auth0({
  // Sign-ins last at most an hour, whatever the token lifetime.
  sessionMaxAge: 60 * 60,
  // Record the ending session on sign-out, and reject it on every later read.
  onSignOut(session) {
    if (session.sessionId) revoked.add(session.sessionId);
  },
  isSessionRevoked(session) {
    return session.sessionId !== undefined && revoked.has(session.sessionId);
  },
});
```

`isSessionRevoked` runs for the profile route and protected routes. Sessions issued before these
options existed carry no `sessionId` or issue time; they end at their original expiry.

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
| `instance`                | None                   | Application-owned middleware adapter; disables the built-in flow.            |
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
| `allowedOrigins`          | App origin only        | Extra origins allowed to drive sign-out.                                     |
| `cookieName`              | `farm_auth0_session`   | Session cookie name.                                                         |
| `stateCookieName`         | `farm_auth0_state`     | Login state cookie name.                                                     |
| `sessionMaxAge`           | Token lifetime         | Longest a sign-in lasts, in seconds.                                         |
| `isSessionRevoked`        | None                   | Reject a session the app revoked.                                            |
| `onSignOut`               | None                   | Called with the session being ended on sign-out.                             |

## Cookie names

A sibling subdomain (`evil.example.com` next to `app.example.com`) can set a cookie for
`.example.com` with a longer `Path`. Browsers send that cookie first, so it would pick which session
or login state the app reads. A `__Host-` name cannot be set from another host, so use one in
production:

```ts
auth0({
  cookieName: "__Host-farm_auth0_session",
  stateCookieName: "__Host-farm_auth0_state",
});
```

Farm adds the `Secure`, `Path=/`, and no-`Domain` attributes the prefix requires. Browsers accept
such cookies over https and from `http://localhost`; on another plain-http dev host keep the
defaults. Renaming the session cookie signs existing users out once.

## Cross-site request protection

The sign-out route (`GET /auth/logout`) only accepts requests from the app's own origin. A cross-site
request is answered with `403` before the session is cleared, so another site
cannot force a visitor to sign out.

List any other trusted origin explicitly. The pattern syntax matches
`serverActions.allowedOrigins`:

```ts
auth0({
  allowedOrigins: ["https://portal.example.com", "*.example.com"],
});
```

A sign-out link or bookmark keeps working; only an explicitly cross-site
navigation is rejected.

## Production checklist

- Allow the exact callback URL in Auth0.
- Allow the app origin as a logout URL.
- Use a strong `AUTH0_SECRET`.
- Set `APP_BASE_URL` behind proxies or custom domains.
- Test bad state, callback errors, expired cookies, login return paths, and logout.
