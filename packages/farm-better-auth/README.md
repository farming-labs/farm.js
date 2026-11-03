# @farm.js/better-auth

Better Auth route mounting for Farm.js applications. Pass an application-owned Better Auth instance
and Farm mounts its handler at `/api/auth/[...auth]`, so there is no route module to maintain. The
application keeps full control of the database adapter, plugins, providers, and callbacks, and uses
Better Auth's own server API and client.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/better-auth better-auth
```

This package has no Better Auth dependency of its own. The application installs `better-auth` and
the database driver it uses. `farm add integration better-auth --ui` adds `better-auth` with a local
SQLite driver, writes `src/lib/auth.ts` and `.env.example`, and adds a working sign-in screen.

To start from a complete app instead:

```bash
pnpm create @farm.js/app my-app --template better-auth
```

For plain email/password with no Better Auth configuration in app code, use top-level Farm Auth,
[`@farm.js/auth`](https://www.npmjs.com/package/@farm.js/auth), instead.

## Create the instance

This example uses a local SQLite file through `better-sqlite3` (`pnpm add better-sqlite3`):

```ts
// src/lib/auth.ts
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
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

This SQLite setup is meant for local development. Configure a persistent production database and
managed migrations in Better Auth before deploying.

## Register it

```ts
// src/lib/integrations.ts
import { betterAuth } from "@farm.js/better-auth";
import { auth } from "./auth";

export const appIntegrations = {
  auth: betterAuth({
    instance: auth,
  }),
} as const;
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { appIntegrations } from "./src/lib/integrations";

export default defineConfig({
  integrations: appIntegrations,
});
```

Farm passes every request under the catch-all to `instance.handler(request)`:

```text
GET  /api/auth/[...auth]
POST /api/auth/[...auth]
```

That is Better Auth's default `/api/auth` base path. Do not also set the top-level `auth` key: both
own the same route, and Farm reports a configuration error rather than choosing one.

## Use Better Auth

Use Better Auth's client in the browser. An empty `baseURL` keeps calls on the current origin:

```ts
// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "",
});
```

```ts
await authClient.signIn.email({ email: "ada@example.com", password: "a-long-password" });
const session = await authClient.getSession();
await authClient.signOut();
```

Methods and response types come from Better Auth and its plugins. Farm generates no parallel
`api.auth` caller for this integration.

`betterAuth(...)` has no `protectedRoutes` option. Read the session with Better Auth in server code,
or call the instance from [Farm middleware](https://farmjs.dev/docs/middleware), then apply the
app's authorization rules.

## Options

| Option     | Required | Notes                                                          |
| ---------- | -------- | -------------------------------------------------------------- |
| `instance` | Yes      | A Better Auth instance, or any object with `handler(request)`. |
| `log`      | No       | Integration lifecycle and route logger.                        |

## Production checklist

- Set a strong `BETTER_AUTH_SECRET` and the public `BETTER_AUTH_URL`.
- Use a persistent database and run Better Auth migrations before serving traffic.
- Keep database and OAuth credentials server-only.
- Verify trusted origins, cookies, and proxy headers on the deployed origin.

When Better Auth runs inside Convex as a component, this integration is not used;
[`@farm.js/convex`](https://farmjs.dev/docs/integrations/convex) handles the auth routes instead.

## Documentation

- [Better Auth integration](https://farmjs.dev/docs/integrations/auth/better-auth)
- [Auth integrations overview](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
