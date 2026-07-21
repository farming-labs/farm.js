---
title: "Client Plugins"
description: "Run typed hydration, navigation, error, performance, and cleanup hooks from the same Farm plugin used on the server."
section: "Extending"
---

# Client Plugins

A Farm plugin can have a server side and a browser side without becoming two unrelated plugins. The server definition owns framework hooks and private state. Its `client` property points to a separate browser-safe module that joins Farm's generated client runtime.

```text
one plugin identity
  server module -> config, requests, routes, rendering, builds
  client module -> setup, hydration, navigation, errors, performance
```

Farm imports the browser module automatically in development and production. Application code does not need to mount a provider, initialize a second registry, or manually forward router events.

## Register the browser module

**farm.config.ts**

```ts
import { defineConfig, definePlugin } from "@farmjs/core";

const analytics = definePlugin({
  name: "acme:analytics",
  version: "1.0.0",
  enforce: "post",

  setup() {
    return {
      serverToken: process.env.ANALYTICS_TOKEN,
    };
  },

  runtime: {
    after({ response }) {
      return response;
    },
  },

  client: {
    source: "./src/plugins/analytics.client.ts",
    public: {
      projectId: "storefront",
      sampleRate: 0.25,
    },
  },
});

export default defineConfig({
  plugins: [analytics],
});
```

`source` may be a project-relative path, an absolute path, a file URL, or a package specifier. A path beginning with `.` is resolved from the application root.

## Define the client lifecycle

The browser module exports either a client plugin object or a factory as its default export. A factory receives the `public` options from the server definition.

**src/plugins/analytics.client.ts**

```ts
import { defineClientPlugin } from "@farmjs/core/plugin/client";

interface AnalyticsClientOptions {
  projectId: string;
  sampleRate: number;
}

export default function analyticsClient(
  options: Readonly<AnalyticsClientOptions>,
) {
  return defineClientPlugin({
    setup({ plugin, router, isDev }) {
      const events: string[] = [];

      return {
        events,
        projectId: options.projectId,
        debug: isDev,
        navigate: router.navigate.bind(router),
        pluginName: plugin.name,
      };
    },

    hydration: {
      before({ state, mode }) {
        state.events.push(`hydration:${mode}`);
      },
      after({ state, durationMs, recovered }) {
        state.events.push(`hydrated:${durationMs}:${recovered}`);
      },
    },

    navigation: {
      before({ state, to, signal }) {
        if (!signal.aborted) state.events.push(`before:${to.pathname}`);
      },
      loaded({ state, to }) {
        state.events.push(`loaded:${to.pathname}`);
      },
      resolved({ state, to }) {
        state.events.push(`resolved:${to.pathname}`);
      },
      rendered({ state, to, durationMs }) {
        sendPageView(state.projectId, to.href, durationMs);
      },
      error({ error, to }) {
        reportNavigationError(error, to.href);
      },
    },

    error({ error, phase }) {
      reportBrowserError(error, phase);
    },

    close({ state, reason }) {
      flushEvents(state.events, reason);
    },
  });
}
```

The value returned by `setup` becomes typed `state` in every later hook. Each plugin instance owns its state; Farm does not merge client state into a global application object.

## Lifecycle reference

| Hook | When it runs |
| --- | --- |
| `setup` | Once when Farm starts the generated browser runtime. May return typed private state. |
| `hydration.before` | Immediately before Farm hydrates or initially renders a hydratable route. |
| `hydration.after` | After React accepts the initial hydrate or render operation. |
| `navigation.before` | After navigation blockers pass and before route data or code loads. |
| `navigation.loaded` | After route data, route code, or server HTML is ready. |
| `navigation.resolved` | After Farm updates history and commits the navigation render. |
| `navigation.rendered` | After the browser has received two animation frames for the committed route. |
| `navigation.error` | When loading or committing that navigation fails. |
| `error` | For plugin hook failures, browser errors, unhandled rejections, hydration failures, and navigation failures. |
| `performance` | For supported browser `PerformanceEntry` values. Farm observes only when a plugin defines this hook. |
| `close` | During page hide, HMR disposal, or explicit runtime cleanup. |

Hydration events include `mode: "hydrate" | "render"`, the root `container`, timing, and whether Farm recovered. A server-only page still starts client plugins, but it does not emit hydration hooks when no browser render occurs.

Navigation events include:

- `id`, `from`, `to`, and `action`
- an `AbortSignal` that aborts when a newer navigation supersedes the current one
- matched route `pattern` and `params` when the runtime has them
- `durationMs` after loading begins
- loaded route data in `navigation.loaded`

Plugins should stop optional work when `signal.aborted` becomes true. Farm skips later lifecycle hooks for an aborted navigation.

## Shared setup values

Every setup and lifecycle event includes:

| Value | Meaning |
| --- | --- |
| `plugin` | Stable plugin `name` and optional `version`. |
| `options` | Read-only JSON-safe options declared as `client.public`. |
| `router` | Farm's active client router with `navigate`, optional `prefetch`, and navigation state. |
| `isDev` / `isProd` | Current browser build mode. |
| `deploymentId` | Farm deployment identifier when available. |
| `state` | This client plugin's `setup` result, available after setup. |

The same manager and ordering rules run in development and universal production output.

## Ordering and failures

Client plugins use the parent plugin's `enforce` value:

1. `pre` plugins
2. normal plugins
3. `post` plugins

Farm runs lifecycle hooks serially in that order. Cleanup runs in reverse order so dependents close before the plugins they depend on.

One failed client hook does not stop sibling plugins or the application render. Farm logs the failure and sends it to other plugins' `error` hooks with a phase such as `plugin:navigation.before`. An error hook is isolated too; an error reporter cannot replace the original failure.

## Security boundary

The browser entry is an explicit security boundary, not a serialization of the server plugin.

- Farm bundles only the module named by `client.source`.
- Server `setup` state, runtime context, request data, and environment values are never copied into the client registration.
- Only `client.public` crosses the boundary. Its value must contain JSON-safe scalars, dense arrays, and plain objects.
- Farm rejects functions, symbols and symbol keys, bigint values, non-finite numbers, class instances, dates, `undefined`, accessors, hidden properties, sparse arrays, and circular references instead of silently reshaping or dropping them.
- Remote and executable URL schemes are rejected for both string and `URL` inputs. Use a local file, package export, absolute path, or file URL.
- Treat every public option as visible to anyone who can load the application JavaScript.

Do not import Node-only modules, database clients, private environment helpers, or server-only plugin files from the client module.

## Published plugin packages

A package can keep both sides next to each other while exposing one plugin factory:

```ts
import { definePlugin } from "@farmjs/core";

export function analyticsPlugin(projectId: string) {
  return definePlugin({
    name: "acme:analytics",
    client: {
      source: new URL("./analytics.client.js", import.meta.url),
      public: { projectId },
    },
  });
}
```

The file URL is resolved by the server-side package module. Farm then gives the resolved local browser entry to the bundler.

## Good use cases

- navigation and Web Vitals instrumentation
- client error reporting and release metadata
- view-transition coordination
- browser feature policy or capability detection
- devtools panels and HMR diagnostics
- route progress UI owned by framework tooling
- client cache observers shared by a server plugin

Product SDK providers and typed product endpoints still belong in an [integration](/docs/integrations). Use a client plugin when the behavior follows Farm's browser lifecycle across unrelated applications.

## Production checklist

- Keep the browser module side-effect-light until `setup` runs.
- Keep `navigation.before` and `navigation.loaded` short so they do not delay navigation.
- Respect navigation cancellation for fetches and optional async work.
- Sample high-volume performance and navigation telemetry.
- Flush best-effort telemetry in `close`, but do not make correctness depend on page-hide delivery.
- Test initial hydration, SPA navigation, superseded navigation, hook failure isolation, HMR cleanup, and a production preset build.

Continue with [Create a Plugin](/docs/plugins/create-plugin) for the server lifecycle and packaging patterns.
