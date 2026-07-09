---
title: "CLI"
description: "Use the Farm CLI to run, build, generate types, migrate apps, deploy output, and add integrations."
section: "Reference"
---

# CLI

Use the Farm CLI to run, build, generate types, migrate apps, deploy output, and add integrations.

## Common commands

| Command | Purpose |
| --- | --- |
| farm dev | Start the dev server. |
| farm build | Build the app for the configured target. |
| farm preview | Create a public URL for a running local app. |
| farm generate | Generate route/API types and integration schema artifacts. |
| farm migrate inspect | Detect supported framework migration sources. |
| farm migrate next --write | Apply a deterministic Next.js App Router migration. |
| farm migrate tanstack --write | Apply a deterministic TanStack Router file-route migration. |
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

`farm dev` refreshes generated route/API types automatically when page and API route files change. Use `farm generate` when you want to refresh the same files outside the dev server, such as in CI, before publishing a package, or after moving files while the dev server was stopped.

When integration storage schemas are configured, `farm generate` also writes schema artifacts if Farm can detect the data layer. Pass `--orm` and `--output` when you want explicit schema output for a migration step.

## Framework migrations

```bash
farm migrate inspect
farm migrate next
farm migrate next --write
farm migrate tanstack --write
```

Framework migrations are deterministic codemods. They inspect the project, print a dry-run plan by default, and only write when `--write` is passed. Existing target files are skipped unless `--force` is passed.

The Next.js migrator copies `app` or `src/app` into Farm's `src/app`, creates `farm.config.ts`, creates a minimal root layout when needed, rewrites supported imports from `next/link`, `next/navigation`, and `next/headers`, and updates package scripts to `farm dev`, `farm build`, and `node .output/server/index.mjs`.

The TanStack migrator converts file routes from `src/routes` or `routes` into `src/app/**/page.tsx`, maps `$id` to `[id]`, maps `$` to `[...splat]`, and adds a default export for simple `component: ComponentName` route files.

Both migrators leave source files in place and print manual review notes for framework-specific APIs.

## Run command migrations

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

## Instant preview

```bash
farm preview
farm preview --port 3000
farm preview --name stripe-webhook
farm preview --url http://localhost:4319
farm preview --dry-run
```

`farm preview` exposes the app that is already running locally. It does not build or deploy the app. Use it when a teammate, webhook provider, OAuth provider, mobile device, or browser automation tool needs a public URL for the current `farm dev` session.

Farm detects the running app on common local ports, or you can pass `--port` / `--url` when the app is running somewhere specific. By default it connects to the hosted Farm Preview gateway and returns a URL such as `https://stripe-webhook.preview.farming-labs.dev`.

The preview terminal logs forwarded traffic:

```txt
GET /api/hello?name=something -> 200 621ms
POST /api/auth/login -> 200 580ms
```

The local `farm dev` terminal logs the matched page, API route, and middleware work. Client components hydrate through the same public URL; early button clicks are queued and replayed after hydration so slow dev-mode module loading does not lose the click.

See [Instant Preview](/docs/preview) for webhook setup, custom gateway configuration, troubleshooting, and security notes.

## Build

```bash
farm build
```

`farm build` respects `deploy.target`, `output`, and provider-specific output options from `farm.config.ts`.

## Production notes

- Run `farm generate` in CI if generated route/API types are not committed.
- Run `farm migrate` before `farm build` when schema changes are deployed separately from app code.
- Use `farm build` before deployment to catch docs, API, route, and integration wiring issues.
- Prefer `farm add integration <name> --ui` only when you want generated UI files.
- Review generated integration files before committing them.
