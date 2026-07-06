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

## Build and preview

```bash
farm build
farm preview
```

`farm build` respects `deploy.target`, `output`, and provider-specific output options from `farm.config.ts`.

## Production notes

- Run `farm generate` in CI if generated route/API types are not committed.
- Use `farm build` before deployment to catch docs, API, route, and integration wiring issues.
- Prefer `farm add integration <name> --ui` only when you want generated UI files.
- Review generated integration files before committing them.
