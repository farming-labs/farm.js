# @farm.js/auth0

Auth0 login for Farm.js applications. The integration owns the application-facing OAuth routes:
it runs the Authorization Code flow with PKCE, validates signed state, reads the user profile, and
keeps it in a signed HTTP-only session cookie. Auth0 keeps hosting the login screens, connections,
and user records.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/auth0
```

The integration talks to Auth0 over HTTP, so no Auth0 SDK is required. To scaffold the registry
entry and a sign-in screen in an existing app, run `farm add integration auth0 --ui`.

## Configure

```ts
// src/lib/integrations.ts
import { auth0 } from "@farm.js/auth0";

export const appIntegrations = {
  auth: auth0({
    callbackPath: "/auth/callback",
    protectedRoutes: ["/dashboard(.*)"],
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { appIntegrations } from "./src/lib/integrations";

export default defineConfig({
  integrations: appIntegrations,
});
```

Credentials come from the environment unless they are passed as options:

| Variable              | Purpose                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `AUTH0_DOMAIN`        | Tenant domain, such as `tenant.us.auth0.com`. Required.                     |
| `AUTH0_CLIENT_ID`     | Application client ID. Required.                                            |
| `AUTH0_CLIENT_SECRET` | Client secret for confidential applications.                                |
| `AUTH0_SECRET`        | Signs the state and session cookies. Required outside development and test. |
| `APP_BASE_URL`        | Public origin used for callbacks and redirects.                             |

When `AUTH0_SECRET` is unset in development, a random secret is generated once in
`.farm/auth0-secret` and reused across restarts. Tests get a random secret for the life of the
process. Any other `NODE_ENV` fails at startup without one.

`callbackPath` is combined with `APP_BASE_URL`, or with the request origin, to build the callback
URL. Pass an absolute `callbackUrl` instead when the callback is fixed. Register that exact URL in
Auth0.

## Routes

| Method | Default route    | Purpose                                                      |
| ------ | ---------------- | ------------------------------------------------------------ |
| `GET`  | `/auth/login`    | Starts login. Accepts a root-relative `returnTo`.            |
| `GET`  | `/auth/signup`   | Starts login on Auth0's sign-up screen.                      |
| `GET`  | `/auth/callback` | Validates state, exchanges the code, writes the session.     |
| `GET`  | `/auth/logout`   | Clears the session and redirects through Auth0 logout.       |
| `GET`  | `/auth/profile`  | Returns `{ authenticated, user }`, or `401` when signed out. |

Change them with `loginPath`, `signUpPath`, `callbackPath`, `logoutPath`, and `profilePath`. A
signed-out request to a `protectedRoutes` match is redirected to the login route with the original
path in `returnTo`.

A plain link such as `<a href="/auth/login?returnTo=/dashboard">` starts login. For typed calls,
create clients from the registry, `api` for server code and `apiClient` for the browser:

```ts
// src/lib/api.ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

```ts
const profile = await api.auth.profile.get();
const user = profile.data?.user;

const login = await apiClient.auth.login.get({ query: { returnTo: "/dashboard" } });
if (login.data) window.location.assign(login.data.redirectTo);
```

`@farm.js/auth0/client` exports `auth0Client`, the same operations bound to the default paths, and
their result types (`Auth0ProfileResult`, `Auth0RedirectResult`, `Auth0RedirectQuery`).

## Sessions

The session is a signed cookie, not a server record, so sign-out clears it only in that browser. By
default it lasts as long as the token Auth0 returns, and no refresh token is kept. Narrow that
window with these options:

```ts
const revoked = new Set<string>(); // use a shared store such as Redis in production

auth0({
  // A sign-in lasts at most an hour, whatever the token lifetime.
  sessionMaxAge: 60 * 60,
  onSignOut(session) {
    if (session.sessionId) revoked.add(session.sessionId);
  },
  isSessionRevoked(session) {
    return session.sessionId !== undefined && revoked.has(session.sessionId);
  },
});
```

`isSessionRevoked` runs for the profile route and for protected routes.

## Options

`domain`, `clientId`, `clientSecret`, `secret`, and `appBaseUrl` override the variables above.
`callbackUrl` and `callbackPath` set the callback, and the route path options rename the routes.

| Option                    | Default                | Notes                                                     |
| ------------------------- | ---------------------- | --------------------------------------------------------- |
| `audience`                |                        | Auth0 API audience.                                       |
| `scopes`                  | `openid profile email` |                                                           |
| `tokenEndpointAuthMethod` | `auto`                 | `client_secret_basic`, `client_secret_post`, or `none`.   |
| `protectedRoutes`         |                        | One matcher or a list.                                    |
| `allowedOrigins`          | app origin             | Extra origins allowed to drive sign-out.                  |
| `cookieName`              | `farm_auth0_session`   | Use a `__Host-` name in production.                       |
| `stateCookieName`         | `farm_auth0_state`     | Must differ from `cookieName`.                            |
| `sessionMaxAge`           | token lifetime         | Seconds, at least 60.                                     |
| `isSessionRevoked`        |                        | Return `true` to treat a session as signed out.           |
| `onSignOut`               |                        | Called with the session being ended.                      |
| `instance`                |                        | App-owned middleware adapter. Disables the built-in flow. |
| `log`                     |                        | Integration lifecycle logger.                             |

The sign-out route answers a request the browser marks as cross-site with `403`, so another site
cannot sign a visitor out. A plain link or bookmark still works.

## Bring your own middleware

`instance` accepts an object with `middleware(request)` and an optional `matcher` (default
`/auth(.*)`). It is not an Auth0 SDK client. When it is set, Farm mounts only that middleware and
creates none of the routes above.

## Documentation

- [Auth0 integration](https://farmjs.dev/docs/integrations/auth/auth0)
- [Auth integrations overview](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
