---
title: "DevTools and Doctor"
description: "Inspect Farm's resolved routes, APIs, integrations, storage, schedules, deployment settings, and diagnostics in the browser or terminal."
section: "Runtime"
---

# DevTools and Doctor

Farm exposes one operational view of the application in development. The browser dashboard is useful while working on the app, while `farm doctor` brings the same runtime diagnostics to the terminal and CI.

## Open DevTools

Start the application:

```bash
farm dev
```

Press `Ctrl + Shift + .` on Windows or Linux, or `Command + Shift + .` on macOS. Farm opens DevTools over the current page, so the application stays visible behind the inspector. Press the shortcut again, press `Escape`, click outside the window, or use the close button to return to the app.

You can also use the DevTools launcher URL:

```txt
http://localhost:3000/__farm/devtools
```

If the app uses another port, keep the same path on that origin. The launcher returns to the application and opens the same modal instead of replacing the page. The inspector is mounted by the development server; it is not added to production output.

## Configure DevTools

DevTools is enabled by default during `farm dev`. Disable the client launcher and both internal runtime routes in `farm.config.ts`:

```ts title="farm.config.ts"
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  devtools: {
    enabled: false,
  },
});
```

To keep the dashboard available while turning off only the keyboard shortcut, use `shortcut: false`. You can also assign another shortcut with modifier names joined by `+`:

```ts title="farm.config.ts"
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  devtools: {
    shortcut: "mod+shift+d",
  },
});
```

`mod` maps to `Command` on macOS and `Ctrl` on Windows and Linux. Farm also accepts `ctrl`, `meta`, `alt`, and `shift` explicitly. DevTools remains development-only even when `enabled: true` is present in production configuration.

## What the dashboard shows

| View | What Farm reports |
| --- | --- |
| Overview | Route, API, middleware, integration, schedule, and diagnostic totals. |
| Routes | Pages, layouts, loading boundaries, error boundaries, source files, and effective runtime controls. |
| API | Registered methods, paths, source modules, runtime, regions, and maximum duration. |
| Systems | Integration routes and middleware, React providers, schema models, request middleware, and storage mounts. |
| Runtime | Deployment target, Nitro preset, output directory, cron routes, workflows, layers, feature flags, and environment key names. |

Use the view navigation to move between surfaces. Routes and API endpoints can be filtered by path, method, or source file. Press `/` while one of those views is active to focus its filter. The **Raw** view contains the complete machine-readable snapshot.

## Runtime JSON

The same data is available at:

```txt
http://localhost:3000/__farm/devtools.json
```

For example:

```bash
curl http://localhost:3000/__farm/devtools.json
```

The response contains these top-level fields:

```json
{
  "health": "attention",
  "project": {},
  "deployment": {},
  "counts": {},
  "routes": [],
  "apiRoutes": [],
  "middleware": [],
  "integrations": [],
  "storage": [],
  "cron": [],
  "workflows": [],
  "layers": [],
  "environment": {},
  "features": {},
  "diagnostics": []
}
```

Environment values are never included. Farm reports only the validated server and public key names so you can confirm the environment contract without exposing secrets.

## Run Doctor

Run this from the application root:

```bash
farm doctor
```

The command probes `http://localhost:3000/__farm/devtools.json`. When the app is running, the live snapshot is the source of truth:

```txt
FARM / DOCTOR
storefront / LIVE RUNTIME

PASS  Connected to the Farm runtime
      8 pages, 4 API routes, and 2 middleware layers are registered.
WARN  Production storage is in memory
      vercel instances do not preserve in-memory data across executions.

SUMMARY  2 passed / 1 warning / 0 failed / 1 info
DEVTOOLS http://localhost:3000/__farm/devtools
```

When the dev server is not running, or when DevTools is disabled, Doctor automatically falls back to project inspection. It loads `farm.config.*`, validates the package manifest, checks the app router and root layout, resolves the deployment target, and inspects storage and cron configuration.

## Target another server

Use a port:

```bash
farm doctor --port 4319
```

Or pass the complete origin:

```bash
farm doctor --url http://localhost:4319
```

When an explicitly requested server cannot be reached, Doctor reports `LIVE_RUNTIME_UNREACHABLE` and continues with project checks. This keeps the command useful while making the failed probe visible.

## Offline checks

Skip the live probe when the command must use only repository state:

```bash
farm doctor --offline
```

Offline mode checks:

- Node.js satisfies Farm's supported baseline.
- `package.json` exists and declares `@farmjs/core`.
- Farm config loads and resolves for development.
- The app directory or programmatic router contains page routes.
- A root layout is available from the app or an extended layer.
- Deployment target, preset, and output directory resolve.
- Integrations and storage mounts are visible in config.
- Configured cron routes have matching app-directory API route files.
- Serverless targets do not depend on explicitly configured in-memory root storage.

Live mode is more complete because it sees generated and programmatic API routes, inherited runtime settings, loaded middleware, and discovered workflows after Farm initializes the app.

## JSON and CI

Print a structured report:

```bash
farm doctor --offline --json
```

A report includes `source`, `health`, project and target metadata, status totals, and the individual checks. Live reports also include runtime counts and a DevTools URL.

Doctor uses these health rules:

| Result | Exit behavior |
| --- | --- |
| `ready` | No failed or warning checks; exits 0. |
| `attention` | At least one warning; exits 0. |
| `error` | At least one failed check; exits non-zero. |

This makes a basic CI check straightforward:

```bash
farm doctor --offline
farm build
```

Use `farm doctor --offline --json` when CI should store or process the report. Keep `farm build` as the final production compatibility check because it validates bundling and adapter output, not only project structure.

## Diagnostics

Common diagnostic codes include:

| Code | Meaning |
| --- | --- |
| `NO_PAGE_ROUTES` | Farm found no page modules or programmatic page router. |
| `ROOT_LAYOUT_MISSING` | The app has no shared root layout. |
| `CRON_ROUTE_MISSING` | A configured schedule targets an API route Farm cannot find. |
| `CRON_SECRET_NOT_SET` | Scheduled production requests do not yet have `CRON_SECRET`. |
| `EPHEMERAL_PRODUCTION_STORAGE` | A serverless deployment uses in-memory root storage. |
| `ROUTE_RUNTIME_UNRESOLVED` | Farm could not resolve a page's inherited runtime controls. |
| `LIVE_RUNTIME_UNREACHABLE` | An explicitly selected running app did not answer the probe. |

Warnings identify behavior that can be valid locally but needs attention before production. Failures mean the project cannot satisfy a basic framework contract.

## Security boundary

DevTools is development-only, but the snapshot still contains project paths, route structure, integration names, and environment key names. Do not expose the development server or the `__farm/devtools` routes to an untrusted network.

The snapshot never serializes environment values, provider credentials, storage connection details, request data, cookies, or application records. `farm doctor --json` follows the same rule.
