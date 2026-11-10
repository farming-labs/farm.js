# @farm.js/auth

Built-in email/password authentication for Farm.js applications. Set `auth: true` in
`farm.config.ts` and Farm mounts the auth routes, stores database-backed sessions, and exposes
server helpers and a React hook. Better Auth is the engine underneath, but application code never
configures or imports it.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/auth
```

`react` is a peer dependency, used by the client hooks. Better Auth and the `pg` Postgres driver
install with the package. Local development opens SQLite through `node:sqlite` on Node 22 and later,
and falls back to the optional `better-sqlite3` dependency on older Node releases.

To start from a complete app instead:

```bash
pnpm create @farm.js/app my-app --template auth
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  auth: true,
});
```

This is the top-level `auth` framework key, not an `integrations.auth` provider. Farm loads this
package only when the key is enabled. Setting both `auth` and `integrations.auth` is a
configuration error, because each one owns the auth catch-all route.

With no other options, Farm:

- mounts `GET` and `POST` handlers at `/api/auth/[...auth]`;
- enables email/password sign-up and sign-in;
- creates database-backed sessions that last 7 days and refresh daily;
- uses `.farm/auth.sqlite` in development and updates its schema on first use;
- uses Postgres through `DATABASE_URL` in production.

## Server helpers

Read the current session or user in a Server Component, server function, middleware, or route
handler. Both return `null` for an anonymous request.

```ts
import { auth } from "@farm.js/auth/server";

const session = await auth.session();
const user = await auth.user();
```

Pass `required: true` when the request must be signed in. An anonymous request then throws a `401`
response with the code `FARM_AUTH_REQUIRED`:

```ts
const user = await auth.user({ required: true });
```

Both helpers also accept an explicit `request`, as in this route middleware:

```ts
// src/app/dashboard/middleware.ts
import { auth } from "@farm.js/auth/server";

export const config = {
  runtime: "nodejs" as const,
};

export async function middleware(request: Request) {
  const user = await auth.user({ request });

  if (!user) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}
```

## Client helpers

```tsx
"use client";

import { useAuth } from "@farm.js/auth/client";

export function AccountMenu() {
  const { user, isPending, signOut } = useAuth();

  if (isPending) return <span>Loading</span>;
  if (!user) return <a href="/sign-in">Sign in</a>;

  return <button onClick={() => signOut()}>Sign out {user.email}</button>;
}
```

`useAuth` also returns `session`, `error`, `isRefetching`, `refetch`, `signIn`, and `signUp`. The
same functions are exported directly for forms that do not need the hook:

```ts
import { signIn, signUp } from "@farm.js/auth/client";

await signUp({ name: "Ada Lovelace", email: "ada@example.com", password: "a-long-password" });
await signIn({ email: "ada@example.com", password: "a-long-password" });
```

`getSession` is exported as well. When `basePath` is customized, create matching helpers once with
`createFarmAuthClient({ basePath: "/account/auth" })`. It also accepts `baseURL` for clients that
do not run in the browser.

## Options

| Option                                      | Default             | Notes                                       |
| ------------------------------------------- | ------------------- | ------------------------------------------- |
| `enabled`                                   | `true`              | Set `false` to disable without removing it. |
| `appName`                                   | `"Farm app"`        | Name used in auth metadata and emails.      |
| `basePath`                                  | `"/api/auth"`       | Route prefix. Must be a plain pathname.     |
| `emailAndPassword`                          | enabled             | Set `false` to disable.                     |
| `emailAndPassword.requireEmailVerification` | `false`             |                                             |
| `emailAndPassword.minPasswordLength`        | `8`                 |                                             |
| `emailAndPassword.maxPasswordLength`        | `128`               |                                             |
| `session.expiresIn`                         | `604800`            | Session lifetime in seconds.                |
| `session.updateAge`                         | `86400`             | Refresh interval in seconds.                |
| `database.url`                              | `DATABASE_URL`      | Postgres connection string.                 |
| `database.path`                             | `.farm/auth.sqlite` | Local SQLite file.                          |
| `database.migrateInDevelopment`             | `true`              | Update the local schema on first use.       |

`auth: { enabled: true }` is equivalent to `auth: true`.

## Environment and deployment

| Variable           | Purpose                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | Postgres connection string. Required in production.                                       |
| `FARM_AUTH_SECRET` | Signing secret, required in production. `AUTH_SECRET` and `BETTER_AUTH_SECRET` also work. |
| `FARM_AUTH_URL`    | Public origin. `BETTER_AUTH_URL` is also read. Inferred on Vercel when unset.             |

Without `FARM_AUTH_URL`, `farm dev` trusts the origin it is serving the request on when the host is
`localhost`, `*.localhost`, or an IP address, so other ports, the Android emulator's `10.0.2.2`, and
LAN devices under `--host` can sign in. Production trusts only the configured origin.

Without a secret, development generates a random one in `.farm/auth-secret` and reuses it across
restarts. Loading `farm.config.ts` and running `farm build` never connect to the database. Apply the
production schema before serving traffic:

```bash
farm auth migrate
farm auth migrate --dry-run
farm auth migrate --write auth-schema.sql
```

The first command applies the schema. `--dry-run` prints the statements and `--write` saves them to
a file, without changing the database. The command needs `DATABASE_URL` but not the secret.

Sign-in rate limiting keys on the client address Farm resolves for the request. Behind a proxy,
enable `server.trustProxy` so visitors are not all counted as the proxy's address.

## Entry points

- `@farm.js/auth/server`: the `auth.session()` and `auth.user()` helpers.
- `@farm.js/auth/client`: `useAuth`, `signIn`, `signUp`, `signOut`, `getSession`, and
  `createFarmAuthClient`. React Native screens (`page.native.tsx`) use the same import: Metro
  resolves its `react-native` build, which calls the auth routes through `serverFetch` from
  `@farm.js/native` (an optional peer). `signIn` and `signUp` go through the mobile shell's native
  code, which keeps the session cookie in the WebView and issues the device token; social sign-in
  rejects there for now. Web bundles do not change.
- `@farm.js/auth`: `resolveFarmAuthConfig` and the configuration and session types, such as
  `FarmAuthConfig`, `FarmAuthSession`, and `FarmAuthUser`.
- `@farm.js/auth/internal`: loaded by Farm core and `farm auth migrate`. Applications do not
  import it.

Use [`@farm.js/better-auth`](https://www.npmjs.com/package/@farm.js/better-auth) instead when the
application needs Better Auth plugins, adapters, social providers, or the raw instance API.

## Documentation

- [Built-in Authentication](https://farmjs.dev/docs/auth)
- [Auth Integrations](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
