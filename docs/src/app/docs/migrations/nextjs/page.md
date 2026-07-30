---
title: "Migrate from Next.js"
description: "Move a Next.js App Router project to Farm with the built-in dry-run-first migrator."
section: "Migrations"
---

# Migrate from Next.js

Farm's Next.js migrator focuses on App Router projects. Farm uses the same route-file shape for
pages, layouts, loading states, errors, not-found pages, and API route handlers, so those files can
move without redesigning the route tree.

## Inspect the project

Run the inspection from the Next.js project root:

```bash
farm migrate inspect
```

Next.js detection uses the `next` dependency, `app` or `src/app`, `next.config.*`, and the legacy
`pages` directory as evidence. Inspection does not change the project.

## Preview the migration

Prepare a dry-run plan:

```bash
farm migrate next
```

The plan lists every file it would write, changes to `package.json`, skipped targets, and APIs that
need manual review. Apply it only after reviewing that output:

```bash
farm migrate next --write
```

Use `--force` only when you intentionally want generated files to overwrite existing Farm targets.

## What moves automatically

The migrator copies `app` or `src/app` into Farm's `src/app` and moves root middleware into the app
directory.

| Next.js source           | Farm output                                               |
| ------------------------ | --------------------------------------------------------- |
| `app/page.tsx`           | `src/app/page.tsx`                                        |
| `app/about/page.tsx`     | `src/app/about/page.tsx`                                  |
| `app/api/hello/route.ts` | `src/app/api/hello/route.ts`                              |
| `middleware.ts`          | `src/app/middleware.ts`                                   |
| package scripts          | `farm dev`, `farm build`, `node .output/server/index.mjs` |

It also:

- creates `farm.config.ts` when one does not exist
- creates a minimal root layout when one is missing
- adds `@farm.js/core` and `@farm.js/cli`
- rewrites supported imports to Farm compatibility entries

## Supported import rewrites

| Next.js import    | Farm import                |
| ----------------- | -------------------------- |
| `next/link`       | `@farm.js/core/client`     |
| `next/navigation` | `@farm.js/core/navigation` |
| `next/headers`    | `@farm.js/core/headers`    |

For example:

```tsx
import { Link } from "@farm.js/core/client";
import { cookies } from "@farm.js/core/headers";
import { redirect } from "@farm.js/core/navigation";

export default function Page() {
  if (!cookies().has("session")) redirect("/sign-in");
  return <Link href="/docs">Docs</Link>;
}
```

## Compatibility APIs

Farm provides a deliberately small compatibility surface for common App Router behavior:

| API                   | Farm behavior                                                |
| --------------------- | ------------------------------------------------------------ |
| `redirect()`          | Produces a redirect response through Farm's redirect signal. |
| `permanentRedirect()` | Produces the same signal with status 308.                    |
| `notFound()`          | Produces a not-found signal that Farm renders as a 404.      |
| `useRouter()`         | Uses Farm's client router.                                   |
| `usePathname()`       | Reads the current pathname on the client.                    |
| `useSearchParams()`   | Reads the current URL search parameters on the client.       |
| `headers()`           | Reads the current request headers on the server.             |
| `cookies()`           | Reads the current request cookies on the server.             |

## Manual review

The migration report calls out code that Farm cannot convert safely:

- `next/image`, `next/font`, `next/server`, and other remaining `next/*` imports
- `getServerSideProps`, `getStaticProps`, and `getInitialProps`
- Pages Router files under `pages`
- `next.config.*` settings
- middleware that uses `next/server`
- non-code assets that need to be copied or reviewed

Move equivalent configuration into `farm.config.ts` or Vite config. Convert Pages Router data
functions into Farm page props, server queries, API routes, middleware, or integrations according
to where the work belongs.

## Finish the migration

```bash
pnpm install
pnpm dev
pnpm build
```

Verify every route and API handler, then remove unused Next.js dependencies and configuration only
after the Farm app is working. The migrator leaves the original source files in place so you can
compare behavior during the transition.
