# @farm.js/plugin

Official plugins for Farm.js. Its main entry, `@farm.js/plugin/rsc`, is the React Server Components
pipeline Farm runs on the official `@vitejs/plugin-rsc`: it generates the RSC, SSR, and browser
entries from your routes, applies the server function transform for client imports, and builds the
output through Nitro. The package also ships standalone Vite plugins for middleware and API routes,
and two Farm plugins for observability signals and request context.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.
React Server Components themselves are an experimental feature outside that promise.

## Install

Most apps never install this package by hand. With `experimental.serverComponents` set in
`farm.config.ts`, `farm dev` and `farm build` install `@farm.js/plugin` at the version of the
installed `@farm.js/core`, and its RSC peers at the versions it pins. CI never changes dependencies,
and `FARM_SKIP_RSC_INSTALL=1` turns the install off anywhere else. To install it yourself:

```bash
pnpm add @farm.js/plugin @vitejs/plugin-rsc react-server-dom-webpack
```

`@farm.js/core`, `react`, `react-dom`, and `vite` are required peers. `@vitejs/plugin-rsc` and
`react-server-dom-webpack` are optional peers, needed only for `@farm.js/plugin/rsc`. The RSC
pipeline accepts one tested combination of `react`, `react-dom`, `react-server-dom-webpack`, and
`@vitejs/plugin-rsc`, pinned exactly in this package's `peerDependencies`, and stops at startup
with the expected and found versions when the app resolves anything else.

## Configure

The usual setup is one flag in `farm.config.ts`. Farm maps the config onto this plugin:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
    // Opt in separately to client-callable server actions and server functions.
    serverActions: true,
  },
});
```

An app driven by the `vite` CLI uses `defineConfig` from `@farm.js/plugin/rsc` in
`vite.config.ts` instead, as the `examples/rsc-demo` app does. `@vitejs/plugin-react` is installed
separately here:

```ts
// vite.config.ts
import rsc from "@vitejs/plugin-rsc";
import react from "@vitejs/plugin-react";
import { defineConfig, nitro } from "@farm.js/plugin/rsc";

export default defineConfig({
  srcDir: "src",
  experimental: { serverActions: true },
  plugins: [
    rsc({
      serverHandler: false,
      entries: {
        rsc: "./.farm/rsc-entries/entry.rsc.tsx",
        ssr: "./.farm/rsc-entries/entry.ssr.tsx",
        client: "./.farm/rsc-entries/entry.browser.tsx",
      },
    }),
    react(),
    nitro({ server: { environmentName: "rsc" }, config: { preset: "node-server" } }),
  ],
});
```

The plugin writes those entry files under `.farm/rsc-entries/`. Useful `defineConfig` options:

| Option                           | Default | Notes                                                          |
| -------------------------------- | ------- | -------------------------------------------------------------- |
| `srcDir`                         | `"src"` |                                                                |
| `routesDir`                      | `"app"` | Route folder inside `srcDir`. `""` uses `srcDir` itself.       |
| `port`                           | `3000`  | Development server port.                                       |
| `experimental.serverActions`     | `false` | React Server Actions and their POST decoder.                   |
| `experimental.optimizedBoundary` | `false` | Native Strata rendering for eligible host-only trees.          |
| `middleware`, `api`, `images`    |         | Same shapes as in `farm.config.ts`.                            |
| `md`, `agent.llmsTxt`, `mcp`     |         | Markdown mirrors, `/llms.txt`, and MCP (needs `@farm.js/mcp`). |
| `deploymentId`                   |         | Rejects requests from stale deployments.                       |
| `plugins`                        |         | Extra Vite plugins, such as `rsc()`, `react()`, and `nitro()`. |

`nitro()` builds the deployment after `vite build`. `config.preset` falls back to `NITRO_PRESET`,
then `vercel`, and `config.outputDir` defaults to `.output`.

## Entry points

- `@farm.js/plugin`: only `version`. Import plugins from a subpath.
- `@farm.js/plugin/rsc`: `defineConfig`, the underlying RSC Vite plugins as the default export,
  `nitro`, and `buildRscNitro` for post-build scripts.
- `@farm.js/plugin/rsc/vite-plugin-nitro`: the same `nitro()` Vite plugin as a default export.
- `@farm.js/plugin/rsc/optimized-boundary`: `OptimizedBoundary` and the Strata document types, for
  explicit native boundaries. With `experimental.optimizedBoundary` Farm selects eligible regions
  automatically, so most apps need no import. Strata uses a native Node binding; keep the experiment
  on Node deployments.
- `@farm.js/plugin/middleware` and `@farm.js/plugin/api`: `farmMiddleware` and `farmApi`, Vite
  plugins for apps without the RSC pipeline.
- `@farm.js/plugin/observability` and `@farm.js/plugin/context`: `observabilityPlugin` and
  `contextPlugin`, Farm plugins.

## Standalone Vite plugins

`farmMiddleware` runs `middleware.ts` files found under `srcDir`, and `farmApi` serves
`route.ts` files under `<srcDir>/api` at `/api/...` from their exported method handlers. Both hook
into the Vite development server only.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { farmMiddleware } from "@farm.js/plugin/middleware";
import { farmApi } from "@farm.js/plugin/api";

export default defineConfig({
  plugins: [farmMiddleware({ srcDir: "src" }), farmApi({ srcDir: "src" })],
});
```

## Farm plugins

`observabilityPlugin` records signals for completed requests, API responses, renders, errors, and
builds, and turns 5xx responses, runtime errors, and requests slower than `telemetry.slowRequestMs`
(default `300`) into deduplicated incidents. Its default `workflow.pipeline` is `["notify"]`, which
calls `workflow.callbacks.onIncident` or logs a warning. `telemetry.annotateHtml` (default `true`)
appends an HTML comment with the path and route to rendered pages.

```ts
import { defineConfig } from "@farm.js/core";
import { observabilityPlugin } from "@farm.js/plugin/observability";

export default defineConfig({
  plugins: [
    observabilityPlugin({
      service: "storefront",
      telemetry: { slowRequestMs: 500 },
      workflow: {
        callbacks: {
          onIncident: ({ incident }) => console.warn(incident.severity, incident.title),
        },
      },
    }),
  ],
});
```

`contextPlugin` is a small example plugin. It sets `requestId` (from `x-request-id`, or a random
UUID), `locale` (from `x-locale`, default `en`), and `pathname` on the request context and exposes
them to server page props as `props.context`.

Both are Farm plugins, so they run in ordinary Farm apps. The RSC pipeline ignores Farm `plugins`
with a warning.

## Documentation

- [Server Rendering](https://farmjs.dev/docs/server-rendering): React Server Components setup and
  the optimized boundary experiment.
- [Server Queries](https://farmjs.dev/docs/server-queries): the server function transform.
- [Middleware](https://farmjs.dev/docs/middleware), [Markdown](https://farmjs.dev/docs/markdown),
  and [MCP](https://farmjs.dev/docs/plugins/mcp) in RSC apps.
- [Configuration](https://farmjs.dev/docs/configuration)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
