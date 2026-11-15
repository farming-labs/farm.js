# @farm.js/workos

WorkOS AuthKit sign-in for Farm.js applications. The integration mounts the login, sign-up,
callback, logout, and session routes, stores the AuthKit session in a sealed cookie, and can
redirect signed-out visitors away from protected pages. WorkOS keeps owning organizations, SSO
connections, and user management.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/workos
```

The WorkOS Node SDK, `@workos-inc/node`, is a dependency and installs with the package. Add it to
the app directly only when the app constructs its own client (see below). To scaffold the registry
entry and a sign-in screen in an existing app, run `farm add integration workos --ui`.

## Configure

```ts
// src/lib/integrations.ts
import { workos } from "@farm.js/workos";

export const appIntegrations = {
  auth: workos({
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

Values come from the environment unless they are passed as `clientId`, `apiKey`, and
`cookiePassword`:

| Variable                      | Purpose                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`            | AuthKit client ID. Required unless the `instance` carries one.   |
| `WORKOS_API_KEY`              | Server API key. Required unless an `instance` is passed.         |
| `WORKOS_COOKIE_PASSWORD`      | Seals the session cookie. Required outside development and test. |
| `FARM_WORKOS_COOKIE_PASSWORD` | Alternative name for the cookie password.                        |

When no cookie password is set in development, a random one is generated once in
`.farm/workos-secret` and reused across restarts. Tests get a random one for the life of the
process. Any other `NODE_ENV` fails at startup without one.

## Routes

| Method | Default route   | Purpose                                                      |
| ------ | --------------- | ------------------------------------------------------------ |
| `GET`  | `/login`        | Starts AuthKit sign-in. Accepts a root-relative `returnTo`.  |
| `GET`  | `/signup`       | Starts AuthKit sign-up.                                      |
| `GET`  | `/callback`     | Verifies state, exchanges the code, stores the session.      |
| `POST` | `/logout`       | Clears the cookie and redirects through WorkOS logout.       |
| `GET`  | `/auth/session` | Returns the user, session ID, and organization ID, or `401`. |

Change them with `loginPath`, `signUpPath`, `callbackPath`, `logoutPath`, and `sessionPath`. The
redirect URI sent to WorkOS is `callbackPath` on the request origin, for example
`https://app.example.com/callback`; register that exact URL in WorkOS.

A signed-out request to a `protectedRoutes` match is redirected to the login route with the original
path in `returnTo`.

## Typed calls

```ts
// src/lib/api.ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

```ts
const session = await api.auth.session.get();
const organizationId = session.data?.organizationId;

const logout = await apiClient.auth.logout.post();
if (logout.data) window.location.assign(logout.data.redirectTo);
```

Document navigation works too, for example `<a href="/login?returnTo=/dashboard">Sign in</a>`.
`@farm.js/workos/client` exports `workosClient`, the same operations bound to the default paths,
and their result types (`WorkOSSessionResult`, `WorkOSRedirectResult`, `WorkOSRedirectQuery`).

The organization ID identifies the WorkOS organization. Map it to your own tenant record and
resolve roles and permissions in the application.

## Bring your own client

Pass a configured SDK through `instance` when the app needs constructor options Farm does not own.
`apiKey` is then not required, and the client ID can come from the instance. The cookie password is
still required, because Farm owns the sealed session cookie.

```ts
import { WorkOS } from "@workos-inc/node";
import { workos } from "@farm.js/workos";

const client = new WorkOS({
  apiKey: process.env.WORKOS_API_KEY,
  clientId: process.env.WORKOS_CLIENT_ID,
});

export const auth = workos({
  instance: client,
  protectedRoutes: ["/dashboard(.*)"],
});
```

## Options

| Option            | Default             | Notes                                                    |
| ----------------- | ------------------- | -------------------------------------------------------- |
| `instance`        |                     | Existing `WorkOS` client. Wins over `clientId`/`apiKey`. |
| `clientId`        | `WORKOS_CLIENT_ID`  |                                                          |
| `apiKey`          | `WORKOS_API_KEY`    |                                                          |
| `cookiePassword`  | cookie password env |                                                          |
| `cookieName`      | `wos-session`       | Use a `__Host-` name in production.                      |
| `stateCookieName` | `farm_workos_state` | Must differ from `cookieName`.                           |
| `protectedRoutes` |                     | One matcher or a list.                                   |
| `allowedOrigins`  | app origin          | Extra origins allowed to post sign-out.                  |
| `log`             |                     | Integration lifecycle logger.                            |

The sign-out route only accepts posts from the app's own origin, plus any `allowedOrigins`. A
cross-site request gets `403` before the session is cleared.

## Documentation

- [WorkOS integration](https://farmjs.dev/docs/integrations/auth/workos)
- [Auth integrations overview](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
