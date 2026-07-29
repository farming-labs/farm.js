---
title: "Supabase Integration"
description: "Use Supabase email/password auth, OAuth, SSR sessions, custom pages, and protected Farm routes."
section: "Integrations"
---

# Supabase Integration

The Supabase adapter creates a complete server-side auth surface: email/password sign-in and signup, OAuth redirects, callback exchange, SSR cookie updates, logout, session reads, and protected-route redirects.

It uses the Supabase anonymous or publishable key. A service-role key is neither accepted nor needed for these user auth flows.

## Add Supabase

**Terminal**

```bash
farm add integration supabase --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { supabase } from "@farm.js/integrations/supabase";

export const appIntegrations = {
  auth: supabase({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    appBaseUrl: process.env.APP_BASE_URL,
    callbackPath: "/auth/callback",
    providers: ["github", "google"],
    protectedRoutes: ["/dashboard(.*)"],
    pages: {
      signIn: "/sign-in",
      signUp: "/sign-up",
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

Omit `pages` to use Farm's built-in server-rendered sign-in and sign-up forms. When custom page paths are configured, `GET /auth/login` and `GET /auth/signup` redirect to those pages unless an OAuth provider is being started.

## Environment variables

Farm accepts the standard Supabase URL plus any of these anonymous or publishable key names:

| Value                 | Accepted variables                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project URL           | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`                                                                                                                               |
| Browser-safe auth key | `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` |
| Public app origin     | `APP_BASE_URL`                                                                                                                                                           |

Keep service-role credentials in separate server code that performs administrative operations. Do not expose them to auth pages or pass them to `supabase(...)`.

## Routes and methods

| Method        | Default route    | Purpose                                                           |
| ------------- | ---------------- | ----------------------------------------------------------------- |
| `GET`         | `/auth/login`    | Renders or redirects to sign-in, or starts OAuth with `provider`. |
| `POST`        | `/auth/login`    | Signs in with email and password.                                 |
| `GET`         | `/auth/signup`   | Renders or redirects to sign-up.                                  |
| `POST`        | `/auth/signup`   | Creates an email/password account.                                |
| `GET`         | `/auth/callback` | Exchanges a Supabase authorization code for a session.            |
| `GET`, `POST` | `/auth/logout`   | Signs out, updates cookies, and redirects.                        |
| `GET`         | `/auth/session`  | Returns the authenticated user or `401`.                          |

Paths can be changed with `loginPath`, `signupPath`, `callbackPath`, `logoutPath`, and `sessionPath`.

## Email and password

```ts
const result = await apiClient.auth.login.post({
  body: {
    email: "ada@example.com",
    password: "correct-horse-battery-staple",
    returnTo: "/dashboard",
  },
});

if (result.data) {
  window.location.assign(result.data.redirectTo);
}
```

Signup uses the same credential shape:

```ts
const result = await apiClient.auth.signup.post({
  body: {
    email: "ada@example.com",
    password: "correct-horse-battery-staple",
    returnTo: "/dashboard",
  },
});
```

When email confirmation is required, the result includes `emailConfirmationRequired`, `email`, and a user-facing `message`, then points back to the sign-in page.

## OAuth

Enable each provider in Supabase and register the Farm callback URL. Include it in `providers` when the built-in form should render a button for it.

```ts
const result = await apiClient.auth.oauth.get({
  query: {
    provider: "github",
    returnTo: "/dashboard",
  },
});

if (result.data) {
  window.location.assign(result.data.redirectTo);
}
```

`defaultProvider` can start one provider when `/auth/login` is opened without a `provider` query.

## Session and logout

```ts
const session = await api.auth.session.get();

if (session.data?.authenticated) {
  console.log(session.data.user);
}

const logout = await apiClient.auth.logout.post({
  body: {
    returnTo: "/",
  },
});
```

Every auth request forwards Supabase's updated `Set-Cookie` headers, allowing token refreshes from the server client to reach the browser.

## Protect app routes

```ts
supabase({
  protectedRoutes: ["/dashboard(.*)", "/settings(.*)"],
  pages: {
    signIn: "/sign-in",
    signUp: "/sign-up",
  },
});
```

The middleware checks the current Supabase cookie session. Signed-out requests redirect to the configured sign-in page with a root-relative `returnTo`.

## Options

| Option            | Default                       | Use                                          |
| ----------------- | ----------------------------- | -------------------------------------------- |
| `url`             | Supabase URL env              | Project URL.                                 |
| `anonKey`         | Anonymous/publishable key env | Browser-safe project key.                    |
| `appBaseUrl`      | `APP_BASE_URL`                | Public app origin.                           |
| `callbackUrl`     | None                          | Absolute callback URL.                       |
| `callbackPath`    | `/auth/callback`              | Callback route when `callbackUrl` is absent. |
| `providers`       | `[]`                          | OAuth providers shown by the built-in form.  |
| `defaultProvider` | None                          | Provider started by a plain login request.   |
| `pages.signIn`    | Built-in form                 | Custom sign-in page path.                    |
| `pages.signUp`    | Built-in form                 | Custom sign-up page path.                    |
| `protectedRoutes` | None                          | One matcher or a list of matchers.           |

## Production checklist

- Register the exact callback URL in Supabase.
- Use the publishable or anonymous key, never the service-role key.
- Set `APP_BASE_URL` behind proxies or custom domains.
- Test projects with and without email confirmation.
- Test OAuth callback errors, refreshed cookies, logout return paths, and protected routes.
