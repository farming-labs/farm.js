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

Output is in `.farm/.output` (Vercel preset).

## Structure

- **Landing** (`/`) – Hero, features, and CTAs
- **Docs** (`/docs`) – Documentation index
- **Getting Started** (`/docs/getting-started`) – Installation and first steps
- **Routing** (`/docs/routing`) – File-based routing
- **Layouts** (`/docs/layouts`) – Root and nested layouts
