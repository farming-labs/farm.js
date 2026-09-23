---
title: "Built-in DevTools"
description: "Inspect Farm's resolved routes, APIs, integrations, KV storage, schedules, and deployment settings in the browser during development."
section: "Runtime"
---

# Built-in DevTools

Farm exposes one operational view of the application in development. The browser dashboard described here is the built-in one; [`farm doctor`](/docs/doctor) brings the same runtime diagnostics to the terminal and CI.

> **Deprecated: use the DevTools plugin**
>
> The built-in browser dashboard described below is deprecated. The official DevTools is now
> the [`@farm.js/devtools` plugin](/docs/plugins/devtools), which reuses the same runtime
> snapshot and adds a floating launcher, an expanded workspace UI, and syntax-highlighted
> browser module inspection. The built-in dashboard, its configuration, its launcher URL, and
> the shared keyboard shortcut keep working for now, and [`farm doctor`](/docs/doctor) is not
> deprecated.

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
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  devtools: {
    enabled: false,
  },
});
```

To keep the dashboard available while turning off only the keyboard shortcut, use `shortcut: false`. You can also assign another shortcut with modifier names joined by `+`:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  devtools: {
    shortcut: "mod+shift+d",
  },
});
```

`mod` maps to `Command` on macOS and `Ctrl` on Windows and Linux. Farm also accepts `ctrl`, `meta`, `alt`, and `shift` explicitly. DevTools remains development-only even when `enabled: true` is present in production configuration.

## Configure the build activity indicator

During HMR, Farm briefly shows build status in the bottom-right corner. Move it when that corner
overlaps application controls, or disable it independently from DevTools:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: "top-left",
  },
});
```

`buildActivityPosition` accepts `top-left`, `top-right`, `bottom-left`, or `bottom-right`. Set
`buildActivity: false` to emit no indicator runtime. Dev indicators are omitted from production
output regardless of this setting.

## What the dashboard shows

| View     | What Farm reports                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Overview | Route, API, middleware, integration, schedule, and diagnostic totals.                                                        |
| Routes   | Pages, layouts, loading boundaries, error boundaries, source files, and effective runtime controls.                          |
| API      | Registered methods, paths, source modules, runtime, regions, and maximum duration.                                           |
| Systems  | Integration routes and middleware, React providers, database models, request middleware, and KV mounts.                      |
| Runtime  | Deployment target, Nitro preset, output directory, cron routes, workflows, layers, feature flags, and environment key names. |

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

Environment values are never included. Farm reports only the validated server and public key names so you can confirm the environment contract without exposing secrets. This endpoint is also what [`farm doctor`](/docs/doctor) probes for live diagnostics.

## Security boundary

DevTools is development-only, but the snapshot still contains project paths, route structure, integration names, and environment key names. Do not expose the development server or the `__farm/devtools` routes to an untrusted network.

The snapshot never serializes environment values, provider credentials, storage connection details, request data, cookies, or application records. [`farm doctor --json`](/docs/doctor) follows the same rule.
