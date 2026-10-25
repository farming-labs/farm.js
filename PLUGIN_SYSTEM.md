# Plugin System

A Farm.js plugin adds behavior to the framework itself: request tracing, security headers, HTML
transforms, route analysis, build steps, development tooling, browser lifecycle hooks, or its own
API routes and database tables. This page lists every option a plugin can set, what each one
receives, and when Farm calls it.

For longer walkthroughs and examples, see the docs:
[Create a Plugin](https://farmjs.dev/docs/plugins/create-plugin),
[Client Plugins](https://farmjs.dev/docs/plugins/client), and
[Plugin tables](https://farmjs.dev/docs/plugins/schema-tables).

## Quick start

**src/plugins/request-id.ts**

```ts
import { definePlugin } from "@farm.js/core";

export const requestIdPlugin = definePlugin({
  name: "acme:request-id",

  setup() {
    return { header: "x-request-id" };
  },

  runtime: {
    context({ request, state }) {
      return { requestId: request.headers.get(state.header) ?? crypto.randomUUID() };
    },

    after({ response, ctx, state }) {
      const headers = new Headers(response.headers);
      headers.set(state.header, ctx.requestId);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  },

  render: {
    html(html) {
      return html.replace("</head>", '<meta name="generator" content="Farm.js"></head>');
    },
  },
});
```

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { requestIdPlugin } from "./src/plugins/request-id";

export default defineConfig({
  plugins: [requestIdPlugin],
});
```

Always wrap the object in `definePlugin()`. It infers the types of `state`, `ctx`, options, and
routes, so hooks are typed without passing generics. Annotating the value as the broad
`FarmPlugin` type erases that inference.

## Options at a glance

| Option       | Type                                  | Runs in           | What it is for                                                                  |
| ------------ | ------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `name`       | `string` (required)                   | -                 | Unique id, shown in errors and devtools. Use a prefix such as `acme:security`.  |
| `version`    | `string`                              | -                 | The plugin's own version, shown in diagnostics.                                 |
| `enforce`    | `"pre" \| "post"`                     | -                 | Run before or after plugins without `enforce`.                                  |
| `options`    | Standard Schema                       | config load       | Validate the app's options; `definePlugin` then returns a factory.              |
| `configure`  | `(config, context) => config \| void` | dev, build        | Change the Farm config before the pipeline is created.                          |
| `setup`      | `(context) => state`                  | dev, build, start | Create the plugin's private state, passed to every hook as `state`.             |
| `runtime`    | object of hooks                       | dev, production   | Handle requests: own endpoints, add context, rewrite requests and responses.    |
| `router`     | object of hooks                       | dev, build        | Observe route discovery and page-route matching.                                |
| `render`     | object of hooks                       | dev, production   | Run before a page renders, or rewrite its HTML.                                 |
| `build`      | object of hooks                       | production build  | Run around the production build and change the Nitro build config.              |
| `dev`        | object of hooks                       | development       | Use the Vite dev server and react to file updates.                              |
| `client`     | object of browser hooks               | browser           | Hydration, navigation, browser error, performance, and cleanup hooks.           |
| `routes`     | `({ route, api }) => routes`          | dev, production   | Add typed API routes without files in `src/app`.                                |
| `schema`     | `FarmSchema`                          | CLI, runtime      | Tables the plugin stores data in.                                               |
| `database`   | `{ client?, dialect? }`               | CLI, runtime      | Where those tables live, when not in the app's `storage.client`.                |
| `dependsOn`  | `string[]`                            | config load       | Other plugins or integrations this plugin needs.                                |
| `migrations` | `FarmSchemaMigrationStep[]`           | CLI               | Changes to the plugin's tables that Farm can't infer, such as a renamed column. |

The sections below describe each option and hook in detail.

## Identity and order

### `name`

Required. A unique, stable id for the plugin, such as `acme:security`. Farm uses it in error
messages, in devtools, in `dependsOn`, and, for plugins with a `schema`, as the CLI namespace:
`farm <name> migrate` uses the part after the last `:` or `/`, so `acme:teams` becomes
`farm teams migrate`.

### `version`

Optional. The plugin's own version string, shown in diagnostics. It does not affect behavior.

### `enforce`

Optional, `"pre"` or `"post"`. Farm runs plugin hooks in three groups: `pre` plugins, then
plugins without `enforce`, then `post` plugins. Within a group, plugins run in the order they
appear in `plugins`. Use `pre` for plugins others build on (for example one that sets request
context) and `post` for ones that should see everyone else's changes (for example one that
measures the final response).

## Options and setup

### `options`

Declare the plugin's options with a [Standard Schema](https://standardschema.dev) (Zod, Valibot,
ArkType, and others). `definePlugin` then returns a factory instead of a plugin:

```ts
export const securityPlugin = definePlugin({
  name: "acme:security",
  options: z.object({ frameAncestors: z.string().default("'none'") }),
  runtime: {
    after({ response, state }) {
      // state.frameAncestors is a string here
      return response;
    },
  },
});

// farm.config.ts
plugins: [securityPlugin({ frameAncestors: "'self'" })];
```

- The app gets the schema's input type, so wrong or unknown options are type errors.
- Invalid options throw `FarmPluginOptionsError` while the config loads, listing every problem.
- The parsed options, with defaults applied, are the plugin's `state` when it has no `setup`,
  and are passed to `setup` and `configure` as `options` when it does.
- The schema must validate synchronously, because plugins are created while the config loads.

### `configure(config, context)`

Runs after Farm loads the app config and before it creates the development or production
pipeline. Return a new config to replace it, or nothing to keep it. Use it for defaults that
depend on other settings:

```ts
configure(config) {
  return { ...config, observability: config.observability ?? { events: true } };
}
```

### `setup(context)`

Runs once per plugin manager and returns the plugin's private **state**. Every later hook
receives it as `state`. `context` includes `env` (the resolved environment), `config`, `isDev`,
`isProd`, and `lifecycle`. With `options`, it also includes `options`.

Setup can run in the build process and again in the deployed runtime, so keep it deterministic.
Register cleanup for anything it opens with `lifecycle.onShutdown()`:

```ts
setup({ lifecycle }) {
  const redis = createRedisClient();
  lifecycle.onShutdown(() => redis.quit());
  return { redis };
}
```

## `runtime`: request hooks

Runtime hooks run for every request in development and in production output. Each hook receives
one event object.

| Hook        | Called                                                         | Returns                                                                 |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `endpoints` | (an array, not a hook) Exact paths the plugin answers itself   | Each `handler(event)` returns a `Response`                              |
| `start`     | Once, when the runtime starts, before it serves requests       | Nothing                                                                 |
| `context`   | At the start of each request                                   | A plain object merged into `ctx`, or nothing                            |
| `before`    | After `context`, before Farm's route handler                   | A new `Request` to replace it, a `Response` to answer early, or nothing |
| `after`     | After the handler produced a response, including early answers | A new `Response` to replace it, or nothing                              |
| `error`     | When the request throws                                        | Nothing (it observes; it cannot change the response)                    |
| `close`     | Once, when the runtime shuts down, with a `reason`             | Nothing                                                                 |

**Every request event** has `request`, `req` (the shared request store), `state`, `kind` (`"page"`, `"api"`, `"action"`, `"endpoint"`, `"docs"`,
`"asset"`, and so on), `route` (`pathname`, `pattern`, `params` when matched), `signal` (aborts
when the client disconnects), `waitUntil(promise)` for background work, plus `config`, `isDev`,
and `isProd`. `before`, `after`, and `error` also get `ctx`, the merged context (read-only);
`after` and `error` get `durationMs`; `after` gets `response`; `error` gets `error`. Endpoint
handlers get `path`.

**`endpoints`** are exact application-relative paths such as `/status`, without parameters,
wildcards, or query strings; Farm adds the configured `basePath`. They run before request context
and routing, so check authorization inside the handler. Their responses still pass through
`after`, and their failures reach `error`.

**Context rules:**

- `context` must return a plain object or nothing. Farm merges every plugin's context before
  `before` runs.
- Two plugins returning the same top-level key fail the request and name both plugins.
- `ctx` is server-only. To pass a value to page props, use
  `req.set(key, value, { exposeToPage: true })`.
- Returning a new `Request` from `before` keeps both `ctx` and `req`.

Don't use `waitUntil` for work the response depends on; await it in the hook instead.

## `router`: route hooks

| Hook         | Receives                                                                                                                                                                | Called                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `discovered` | One discovered route: a page or layout (`kind`, `pattern`, `modulePath`), middleware (`path`, `filePath`, `handlerCount`), or API route (`path`, `filePath`, `methods`) | While Farm scans the app's routes              |
| `generated`  | `{ routes, pageCount, layoutCount }`                                                                                                                                    | After every page and layout route is collected |
| `before`     | `{ pathname, method }`                                                                                                                                                  | Before Farm matches a request to a page route  |
| `after`      | `{ pathname, matched, routePattern, params, layoutPatterns }`                                                                                                           | After matching                                 |

Router hooks observe; their return values are ignored. Each also receives `{ state, config, isDev, isProd }`.

## `render`: page hooks

| Hook     | Receives                                            | Returns                                     |
| -------- | --------------------------------------------------- | ------------------------------------------- |
| `before` | `{ pathname, method, routePattern, params }`        | Nothing                                     |
| `html`   | The rendered HTML string, then the same render info | A new HTML string to replace it, or nothing |

`render.html` makes Farm buffer the whole document before sending it, which turns off streaming
for that page. Use `render.before` when you don't need to rewrite HTML.

## `build`: production build hooks

| Hook        | Receives                                          | Returns                                 |
| ----------- | ------------------------------------------------- | --------------------------------------- |
| `before`    | `{ root, preset, universal, distDir, outputDir }` | Nothing                                 |
| `configure` | The Nitro build config                            | A changed config, or nothing to keep it |
| `after`     | The same info as `before`, plus `success`         | Nothing                                 |

These run during `farm build` only. Each also receives `{ state, config, isDev, isProd }`.

## `dev`: development hooks

| Hook     | Receives            | Called                                |
| -------- | ------------------- | ------------------------------------- |
| `server` | The Vite dev server | Once the dev server is created        |
| `update` | `{ file, modules }` | When a file change triggers an update |

Development hooks never run in production.

## `client`: browser hooks

`client` adds browser behavior to the same plugin. Farm extracts these hooks into the app's
browser bundle in development and production.

| Field / hook          | Called                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `public`              | (data, not a hook) JSON-safe values embedded in the browser bundle and passed to `setup`                                                     |
| `setup`               | Once in the browser; returns the client state                                                                                                |
| `hydration.before`    | Before the page hydrates                                                                                                                     |
| `hydration.after`     | After hydration completes                                                                                                                    |
| `navigation.before`   | When a client-side navigation starts                                                                                                         |
| `navigation.loaded`   | When the next page's data has loaded                                                                                                         |
| `navigation.resolved` | When the next route is resolved                                                                                                              |
| `navigation.rendered` | After the new page has rendered                                                                                                              |
| `navigation.error`    | When a navigation fails                                                                                                                      |
| `error`               | When something fails in the browser: `phase` (`setup`, `hydration`, `navigation`, `window`, `unhandled-rejection`, ...), `error`, `location` |
| `performance`         | For each `PerformanceEntry` the page reports, with `location`                                                                                |
| `close`               | When the client runtime tears down, in reverse order                                                                                         |

Never put secrets in `client.public`; it ships in the app's JavaScript. Client hooks can't use
values from the surrounding server code; use event data, browser globals, imports inside the hook,
and the state from `client.setup`. Full details:
[Client Plugins](https://farmjs.dev/docs/plugins/client).

## `routes`: typed API routes

`routes` adds API handlers without files in `src/app`. It receives `{ route, api }` and returns
route definitions built with the same validation as file routes:

```ts
routes: ({ route }) => {
  const project = route.scope("/api/projects/[projectId]");
  return [
    project.post("uploads/[uploadId]", {
      input: { body: z.object({ title: z.string() }) },
      handler(_request, { input }) {
        return { title: input.body.title };
      },
    }),
  ];
};
```

Paths must be literal `/api` paths. Route factories run at discovery, at build, and at production
startup, so keep paths and methods stable. Invalid input returns a JSON `400` before the handler
runs. See [Typed API routes](https://farmjs.dev/docs/plugins/create-plugin#typed-api-routes).

## Data: `schema`, `database`, `dependsOn`, `migrations`

- **`schema`**: tables the plugin stores data in. `farm <name> migrate` creates them, and
  `farm generate` and `farm schema check` include them. Mark tables the plugin only reads, such
  as the app's `user`, with `external: true`.
- **`database`**: `{ client, dialect }`, where the tables live when not in the app's
  `storage.client`. `client` is a pg, mysql2, or sqlite connection, or a function returning one;
  `dialect` is only needed when Farm can't detect it.
- **`dependsOn`**: plugins this one needs, by name (`farm:teams` or `teams`) or integration key.
  The config fails to load when one is missing or when they form a cycle, and migrations run
  dependencies first.
- **`migrations`**: ordered steps for changes Farm won't infer, such as a renamed column. Each
  runs once per database through `farm <name> migrate`. Added tables and columns need no step.

See [Plugin tables](https://farmjs.dev/docs/plugins/schema-tables).

## Hook context

Besides their own arguments, hooks receive a context with:

| Field             | Meaning                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `config`          | The resolved Farm config                                                                                  |
| `isDev`, `isProd` | Which mode is running                                                                                     |
| `state`           | The value returned by `setup` (or the parsed options)                                                     |
| `viteServer`      | The Vite dev server, in development                                                                       |
| `lifecycle`       | `lifecycle.onShutdown(dispose)` registers cleanup, run once in reverse order after `runtime.close` hooks  |
| `integration`     | The owning integration (`key`, `category`, `type`, `instance`), when the plugin comes from an integration |

## Other supported hooks

These flat hooks are still supported and have no structured replacement:

| Hook                                | Called                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `configResolved(config, context)`   | In development, once the dev server's config is final                                                                          |
| `onError(payload, context)`         | When Farm reports an error; `payload` has `phase` (such as `"runtime"`, `"render-page"`, `"api-handler"`), `error`, and `meta` |
| `afterNitroBuild(payload, context)` | After the Nitro production build, with `{ root, preset, distDir, outputDir }`                                                  |

## Deprecated hooks

Older flat hooks still run, but use the structured form in new code. Don't define both forms of
the same phase in one plugin: Farm runs both.

| Deprecated                                                      | Use instead                      |
| --------------------------------------------------------------- | -------------------------------- |
| `init`                                                          | `setup`                          |
| `config`                                                        | `configure`                      |
| `ready`                                                         | `runtime.start`                  |
| `shutdown`                                                      | `runtime.close`                  |
| `beforeRequest`, `beforeApiHandler`                             | `runtime.before`                 |
| `afterResponse`, `afterApiHandler`                              | `runtime.after`                  |
| `routeDiscovered`, `middlewareDiscovered`, `apiRouteDiscovered` | `router.discovered`              |
| `routesGenerated`                                               | `router.generated`               |
| `beforeRouteMatch`                                              | `router.before`                  |
| `afterRouteMatch`                                               | `router.after`                   |
| `beforeRender`                                                  | `render.before`                  |
| `afterRender`, `transformHTML`                                  | `render.html`                    |
| `transformPage`                                                 | `render.before` or `render.html` |
| `buildStart`, `beforeBundle`                                    | `build.before`                   |
| `buildEnd`, `afterBundle`                                       | `build.after`                    |
| `beforeNitroBuild`                                              | `build.configure`                |
| `devServerCreated`                                              | `dev.server`                     |
| `hmrUpdate`                                                     | `dev.update`                     |
| `context.requestContext`                                        | `req` in request hooks           |

## Testing a plugin

- Check `state` and `ctx` types with a type test.
- Test `pre`, normal, and `post` order against the plugins it runs with.
- Test a `runtime.before` early answer and confirm `runtime.after` still runs.
- Test context-key collisions and `runtime.error`.
- Test `render.html` on pages separately from API responses.
- Run the plugin against both `farm dev` and a production build.
