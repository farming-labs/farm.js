---
title: "Client Plugins"
description: "Define typed hydration, navigation, error, performance, and cleanup hooks directly inside a Farm plugin."
section: "Plugin Ecosystem"
---

# Client Plugins

A Farm plugin can own server and browser behavior through one `definePlugin()` call. Add lifecycle hooks directly under `client`; Farm extracts those hooks into its generated browser runtime in development and production.

Application code does not mount a provider, initialize a second registry, or forward router events.

## Define both sides

**farm.config.ts**

```ts
import { defineConfig, definePlugin } from "@farm.js/core";

const analytics = definePlugin({
  name: "acme:analytics",
  version: "1.0.0",
  enforce: "post",

  setup() {
    return {
      // This value stays on the server.
      serverToken: process.env.ANALYTICS_TOKEN,
    };
  },

  runtime: {
    after({ response }) {
      return response;
    },
  },

  client: {
    public: {
      projectId: "storefront",
      sampleRate: 0.25,
    },

    async setup({ plugin, public: config, router, isDev }) {
      const { createAnalytics } = await import("@acme/analytics/browser");
      const analytics = createAnalytics(config);

      return {
        analytics,
        pluginName: plugin.name,
        debug: isDev,
        navigate: router.navigate.bind(router),
      };
    },

    hydration: {
      before({ state, mode }) {
        state.analytics.event(`hydration:${mode}`);
      },
      after({ state, durationMs, recovered }) {
        state.analytics.event("hydrated", { durationMs, recovered });
      },
    },

    navigation: {
      before({ state, to, signal }) {
        if (!signal.aborted) state.analytics.event("before", { path: to.pathname });
      },
      loaded({ state, to }) {
        state.analytics.event("loaded", { path: to.pathname });
      },
      resolved({ state, to }) {
        state.analytics.event("resolved", { path: to.pathname });
      },
      rendered({ state, to, durationMs }) {
        state.analytics.page(to.href, { durationMs });
      },
      error({ state, error, to }) {
        state.analytics.error(error, { path: to.pathname });
      },
    },

    error({ state, error, phase }) {
      state.analytics.error(error, { phase });
    },

    close({ state, reason }) {
      state.analytics.flush(reason);
    },
  },
});

export default defineConfig({
  plugins: [analytics],
});
```

The value returned by `client.setup` becomes typed `state` in every later client hook. The shape of `client.public` is inferred and available as read-only `public` data in every event.

Server `setup` state and client `setup` state are intentionally separate. Neither is merged into a global application object.

## Browser boundary

Farm extracts only known properties under `client` into a generated browser module. A client hook does not close over the surrounding server module.

Everything a client hook needs should come from:

- the hook event, including `public`, `router`, and route information
- browser globals such as `window` and `document`
- a dynamic import made inside a client hook
- state returned by `client.setup`

```ts
client: {
  public: { release: "2026.07" },

  async setup({ public: config }) {
    const { startReporter } = await import("./reporter.browser");
    return startReporter(config.release);
  },

  navigation: {
    rendered({ state, to }) {
      state.page(to.pathname);
    },
  },
},
```

Do not reference a server module variable from a client hook. Put intentionally public values in `client.public`, import browser dependencies inside a hook, and return reusable browser helpers from `client.setup`.

## Lifecycle reference

| Hook                         | When it runs                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `client.setup`               | Once when Farm starts the generated browser runtime. May return typed private client state.           |
| `client.hydration.before`    | Immediately before Farm hydrates or initially renders a hydratable route.                             |
| `client.hydration.after`     | After React accepts the initial hydrate or render operation.                                          |
| `client.navigation.before`   | After navigation blockers pass and before route data or code loads.                                   |
| `client.navigation.loaded`   | After route data, route code, or server HTML is ready.                                                |
| `client.navigation.resolved` | After Farm updates history and commits the navigation render.                                         |
| `client.navigation.rendered` | After the browser receives two animation frames for the committed route.                              |
| `client.navigation.error`    | When loading or committing that navigation fails.                                                     |
| `client.error`               | For hook failures, browser errors, unhandled rejections, hydration failures, and navigation failures. |
| `client.performance`         | For supported browser `PerformanceEntry` values. Farm observes only when this hook exists.            |
| `client.close`               | During page hide, HMR disposal, or explicit runtime cleanup.                                          |

Hydration events include `mode: "hydrate" | "render"`, the root `container`, timing, and whether Farm recovered. A server-only page still starts client plugins but does not emit hydration hooks when no browser render occurs.

Navigation events include:

- `id`, `from`, `to`, and `action`
- an `AbortSignal` aborted when a newer navigation supersedes the current one
- matched route `pattern` and `params` when available
- `durationMs` after loading begins
- loaded route data in `navigation.loaded`

Farm skips later lifecycle hooks for an aborted navigation.

## Shared event values

| Value              | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `plugin`           | Stable plugin `name` and optional `version`.                                     |
| `public`           | Read-only JSON-safe data declared as `client.public`.                            |
| `router`           | Active client router with `navigate`, optional `prefetch`, and navigation state. |
| `isDev` / `isProd` | Current browser build mode.                                                      |
| `deploymentId`     | Farm deployment identifier when available.                                       |
| `state`            | This plugin's `client.setup` result, available after setup.                      |

## Ordering and failures

Client hooks use the parent plugin's `enforce` order:

1. `pre` plugins
2. normal plugins
3. `post` plugins

Farm runs hooks serially in that order. Cleanup runs in reverse order. A failed hook does not stop sibling plugins or application rendering; Farm logs it and sends it to other client error hooks with a phase such as `plugin:navigation.before`.

## Security boundary

The browser entry is an allowlisted extraction, not a serialization of the whole plugin.

- Farm copies only `setup`, `hydration`, `navigation`, `error`, `performance`, and `close` from `client`.
- Server hooks, server setup state, request context, imports, and environment values are not copied.
- Only `client.public` data crosses the server-to-browser boundary.
- Public data must contain JSON-safe scalars, dense arrays, and plain objects.
- Farm rejects functions, symbols, bigint values, non-finite numbers, class instances, dates, `undefined`, accessors, hidden properties, sparse arrays, and circular references.
- Farm rejects unknown lifecycle fields, accessors, and native or bound hook functions.
- Every public value is visible to anyone who can load the application JavaScript.

## Published plugins

A package exposes one ordinary plugin factory:

```ts
import { definePlugin } from "@farm.js/core";

export function analyticsPlugin(projectId: string) {
  return definePlugin({
    name: "acme:analytics",

    client: {
      public: { projectId },

      async setup({ public: config }) {
        const { createAnalytics } = await import("./analytics.browser.js");
        return createAnalytics(config.projectId);
      },

      navigation: {
        rendered({ state, to }) {
          state.page(to.href);
        },
      },
    },
  });
}
```

Use a modern JavaScript target when publishing inline lifecycle hooks so function source remains available to Farm's build extraction.

## Good use cases

- navigation and Web Vitals instrumentation
- client error reporting and release metadata
- view-transition coordination
- browser capability detection
- devtools panels and HMR diagnostics
- route progress UI owned by framework tooling
- client cache observers shared by a server plugin

Product SDK providers and typed product endpoints still belong in an [integration](/docs/integrations). Use a client plugin when behavior follows Farm's browser lifecycle across unrelated applications.

## Production checklist

- Keep `client.setup`, `navigation.before`, and `navigation.loaded` short.
- Respect navigation cancellation for optional async work.
- Sample high-volume performance and navigation telemetry.
- Flush best-effort telemetry in `client.close`, but do not make correctness depend on page-hide delivery.
- Test hydration, SPA navigation, cancellation, failure isolation, cleanup, and a production preset build.

Continue with [Create a Plugin](/docs/plugins/create-plugin) for server lifecycle and packaging patterns.
