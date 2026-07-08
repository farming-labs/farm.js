---
title: "Migrations"
description: "Move existing apps to Farm with deterministic code-first migrations, then run one-shot schema or provider commands."
section: "Reference"
---

# Migrations

Move existing apps to Farm with deterministic code-first migrations, then run one-shot schema or provider commands.

## Framework migrations

Framework migrations are code-first codemods. They inspect the current project, prepare a file operation plan, and only write when you opt in with `--write`.

```bash
farm migrate inspect
farm migrate next
farm migrate next --diff
farm migrate next --write
farm migrate tanstack --write
```

`farm migrate next` and `farm migrate tanstack` are dry-run by default. They print detected framework evidence, planned file writes, warnings, and the manual review list. Add `--diff` when you want to inspect the exact generated file contents before applying the plan. Use `--force` only when you intentionally want generated files to overwrite existing Farm files.

## Dry-run diffs

Use `--diff` to preview the concrete edits Farm would make while still leaving the app untouched.

```bash
farm migrate next --diff
farm migrate tanstack --diff
```

The diff includes generated app files, `farm.config.ts`, root layout scaffolding, and `package.json` script/dependency updates. Skipped files are not diffed because Farm will not write them unless you pass `--force`.

## Next.js migration

The Next.js migrator focuses on the App Router path because Farm uses the same route-file shape for pages, layouts, loading states, errors, not-found pages, and API route handlers.

| Source | Farm output |
| --- | --- |
| app/page.tsx | src/app/page.tsx |
| app/about/page.tsx | src/app/about/page.tsx |
| app/api/hello/route.ts | src/app/api/hello/route.ts |
| middleware.ts | src/app/middleware.ts |
| package scripts | farm dev, farm build, node .output/server/index.mjs |

The migrator also creates `farm.config.ts`, creates a minimal root layout when one is missing, adds `@farmjs/core` and `@farmjs/cli`, and rewrites supported Next imports to Farm compatibility entries.

```tsx
import { Link } from "@farmjs/core/client";
import { redirect } from "@farmjs/core/navigation";
import { cookies } from "@farmjs/core/headers";

export default function Page() {
  if (!cookies().has("session")) redirect("/sign-in");
  return <Link href="/docs">Docs</Link>;
}
```

Supported rewrites include:

| Next import | Farm import |
| --- | --- |
| next/link | @farmjs/core/client |
| next/navigation | @farmjs/core/navigation |
| next/headers | @farmjs/core/headers |

Some Next.js APIs still need review because they are framework-specific. The migration report calls out `next/image`, `next/font`, `next/server`, Pages Router data functions, and `next.config.*` so the app owner can decide the right Farm equivalent.

## Next compatibility layer

Farm keeps the compatibility layer intentionally small. It covers common App Router APIs that map cleanly onto Farm's runtime:

| API | Runtime |
| --- | --- |
| `redirect()` | Throws a redirect signal that Farm turns into a redirect response. |
| `permanentRedirect()` | Same redirect signal with status 308. |
| `notFound()` | Throws a not-found signal that Farm turns into a 404. |
| `useRouter()` | Client hook backed by Farm's lightweight router. |
| `usePathname()` | Client hook for the current pathname. |
| `useSearchParams()` | Client hook for current URL search params. |
| `headers()` | Server helper that reads the current request headers. |
| `cookies()` | Server helper that reads current request cookies. |

This is not a full Next.js clone. APIs such as image optimization, fonts, server actions, route segment config edge cases, and platform-specific middleware behavior stay explicit migration review items until Farm has native equivalents.

## TanStack Router migration

The TanStack Router migrator targets file-based routes in `src/routes` or `routes`.

| Source | Farm output |
| --- | --- |
| src/routes/index.tsx | src/app/page.tsx |
| src/routes/about.tsx | src/app/about/page.tsx |
| src/routes/posts.$postId.tsx | src/app/posts/[postId]/page.tsx |
| src/routes/docs.$.tsx | src/app/docs/[...splat]/page.tsx |

For simple route files that use `component: ComponentName`, the migrator appends a default export so Farm can render the page module.

```tsx
export const Route = createFileRoute("/posts/$postId")({
  component: PostPage,
});

function PostPage() {
  return <h1>Post</h1>;
}

export default PostPage;
```

The migration report flags loaders, `beforeLoad`, search params, and `Route.use*` calls. Move that logic into Farm page props, server helpers, API routes, middleware, or integrations depending on what the route needs.

## Command migrations

`farm migrate` without a framework source still runs one-shot commands from `migrations.commands` in `farm.config.ts`.

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  migrations: {
    commands: [
      {
        name: "database",
        command: "pnpm prisma migrate deploy",
      },
      {
        name: "integration schema",
        command: "farm generate --orm postgres --output ./schema/farm.sql",
      },
    ],
  },
});
```

Use command migrations for app-owned database migrations, integration schema setup, provider bootstrap commands, and CI steps that should run before `farm build`.

## Safety model

- Framework migrations never delete source files.
- Framework migrations default to dry-run and require `--write`.
- `--diff` prints generated file content during dry-runs without writing to disk.
- Existing target files are skipped unless `--force` is passed.
- Package dependencies for the previous framework are left in place until the app owner removes them.
- The report is part of the feature: unsupported APIs are called out instead of guessed.
