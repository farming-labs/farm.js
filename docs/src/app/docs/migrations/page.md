---
title: "Migrations"
description: "Move apps from the frameworks featured on the homepage with source-specific automated and manual guides."
section: "Migrations"
---

# Migrations

Move an existing app to Farm with a source-specific guide. This section covers every framework in
the homepage comparison: Next.js, SvelteKit, Nuxt, and TanStack Start.

## Choose a source

Two sources have dry-run-first CLI migrators. Nuxt and SvelteKit still require a manual migration.
Nuxt applications can retain Vue SFCs through `@farm.js/vue`, and SvelteKit applications can retain
Svelte components through `@farm.js/svelte` while their framework-specific modules are adapted.

| Source                                      | Migration type | Coverage                                                                                |
| ------------------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| [Next.js](/docs/migrations/nextjs)          | Automated      | App Router files, common imports, middleware location, scripts, and Farm setup.         |
| [SvelteKit](/docs/migrations/sveltekit)     | Manual         | Route structure, layouts, load functions, endpoints, hooks, environment, and adapters.  |
| [Nuxt](/docs/migrations/nuxt)               | Manual         | Pages, layouts, server routes, data composables, middleware, runtime config, and Nitro. |
| [TanStack Start](/docs/migrations/tanstack) | Automated      | File-based Router routes, route paths, default page exports, scripts, and Farm setup.   |

Each source has its own guide because the automatic changes and manual review items are
framework-specific.

## Automated workflow

For Next.js and TanStack Start, run inspection from the source project's root:

```bash
farm migrate inspect
```

Inspection reports each supported source it detects, its confidence, and the evidence it found.
Choose the matching source and run it without `--write` to review the plan:

```bash
farm migrate next
# or
farm migrate tanstack
```

The dry run prints planned file operations, skipped targets, warnings, and manual review items.
Apply the reviewed plan, install the updated dependencies, and verify the migrated app:

```bash
farm migrate next --write
pnpm install
pnpm dev
pnpm build
```

Replace `next` with `tanstack` when migrating a TanStack app.

## Manual workflow

For Nuxt and SvelteKit, use the source guide as a checklist:

1. Create a minimal Farm shell next to the existing source.
2. Reproduce the route tree with Farm page, layout, and API route files.
3. Move one vertical feature at a time, including its data access and mutations.
4. Select a FARMJS renderer and adapt framework-specific components and client APIs deliberately.
5. Verify routing, server rendering, forms, APIs, middleware, environment variables, and deployment.
6. Remove the previous framework only after the Farm build behaves the same in production.

The manual guides preserve URLs and server contracts where possible, but UI state and
framework-specific modules require application-level decisions.

## Command migrations

`farm migrate` without a framework source has a separate purpose: it runs one-shot commands from
`migrations.commands` in `farm.config.ts`.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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

Use command migrations for app-owned database migrations, integration schema setup, provider
bootstrap commands, and CI steps that should run before `farm build`. See
[Configuration](/docs/configuration#one-shot-migrations) for the complete configuration shape.

## Safety model

- Automated migrations never delete source files.
- Automated migrations default to dry-run and require `--write`.
- Automated migrations skip existing target files unless `--force` is passed.
- Automated migrations leave previous framework dependencies in place until the app owner removes them.
- Unsupported APIs are reported as manual review items instead of being guessed.
- Manual migrations should keep the old application runnable until the Farm replacement is verified.
- Run the migration on a clean branch so its changes are easy to inspect or revert.
