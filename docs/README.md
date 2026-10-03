# Farm.js Docs (farmjs-docs)

Official documentation site for Farm.js, built with Farm.js.

## Run locally

From the repo root:

```bash
pnpm install
pnpm run --filter farmjs-docs dev
```

Or from this directory (after `pnpm install` from root):

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Agent waitlist database

The `/agents` form posts to `/api/waitlist`. `WaitlistEntry` in `prisma/schema.prisma`
stores the normalized email (unique), signup description, and creation/update timestamps.
Repeat submissions update that record instead of creating duplicates.

Set a server-only `WAITLIST_DATABASE_URL` in `docs/.env.local` for a dedicated Postgres
database. Never prefix it with `VITE_` or commit the credential. When omitted, the route
continues to use `DATABASE_URL`; telemetry always keeps using `DATABASE_URL`.

From `docs`, prepare a new dedicated database once:

```bash
pnpm db:waitlist
```

This requires `WAITLIST_DATABASE_URL` explicitly and only creates the `WaitlistEntry`
table when it is absent. It never resets a database or modifies telemetry tables. Keep
`prisma/waitlist.sql` aligned with the Prisma model for future schema changes; the bootstrap
does not upgrade an existing table.

For production, set `WAITLIST_DATABASE_URL` on the Vercel project serving `farmjs.dev`,
scoped to **Production**, then deploy the updated app. Do not replace the existing telemetry
`DATABASE_URL` or give PR previews access to the production waitlist. Apply the bootstrap
against that same database before the deployment accepts signups; schema changes are not
run automatically during builds.

Farm development loads `.env.local`. To run a locally built Node output from the repo root:

```bash
node --env-file=docs/.env.local docs/.farm/.output/server/index.mjs
```

## Build

From the repo root:

```bash
pnpm run --filter farmjs-docs build
```

The production Vercel artifact is written to `.vercel/output`.

### Runtime-only core build

The documentation-site build opts into `@farm.js/core`'s runtime-only package build:

```bash
pnpm --filter @farm.js/core build:runtime
```

This builds the same ESM, CJS, and source-map artifacts as the default core build, but skips
TypeScript declaration generation because the deployed website does not consume `.d.ts` files.
The optimization applies to the complete `farmjs.dev` application, including the landing page and
documentation routes.

The regular package and release build remains the default and continues to generate declarations:

```bash
pnpm --filter @farm.js/core build
```

Use `build:runtime` only for application deployments that need executable runtime artifacts. Do not
use it for package publishing, release validation, or any workflow that consumes generated types.

## Structure

- **Landing** (`/`) – Hero, features, and CTAs
- **Docs** (`/docs`) – Documentation index
- **Getting Started** (`/docs/getting-started`) – Installation and first steps
- **Routing** (`/docs/routing`) – File-based routing
- **Layouts** (`/docs/layouts`) – Root and nested layouts
