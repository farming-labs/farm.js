# FARMJS Better Auth Starter

A standalone authentication starter built with FARMJS, Better Auth, your selected UI renderer,
and Neon Postgres.

This project was generated from the Better Auth template included with `@farm.js/create-app`.

## Included

- email and password sign-up and sign-in
- Better Auth session cookies
- a server-middleware-protected `/dashboard`
- pooled Postgres persistence and automatic Better Auth migrations
- a dark-first, one-page welcome screen set in Geist Sans and Geist Mono
- pending, error, unauthorized, loading, and not-found states
- responsive starter UI
- exact FARMJS beta dependencies for reproducible installs

## Quick start

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-app --template better-auth --renderer solid --typescript
cd my-app
cp .env.example .env.local
```

Generate a secret and place it in `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Then install and start the app:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and continue to the protected dashboard.

## How it is wired

- [`src/lib/auth.ts`](./src/lib/auth.ts) creates the Better Auth instance, configures the pooled
  Postgres connection, and runs programmatic migrations.
- [`farm.config.ts`](./farm.config.ts) mounts that instance through `@farm.js/better-auth`.
- [`src/lib/auth-client.ts`](./src/lib/auth-client.ts) exposes the browser client.
- [`src/lib/session.ts`](./src/lib/session.ts) resolves the current request session on the server.
- [`src/app/dashboard/middleware.ts`](./src/app/dashboard/middleware.ts) redirects unauthenticated requests before the dashboard route runs.
- `src/app/dashboard/page.*` reads the already-authorized session and renders the account UI in the
  selected renderer.

FARMJS owns the catch-all integration route, so the starter does not need a manual API route:

```text
/api/auth/[...auth]
```

## Environment

| Variable             | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `BETTER_AUTH_URL`    | Public origin used by Better Auth         |
| `BETTER_AUTH_SECRET` | Secret used to sign and encrypt auth data |
| `DATABASE_URL`       | Pooled Postgres connection string         |

Never commit `.env.local` or expose the database connection string.

## Deployment note

The starter uses `pg` with a small connection pool suitable for a pooled Neon endpoint. Add
`DATABASE_URL`, `BETTER_AUTH_SECRET`, and the production `BETTER_AUTH_URL` to your deployment
environment before building.

The FARMJS deployment target is configured in [`farm.config.ts`](./farm.config.ts) for Vercel.

## Commands

```bash
pnpm dev         # start the development server
pnpm type-check  # run TypeScript checks
pnpm build       # create the production build
pnpm check       # type-check and build
pnpm run deploy -- --prod  # deploy the prebuilt Farm output to Vercel
```

## License

MIT
