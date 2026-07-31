---
title: "Authentication"
description: "Enable Farm-native email/password authentication with one config key, server helpers, and a React hook."
section: "Core"
---

# Authentication

Farm Auth is the high-level path for applications that need ordinary email/password authentication without configuring a provider instance.

Install the runtime package:

```bash
pnpm add @farm.js/auth
```

Then enable it in Farm:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  auth: true,
});
```

That one key:

- enables email/password sign-up and sign-in;
- mounts `GET` and `POST` auth actions below `/api/auth`;
- creates and refreshes database-backed sessions;
- exposes Farm server helpers and React APIs;
- uses `.farm/auth.sqlite` in local development;
- uses `DATABASE_URL` in production.

`auth: { enabled: true }` is also accepted when keeping feature switches in object form. `auth: true` is the canonical shorthand.

## Server helpers

Read the current session or user from a Server Component, server function, middleware, or route handler:

```ts
import { auth } from "@farm.js/auth/server";

const session = await auth.session();
const user = await auth.user();
```

Both return `null` for an anonymous request. Use the same methods with `required: true` when the request must be authenticated:

```ts
const user = await auth.user({ required: true });
```

An anonymous request throws a `401` response with the stable code `FARM_AUTH_REQUIRED`. There is no separate `requireUser` API to learn.

Farm Auth does not configure or inspect pages. Authentication answers who made the current request; each page, server function, or API route decides what that user may do.

## React hook

Use `useAuth` in a Client Component:

```tsx
"use client";

import { useAuth } from "@farm.js/auth/client";

export function AccountMenu() {
  const { user, isPending, signOut } = useAuth();

  if (isPending) return <span>Loading…</span>;
  if (!user) return <a href="/sign-in">Sign in</a>;

  return <button onClick={() => signOut()}>Sign out {user.email}</button>;
}
```

The client entry also exports `signIn`, `signUp`, `signOut`, and `getSession` for forms that do not need the hook:

```ts
import { signIn, signUp } from "@farm.js/auth/client";

await signUp({
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse-battery-staple",
});

await signIn({
  email: "ada@example.com",
  password: "correct-horse-battery-staple",
});
```

## Configuration

The default is intentionally useful. Add options only when application policy differs:

```ts
export default defineConfig({
  auth: {
    enabled: true,
    appName: "Acme",
    emailAndPassword: {
      requireEmailVerification: true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
  },
});
```

| Option                          | Default             | Purpose                                           |
| ------------------------------- | ------------------- | ------------------------------------------------- |
| `enabled`                       | `true`              | Temporarily disable configured auth.              |
| `appName`                       | `"Farm app"`        | Name used in auth metadata and messages.          |
| `basePath`                      | `"/api/auth"`       | Route prefix for auth actions.                    |
| `emailAndPassword`              | enabled             | Email verification and password length policy.    |
| `session`                       | 7 days              | Session lifetime and refresh interval in seconds. |
| `database.url`                  | `DATABASE_URL`      | Explicit Postgres connection string.              |
| `database.path`                 | `.farm/auth.sqlite` | Local SQLite path.                                |
| `database.migrateInDevelopment` | `true`              | Update the local schema lazily on first auth use. |

This interface stays at application-policy level. It does not expose a Better Auth instance or require Better Auth imports in application code.

If `basePath` is customized, create matching client helpers once:

```ts
import { createFarmAuthClient } from "@farm.js/auth/client";

export const { useAuth, signIn, signUp, signOut } = createFarmAuthClient({
  basePath: "/account/auth",
});
```

## Database and deployment

Local schema creation happens lazily when auth is first used. Loading `farm.config.ts` and running `farm build` never connect to the database and never run migrations.

For production, set:

```bash
DATABASE_URL=postgres://...
FARM_AUTH_SECRET=...
FARM_AUTH_URL=https://example.com
```

`AUTH_SECRET` and `BETTER_AUTH_SECRET` remain accepted as secret aliases. Vercel deployments infer the auth URL from `VERCEL_URL` when `FARM_AUTH_URL` is absent.

Apply the production schema before serving traffic:

```bash
farm auth migrate
```

The migration command needs `DATABASE_URL`, but it does not require the runtime secret.

## Provider integrations

Use the top-level `auth` key for the built-in, opinionated path. If the application needs a provider-owned UI, enterprise SSO, raw Better Auth plugins, or another provider-specific API, use one of the [auth integrations](/docs/integrations/auth) instead.

Do not configure both `auth` and `integrations.auth`; they would compete for the same auth route, so Farm reports a configuration error.
