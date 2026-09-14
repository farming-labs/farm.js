---
title: "DevTools"
description: "A development workspace for routes, APIs, integrations, runtime diagnostics, and syntax-highlighted browser module inspection."
section: "Plugin Ecosystem"
---

# DevTools

`@farm.js/devtools` brings Farm's runtime snapshot into a development-only workspace. Browse
routes and their runtime settings, inspect configured integrations, and compare application
source with the JavaScript Vite served. The interface uses the Farm logo, locally bundled Geist
fonts, light and dark themes, and syntax-highlighted code with copy controls.

## Setup

```bash
pnpm add -D @farm.js/devtools
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { devtools } from "@farm.js/devtools";

export default defineConfig({
  plugins: [devtools()],
});
```

Run `farm dev`, then use the **DevTools** button in the lower-left corner. The existing
`Command + Shift + .` shortcut on macOS, or `Ctrl + Shift + .` on Windows and Linux, opens the
same window. `Escape`, the close button, or clicking outside returns to the app.

The launcher matches Hints' compact, rounded trigger, with a small Farm logo and a Geist Mono
label. It follows your system's light or dark theme, independently of the window's theme choice.

The window dims and blurs the app behind it. Its content scrolls independently, and closing it
restores the app's scrolling and focus without jumping the page. Use the sun/moon button to
switch themes. DevTools follows your system theme until you choose one, then remembers your choice.

The launcher URL is `/__farm/devtools` on your development origin. The UI loads on demand in
an iframe, isolated from application CSS. Its fonts, code highlighter, and assets are served
locally, without CDN requests. The maintained `examples/hints-demo` combines DevTools with
the separate Hints plugin.

## What you can inspect

| View        | Purpose                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Overview    | Real route/API/integration counts and framework diagnostics.                                                                    |
| Routes      | Filter pages, layouts, loading states, and error boundaries; inspect source paths and effective runtime, regions, and duration. |
| API         | Registered methods and paths, source modules, and server runtime controls. Selecting an endpoint never invokes it.              |
| Systems     | Integration routes, middleware/provider/model counts, request middleware, and KV mount metadata.                                |
| Runtime     | Deployment target, Nitro preset, output directory, schedules, workflows, layers, feature switches, and environment key names.   |
| Inspect     | Source and served JavaScript for already-transformed browser modules, with imports and importers.                               |
| Diagnostics | Runtime configuration checks shared with `farm doctor`. These are not TypeScript or accessibility checks.                       |
| Snapshot    | The current JSON snapshot, with syntax highlighting and copy support.                                                           |

Use **Refresh** to capture the latest workspace state. The footer pairs Hints-style
**Development only** and **Esc to close** labels with the snapshot time and copy feedback.
If the server becomes unavailable, DevTools identifies the stale snapshot instead
of silently presenting it as current. Press `/` in Routes or API to focus its filter.

## Inspect source and generated code

Open an application page before opening **Inspect**. Select a module to see its current source
on disk alongside the most recent browser transform cached by Vite. For a TSX component,
this makes removed TypeScript annotations, generated JSX calls, and rewritten imports visible.
Code is highlighted as JavaScript/TypeScript/JSX; other source formats remain readable but do
not have dedicated language grammars. Copy preserves the original text, not highlighting markup.

This is a **source-to-output comparison**, not a per-plugin transform timeline or an exact diff.
It does not instrument transform hooks, run modules, or trigger transformations just to populate
the inspector. After an edit, reload the app and refresh Inspect so the served transform is current.

Only known, already-transformed browser modules inside the project are eligible. Server-only
modules, virtual modules, dependencies, hidden paths, and symlinks escaping the project are
excluded. Supported source extensions are JS/TS (including JSX, TSX, MJS, CJS, MTS, and CTS),
CSS, Vue, and Svelte. The list is capped at 500 modules. Source and generated output are each
limited to 1 MiB; the display shows up to 1,500 lines, while Copy includes the full bounded text.

## Options

Adding the plugin is the opt-in. There is no extra `enabled` flag.

```ts title="farm.config.ts"
devtools({
  launcher: false, // Keep keyboard access, hide the floating button.
  shortcut: "mod+shift+d", // Or false to disable keyboard access.
  inspect: false, // Omit the module inspector and its endpoints.
});
```

All options are optional and typed. `launcher` and `inspect` default to `true`. If `shortcut` is
omitted, Farm's existing shortcut configuration is preserved. Register one DevTools instance.

The existing top-level `devtools` configuration and core dashboard remain supported without
this plugin. Remove `devtools: false` or `devtools: { enabled: false }` before adding `devtools()`;
contradictory settings fail with an actionable configuration error.

## Security and production

The plugin removes itself during production configuration. Its UI, launcher, module endpoints,
fonts, and syntax highlighter are not emitted into the application's production output. No
renderer-specific adapter is required.

DevTools is read-only, but source code and route metadata are sensitive. Keep your development
server on a trusted network. Browser requests must use a trusted development host and cannot
come from a different origin. Custom development hostnames must be explicitly listed in Vite's
`server.allowedHosts` (or set as `server.host`). Wildcard `allowedHosts: true` does not disable
this plugin's host checks.

Snapshots contain environment **key names only**, not environment values, credentials, request
bodies, cookies, or application records. Browser source can still contain literals you wrote
into client code; the inspector does not claim to redact source code. The read-only snapshot
endpoint and `farm doctor` retain their existing behavior.

See [DevTools and Doctor](/docs/devtools) for the core dashboard and terminal checks, and
[Hints](/docs/plugins/hints) for opt-in accessibility and performance checks.
