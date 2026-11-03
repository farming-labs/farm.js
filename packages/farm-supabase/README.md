# @farm.js/supabase

Supabase Auth for Farm.js applications. The integration mounts server-side routes for
email/password sign-in and sign-up, OAuth redirects, the callback exchange, logout, and session
reads, keeps Supabase's SSR cookies in sync, and can redirect signed-out visitors away from
protected pages.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/supabase
```

`@supabase/ssr` and `@supabase/supabase-js` are dependencies and install with the package. To
scaffold the registry entry and sign-in screens in an existing app, run
`farm add integration supabase --ui`.

## Configure

```ts
// src/lib/integrations.ts
import { supabase } from "@farm.js/supabase";

export const appIntegrations = {
  auth: supabase({
    callbackPath: "/auth/callback",
    providers: ["github"],
    protectedRoutes: ["/dashboard(.*)"],
    pages: {
      signIn: "/sign-in",
      signUp: "/sign-up",
    },
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

Omit `pages` to use Farm's built-in server-rendered sign-in and sign-up forms. With custom pages,
`GET /auth/login` and `GET /auth/signup` redirect to them unless an OAuth provider is being started.

The integration uses the project's anonymous or publishable key. It never needs the service-role
key, so keep that out of `supabase(...)`. Values come from the environment:

- Project URL: `SUPABASE_URL`, then `NEXT_PUBLIC_SUPABASE_URL`.
- Anon or publishable key: the first one set of `SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`.
- Public app origin: `APP_BASE_URL`.

The URL and key are required unless an `instance` factory is passed. They can also be passed as
`url` and `anonKey`.

## Routes

| Method        | Default route    | Purpose                                                           |
| ------------- | ---------------- | ----------------------------------------------------------------- |
| `GET`         | `/auth/login`    | Renders or redirects to sign-in, or starts OAuth with `provider`. |
| `POST`        | `/auth/login`    | Signs in with email and password.                                 |
| `GET`         | `/auth/signup`   | Renders or redirects to sign-up.                                  |
| `POST`        | `/auth/signup`   | Creates an email/password account.                                |
| `GET`         | `/auth/callback` | Exchanges the authorization code for a session.                   |
| `GET`, `POST` | `/auth/logout`   | Signs out and redirects.                                          |
| `GET`         | `/auth/session`  | Returns `{ authenticated, user }`, or `401` when signed out.      |

Change them with `loginPath`, `signupPath`, `callbackPath`, `logoutPath`, and `sessionPath`. Every
route forwards Supabase's `Set-Cookie` headers, so token refreshes reach the browser.

`protectedRoutes` verifies the session with Supabase Auth (`getUser()`, not just the cookie) and
redirects a signed-out request to the sign-in page with the original path in `returnTo`.

## Typed calls

```ts
// src/lib/api.ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

```ts
const result = await apiClient.auth.login.post({
  body: { email: "ada@example.com", password: "a-long-password", returnTo: "/dashboard" },
});
if (result.data) window.location.assign(result.data.redirectTo);

const oauth = await apiClient.auth.oauth.get({ query: { provider: "github" } });
const session = await api.auth.session.get();
await apiClient.auth.logout.post({ body: { returnTo: "/" } });
```

`apiClient.auth.signup.post` takes the same body. When the project requires email confirmation, its
result includes `emailConfirmationRequired`, `email`, and a user-facing `message`.

The login and sign-up routes also accept HTML form posts with the field names in
`supabaseAuthFormFields` (`email`, `password`, `returnTo`). `@farm.js/supabase/client` exports that
object, `supabaseClient` with the operations bound to the default paths, and the request and result
types.

## Bring your own client

Supabase SSR clients are bound to one request's cookies, so `instance` is a factory that Farm calls
for every request. Keep the `options` it receives, because they carry Farm's cookie adapter:

```ts
import { supabase } from "@farm.js/supabase";

export const auth = supabase({
  instance: ({ createClient, options }) =>
    createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      ...options,
      global: {
        ...options.global,
        headers: { ...options.global?.headers, "x-application-name": "farm-dashboard" },
      },
    }),
  protectedRoutes: ["/dashboard(.*)"],
});
```

The factory also receives `request`, plus `url` and `anonKey` when those are configured. Do not
create the client outside the factory or cache what it returns.

## Options

| Option            | Default              | Notes                                          |
| ----------------- | -------------------- | ---------------------------------------------- |
| `instance`        |                      | Request-scoped client factory.                 |
| `url`             | Supabase URL env     |                                                |
| `anonKey`         | anon/publishable env | Never the service-role key.                    |
| `appBaseUrl`      | `APP_BASE_URL`       | Public origin for callbacks and redirects.     |
| `callbackUrl`     |                      | Absolute callback URL.                         |
| `callbackPath`    | `/auth/callback`     | Used when `callbackUrl` is not set.            |
| `providers`       | `[]`                 | OAuth buttons shown on the built-in form.      |
| `defaultProvider` |                      | Provider started by a plain `GET /auth/login`. |
| `pages.signIn`    | built-in form        | App-owned sign-in page.                        |
| `pages.signUp`    | built-in form        | App-owned sign-up page.                        |
| `protectedRoutes` |                      | One matcher or a list.                         |
| `allowedOrigins`  | app origin           | Extra origins allowed to post the auth routes. |
| `log`             |                      | Integration lifecycle logger.                  |

Sign-in, sign-up, and sign-out only accept requests from the app's own origin, plus any
`allowedOrigins`. A cross-site post gets `403` before any credential is read. A plain
`GET /auth/logout` link keeps working.

## Documentation

- [Supabase integration](https://farmjs.dev/docs/integrations/auth/supabase)
- [Auth integrations overview](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
