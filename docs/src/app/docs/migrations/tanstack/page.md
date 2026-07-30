---
title: "Migrate from TanStack Start"
description: "Move TanStack Start or TanStack Router file routes to Farm with the built-in migrator."
section: "Migrations"
---

# Migrate from TanStack Start

Farm's TanStack migrator converts file-based routes from TanStack Start or TanStack Router into
Farm's `src/app` route tree. It automates route paths and simple component exports while reporting
loader and router-runtime behavior for manual review.

## Inspect the project

Run the inspection from the TanStack project root:

```bash
farm migrate inspect
```

TanStack detection uses the `@tanstack/react-router` dependency, `src/routes` or `routes`, and a
generated route tree as evidence. Inspection does not change the project.

## Preview the migration

Prepare a dry-run plan:

```bash
farm migrate tanstack
```

The plan lists route conversions, package script changes, skipped targets, and manual review items.
Apply it only after reviewing that output:

```bash
farm migrate tanstack --write
```

Use `--force` only when you intentionally want generated files to overwrite existing Farm targets.

## Route mapping

The migrator reads file routes from `src/routes` or `routes`.

| TanStack source                | Farm output                        |
| ------------------------------ | ---------------------------------- |
| `src/routes/index.tsx`         | `src/app/page.tsx`                 |
| `src/routes/about.tsx`         | `src/app/about/page.tsx`           |
| `src/routes/posts.$postId.tsx` | `src/app/posts/[postId]/page.tsx`  |
| `src/routes/docs.$.tsx`        | `src/app/docs/[...splat]/page.tsx` |

Pathless layout segments beginning with `_` are omitted from the URL path. Root route and generated
route-tree files are not copied automatically.

## Page component exports

Farm renders a page module's default export. When a simple route uses
`component: ComponentName`, the migrator appends the matching default export:

```tsx
export const Route = createFileRoute("/posts/$postId")({
  component: PostPage,
});

function PostPage() {
  return <h1>Post</h1>;
}

export default PostPage;
```

If the migrator cannot find a component identifier, it leaves the file intact and adds a manual
review item.

## Project setup

The migrator also:

- creates `farm.config.ts` when one does not exist
- creates a minimal root layout when one is missing
- changes compatible Vite or Vinxi scripts to `farm dev` and `farm build`
- adds `@farm.js/core` and `@farm.js/cli`

## Manual review

Review every reported use of:

- route `loader` and `beforeLoad`
- loader data and search parameters
- `Route.use*` hooks
- root route and route-tree setup
- TanStack Start server functions or framework-specific APIs

Move that behavior into Farm page props, server queries, API routes, middleware, or integrations
depending on its responsibility. Keep validation on the server when route input crosses a trust
boundary.

## Finish the migration

```bash
pnpm install
pnpm dev
pnpm build
```

Verify static, dynamic, and catch-all routes, then remove unused TanStack dependencies and generated
route-tree files only after the Farm app is working. The migrator leaves the original route files in
place so you can compare behavior during the transition.
