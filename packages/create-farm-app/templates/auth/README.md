# FARMJS Auth Starter

A standalone email/password authentication starter using FARMJS built-in authentication and
React.

This project was generated from the FARMJS Auth template included with `@farm.js/create-app`.

## Included

- email/password sign-up and sign-in enabled by `auth: true`
- database-backed, HTTP-only session cookies
- a server-middleware-protected `/dashboard`
- `@farm.js/auth/server` request helpers and the `@farm.js/auth/client` React hook
- automatic local SQLite storage in `.farm/auth.sqlite`
- production Postgres support through `DATABASE_URL`
- a dark-first, one-page welcome screen set in Geist Sans and Geist Mono
- pending, error, unauthorized, loading, and not-found states
- exact FARMJS beta dependencies for reproducible installs

## Quick start

```bash
pnpm create @farm.js/app@beta my-app --template auth --typescript
cd my-app
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and continue to the
protected dashboard. Local development needs no database or auth environment variables; FARMJS Auth
creates and migrates `.farm/auth.sqlite` when auth is first used.

## How it is wired

- [`farm.config.ts`](./farm.config.ts) enables email/password authentication with `auth: true`.
- [`src/app/page.tsx`](./src/app/page.tsx) reads the current session with
  `auth.session()` from `@farm.js/auth/server`.
- [`src/components/auth-form.tsx`](./src/components/auth-form.tsx) uses the built-in `signIn` and
  `signUp` client functions.
- [`src/app/dashboard/middleware.ts`](./src/app/dashboard/middleware.ts) redirects anonymous
  requests before the dashboard route runs.
- [`src/app/dashboard/page.tsx`](./src/app/dashboard/page.tsx) uses the built-in `useAuth` React
  hook to render the current account and session.

FARMJS owns the auth action routes, so the starter does not need an app-local Better Auth instance,
client factory, database pool, or catch-all API route:

```text
/api/auth/*
```

## Production environment

Local development uses safe defaults. Production requires these deployment environment variables:

| Variable           | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `FARM_AUTH_URL`    | Public application origin; inferred automatically on Vercel |
| `FARM_AUTH_SECRET` | Random secret used to sign and encrypt auth data            |
| `DATABASE_URL`     | Postgres connection string                                  |

Generate a production secret with:

```bash
openssl rand -base64 32
```

Loading `farm.config.ts` and running `farm build` do not connect to the database. Apply the
production auth schema before serving traffic:

```bash
pnpm auth:migrate
```

The FARMJS deployment target is configured in [`farm.config.ts`](./farm.config.ts) for Vercel.

## Advanced authentication

`auth: true` intentionally owns the common email/password path. If an application needs Better Auth
plugins, adapters, social providers, or callbacks, replace the top-level auth option with an
app-owned `integrations.auth` configuration using `@farm.js/better-auth`.

## Commands

```bash
pnpm dev          # start the development server
pnpm type-check   # run TypeScript checks
pnpm build        # create the production build without connecting to the database
pnpm check        # type-check and build
pnpm auth:migrate # apply the production auth schema
pnpm run deploy -- --prod
```

## License

MIT
