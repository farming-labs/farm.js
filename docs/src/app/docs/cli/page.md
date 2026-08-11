---
title: "CLI"
description: "Use the Farm CLI to run, build, generate types, migrate apps, deploy output, and add integrations."
section: "Reference"
---

# CLI

Use the Farm CLI to run, build, generate types, migrate apps, deploy output, and add integrations.

## Create an app

```bash
pnpm create @farm.js/app@beta my-app --template basic --typescript
pnpm create @farm.js/app@beta my-solid-app --template basic --renderer solid --typescript
pnpm create @farm.js/app@beta my-vue-app --template basic --renderer vue --typescript
pnpm create @farm.js/app@beta stripe-app --template stripe --typescript
pnpm create @farm.js/app@beta --list-templates
```

The create-app CLI includes Basic, Farm.js Auth, Better Auth, and one ready-to-configure starter
for every provider supported by `farm add integration --ui`. See [Getting Started](/docs/getting-started#choose-a-starter)
for the complete template catalog.

React is the default renderer. `--renderer solid` and `--renderer vue` are available with the Basic
starter; integration starters currently target React. See [Renderers](/docs/renderers) for setup and
feature compatibility.

## Common commands

| Command                          | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| farm dev                         | Start the dev server.                                                |
| farm build                       | Build the app for the configured target.                             |
| farm upgrade --latest            | Upgrade installed Farm packages to the latest stable release.        |
| farm upgrade --beta              | Upgrade installed Farm packages to the latest beta release.          |
| farm doctor                      | Inspect a running app, or fall back to project configuration checks. |
| farm doctor --offline            | Check project files and config without probing a dev server.         |
| farm doctor --fix                | Apply safe, additive project corrections.                            |
| farm explain /products/42        | Explain the files and runtime behavior for one URL.                  |
| farm preview                     | Create a public URL for a running local app.                         |
| farm generate                    | Generate route/API types and integration schema artifacts.           |
| farm generate --check            | Fail when committed generated types are stale.                       |
| farm deploy --plan               | Resolve the deployment plan without executing it.                    |
| farm migrate inspect             | Detect supported framework migration sources.                        |
| farm migrate next --write        | Apply a deterministic Next.js App Router migration.                  |
| farm migrate tanstack --write    | Apply a deterministic TanStack Router file-route migration.          |
| farm migrate                     | Run one-shot schema or provider migration commands.                  |
| farm add integration stripe --ui | Add integration wiring and optional UI.                              |
| farm cron list                   | List configured UTC schedules and target routes.                     |
| farm cron run dailyCleanup       | Invoke one cron route on a running app.                              |
| farm dev --cron                  | Start the dev server with the opt-in in-memory cron scheduler.       |

## Upgrade Farm packages

```bash
farm upgrade --latest
farm upgrade --beta
farm upgrade --latest --dry-run
```

`--latest` selects the newest stable release published under npm's `latest` tag. `--beta` selects
the newest prerelease published under the `beta` tag. Exactly one release channel is required.

Farm reads the app's dependencies and upgrades every published `@farm.js/*` package together. It
detects npm, pnpm, Yarn, or Bun from `packageManager` and lockfiles, preserves whether each package
is a regular, development, optional, or peer dependency, and skips local `workspace:`, `file:`,
`link:`, `portal:`, and `catalog:` references. Use `--dry-run` to inspect the commands without
changing the project.

## Provider names

The integration generator supports ai, stripe, supabase, workos, auth0, clerk, better-auth, authjs, autumn, polar, resend, jobs-trigger, jobs-inngest, and unkey.

## Add integrations

```bash
farm add integration stripe
farm add integration stripe --ui
farm add integration better-auth --ui
farm add integration jobs-trigger
```

Without `--ui`, the CLI installs the selected first-party provider package and its integration
wiring. With `--ui`, it also installs app-owned shadcn-style components for that provider. Farm
package versions follow the app's installed `@farm.js/core` version, including beta releases.

## Generate types

```bash
farm generate
farm generate --check
```

`farm dev` refreshes generated route/API types automatically when page and API route files change. Use `farm generate` when you want to refresh the same files outside the dev server, such as in CI, before publishing a package, or after moving files while the dev server was stopped.

When integration database schemas are configured, `farm generate` also writes schema artifacts if Farm can detect the data layer. Pass `--orm` and `--output` when you want explicit schema output for a migration step.

`farm generate --check` computes the route, API, environment, and i18n declarations without writing to disk. It exits non-zero and lists every missing, stale, or obsolete generated file. Use it after a normal generation step when generated types are committed:

```yaml
- run: farm generate --check
```

Schema output flags such as `--orm` and `--output` cannot be combined with `--check`; database schema generation can depend on migrations and remains an explicit write operation.

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
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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

Farm detects the running app on common local ports, or you can pass `--port` / `--url` when the app is running somewhere specific. By default `@farm.js/tunnel` tries to open one outbound WebSocket to the hosted Farm Preview relay and returns a URL such as `https://stripe-webhook.preview.farming-labs.dev`. During the relay rollout, the CLI falls back to compatibility gateway polling if the native connection is unavailable.

The preview terminal logs forwarded traffic:

```txt
GET /api/hello?name=something -> 200 621ms
POST /api/auth/login -> 200 580ms
```

The local `farm dev` terminal logs the matched page, API route, and middleware work. Client components hydrate through the same public URL; early button clicks are queued and replayed after hydration so slow dev-mode module loading does not lose the click.

See [Instant Preview](/docs/preview) for webhook setup, custom gateway configuration, troubleshooting, and security notes.

## Diagnose the app

```bash
farm doctor
farm doctor --port 4319
farm doctor --url http://localhost:4319
farm doctor --offline
farm doctor --fix
farm doctor --json
```

`farm doctor` first probes the running app at `http://localhost:3000`. A live app provides the most accurate result because Farm can report its resolved routes, API methods, middleware, integrations, storage mounts, schedules, workflows, layers, and deployment runtime. When no app is running, the command falls back to config and filesystem checks.

Pass `--port` or `--url` when the app runs somewhere else. An explicitly requested runtime that cannot be reached is reported as a warning before the project checks. Use `--offline` to skip the network probe entirely.

The command exits with a non-zero status only when a check fails. Warnings keep a zero exit status, so CI can distinguish broken configuration from production-readiness advice. `--json` prints the complete report without terminal formatting.

`farm doctor --fix` applies only corrections Farm can make without replacing application code. Today that means creating a missing `src/app/layout.tsx`; an existing file is never overwritten. The command reruns diagnostics after each correction and reports exactly which files it created.

See [DevTools and Doctor](/docs/devtools) for the browser dashboard, diagnostics, JSON contract, and CI examples.

## Explain a route

```bash
farm explain /products/42
farm explain /products/42 --json
```

`farm explain` resolves a URL against the app router without starting the app. It reports:

- the matching page file, route pattern, parameters, and source layer;
- inherited layouts and file- or config-based middleware;
- route-rule and module runtime controls, rendering mode, PPR, and cache settings;
- static or generated metadata and the nearest Open Graph and Twitter images;
- the deployment target, preset, runtime compatibility, and actionable warnings.

Use the text output while debugging and `--json` for tooling. The command is read-only and fails when no page route matches the supplied URL.

## Build

```bash
farm build
```

`farm build` respects `deploy.target`, `output`, and provider-specific output options from `farm.config.ts`.

## Plan a deployment

```bash
farm deploy --plan
farm deploy --vercel --prod --plan
```

`farm deploy --plan` resolves the target, Nitro preset, runtime, output directory, and exact build and provider commands. It does not build, inspect build output, check credentials, or call a deployment CLI. This makes it safe to use during review and in CI policy checks.

## Cron commands

```bash
farm cron list
farm cron list --json
farm cron run dailyCleanup
farm cron run dailyCleanup --url http://localhost:4319
farm dev --cron
```

`farm cron run` reads the named schedule from `farm.config.ts`, sends GET to its configured route, and forwards `CRON_SECRET` as bearer authorization. `farm dev --cron` runs the same routes on their UTC schedules in memory, prevents overlap inside the local process, and stops with the dev server.

See [Cron](/docs/cron) for configuration, production adapters, security, and reliability semantics.

## Production notes

- Run `farm generate` in CI if generated route/API types are not committed.
- Run `farm migrate` before `farm build` when schema changes are deployed separately from app code.
- Use `farm build` before deployment to catch docs, API, route, and integration wiring issues.
- Prefer `farm add integration <name> --ui` only when you want generated UI files.
- Review generated integration files before committing them.
