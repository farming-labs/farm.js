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
