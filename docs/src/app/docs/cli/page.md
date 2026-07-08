---
title: "CLI"
description: "Use the Farm CLI to run, build, generate types, deploy output, and add integrations."
section: "Reference"
---

# CLI

Use the Farm CLI to run, build, generate types, deploy output, and add integrations.

## Common commands

| Command | Purpose |
| --- | --- |
| farm dev | Start the dev server. |
| farm build | Build the app for the configured target. |
| farm preview | Preview the production output. |
| farm generate | Generate API and route types. |
| farm migrate | Run one-shot schema or provider migration commands. |
| farm add integration stripe --ui | Add integration wiring and optional UI. |

## Provider names

The integration generator supports ai, stripe, supabase, workos, auth0, clerk, better-auth, authjs, autumn, polar, resend, jobs-trigger, jobs-inngest, and unkey.

## Add integrations

```bash
farm add integration stripe
farm add integration stripe --ui
farm add integration better-auth --ui
farm add integration jobs-trigger
```

Without `--ui`, the CLI installs integration wiring. With `--ui`, it also installs app-owned shadcn-style components for the selected provider.

## Generate types

```bash
farm generate
```

Use this after adding or changing API routes so `api.hello.post(...)`, route params, and `Link` types stay current.

## Run migrations

```bash
farm migrate
farm migrate --dry-run
farm migrate --command "pnpm prisma migrate deploy"
```

`farm migrate` runs one-shot commands from `migrations.commands` in `farm.config.ts`. Use it for app-owned database migrations, integration tables, provider setup commands, and CI steps that should happen before `farm build`.

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  migrations: {
    commands: [
      {
        name: "prisma",
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

Commands run sequentially and stop on the first failure. `--dry-run` prints the commands without executing them.

## Build and preview

```bash
farm build
farm preview
```

`farm build` respects `deploy.target`, `output`, and provider-specific output options from `farm.config.ts`.

## Production notes

- Run `farm generate` in CI if generated route/API types are not committed.
- Run `farm migrate` before `farm build` when schema changes are deployed separately from app code.
- Use `farm build` before deployment to catch docs, API, route, and integration wiring issues.
- Prefer `farm add integration <name> --ui` only when you want generated UI files.
- Review generated integration files before committing them.
