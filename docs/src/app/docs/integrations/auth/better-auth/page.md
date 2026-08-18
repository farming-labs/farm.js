---
title: "Better Auth Integration"
description: "Mount a Better Auth instance in Farm and use its native client, database adapter, methods, and plugins."
section: "Integrations"
---

# Better Auth Integration

Most applications should begin with [Farm Auth](/docs/auth), which reduces email/password auth to `auth: true` and supplies Farm-owned server helpers and React APIs.

This lower-level integration remains the supported extension path when the app needs raw Better Auth plugins, adapters, providers, callbacks, or instance APIs. It is not deprecated by built-in auth. Farm mounts the handler, while the application owns the Better Auth configuration and Better Auth remains the source of truth for the auth API.

Use either top-level `auth` or `integrations.auth`, not both. They are alternative owners of the same auth catch-all route.

For a complete application-owned example, use the [Farm.js Better Auth Starter](https://github.com/farming-labs/farmjs-better-auth-starter). It keeps the Better Auth instance, database adapter, native client, and extension points explicit.

## SDK ownership

Better Auth is application-owned only. Farm cannot construct it from a small credential set because
the database, adapters, providers, plugins, callbacks, migrations, and cookie behavior are part of
the application's auth design. Create the Better Auth object in application code and pass it through
`instance`; Farm owns only catch-all route mounting and integration logging.

For a Farm-constructed alternative, use top-level [Farm Auth](/docs/auth). Do not configure both
ownership models in the same application.

## Add Better Auth

**Terminal**

```bash
farm add integration better-auth --ui
```

The command adds `better-auth` and its SQLite driver, creates a local SQLite-backed server instance, writes
`.env.example`, and, with `--ui`, adds a working sign-up, sign-in, session, and sign-out screen at
`/integrations/better-auth`.

## Create the server instance

**src/lib/auth.ts**

```ts
import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { getMigrations } from "better-auth/db/migration";

export const auth = betterAuth({
  database: new Database(process.env.BETTER_AUTH_DATABASE_PATH || "better-auth.sqlite"),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
});

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
```

The generated SQLite setup is designed to work immediately in local development. Configure a
persistent production database, managed migrations, social providers, plugins, and callbacks
before deploying. These settings remain in Better Auth rather than being duplicated in Farm
config.

## Register it

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { auth } from "./src/lib/auth";

export default defineConfig({
  integrations: {
    auth: {
      provider: "better-auth",
      instance: auth,
    },
  },
});
```

Farm loads the installed `@farm.js/better-auth` adapter from `provider`; application code does not
import or call the adapter factory. The `@farm.js/better-auth` and
`@farm.js/integrations/better-auth` factory imports remain supported when an application constructs
the complete Farm integration object itself.

Farm mounts the instance handler for both methods:

```text
GET  /api/auth/[...auth]
POST /api/auth/[...auth]
```

There is no app-local `src/app/api/auth/[...auth]/route.ts` file to maintain.

Do not also add the top-level `auth` key when this integration owns authentication.

## Create the browser client

**src/lib/auth-client.ts**

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "",
});
```

An empty `baseURL` keeps browser calls on the current Farm origin.

## Use Better Auth

```ts
const result = await authClient.signIn.email({
  email: "ada@example.com",
  password: "correct-horse-battery-staple",
});
```

```ts
const session = await authClient.getSession();
await authClient.signOut();
```

The available methods and response types come from Better Auth and its plugins. Farm does not generate a parallel `api.auth` caller tree for the catch-all handler.

## Protect application routes

`betterAuth(...)` does not accept `protectedRoutes`. Read the session with Better Auth in server code or call the instance from [Farm middleware](/docs/middleware), then apply your app's authorization rules.

For client-only guards, wait for `authClient.getSession()` before rendering private data, but keep sensitive authorization on the server.

## What Farm owns

| Farm                                              | Better Auth                                                  |
| ------------------------------------------------- | ------------------------------------------------------------ |
| Registers the integration in `farm.config.ts`.    | Defines users, accounts, sessions, and verification records. |
| Mounts `GET` and `POST` on `/api/auth/[...auth]`. | Routes each auth action inside the catch-all handler.        |
| Adds integration logging around mounted requests. | Owns adapters, providers, plugins, callbacks, and cookies.   |
| Removes the need for a manual route module.       | Supplies the React client and server APIs.                   |

## Adapter options

| Option     | Required | Use                                                    |
| ---------- | -------- | ------------------------------------------------------ |
| `instance` | Yes      | Better Auth instance with a `handler(request)` method. |
| `log`      | No       | Farm integration lifecycle and route logger.           |

## Production checklist

- Set a strong `BETTER_AUTH_SECRET` and the public `BETTER_AUTH_URL`.
- Configure a persistent production database and run Better Auth migrations.
- Keep database and OAuth credentials server-only.
- Verify trusted origins, cookies, and proxy headers on the deployed origin.
- Test sign-up, sign-in, session reads, sign-out, provider callbacks, and every enabled plugin.
