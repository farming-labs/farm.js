# @farm.js/devtools

Farm's official DevTools: a development-only workspace for Farm.js routes, APIs, integrations,
runtime diagnostics, and browser modules. It replaces the deprecated built-in dashboard. Uses the Farm logo, bundled Geist fonts, light/dark themes, and syntax-highlighted
source and JSON with safe copy controls.

```ts
import { defineConfig } from "@farm.js/core";
import { devtools } from "@farm.js/devtools";

export default defineConfig({ plugins: [devtools()] });
```

Install with `pnpm add -D @farm.js/devtools`. Open the lower-left launcher or press
`Command/Ctrl + Shift + .` during `farm dev`. The UI loads only when opened. The plugin is
removed from production configuration, with no production client or server endpoint.

Options: `launcher?: boolean`, `shortcut?: string | false`, `inspect?: boolean`. Registration
is the opt-in; there is no `enabled` option. Without the plugin, apps fall back to the
deprecated built-in dashboard. Do not combine it with `devtools: false`.

Plugins lists active Farm plugins in the plugin manager's execution order (pre, normal, post),
with versions and declared server/client hook names. It includes legacy hook names as declared.
This is registration metadata, not a call trace; parallel hooks can finish in a different order.
Plugin configuration, public data, hook source, and private state are never serialized.

Inspect compares the current application source with Vite's cached browser output, not individual
plugin stages. Only already-transformed, in-project browser source is eligible; virtual/server-only
modules, dependencies, hidden paths, and outside-project symlinks are excluded. Limits: 500 listed
modules, 1 MiB per source/output, 1,500 displayed lines. Copy includes the full bounded text.
While Inspect is open, the selected module refreshes after Vite completes an HMR update. Pending
updates, failures, and disconnects label previously displayed code as stale. This reuses the app's
Vite connection, without polling or a second socket. Other views keep their filters and selection;
use Refresh for their latest snapshot. A full page reload closes the panel with the app.

DevTools is read-only, not an authentication boundary for a public development server. Environment
values are absent from snapshots; literals in client source are not redacted. Keep development
servers private. Assets and highlighting are local, without CDN calls.

Full documentation: https://farmjs.dev/docs/plugins/devtools

This package is independently versioned and is picked up by the workspace build, test, packing,
and publishing scripts. No starter dependency is added automatically.
