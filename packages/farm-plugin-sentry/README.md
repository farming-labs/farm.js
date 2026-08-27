# @farm.js/plugin-sentry

Sentry error reporting and tracing for Farm.js applications. It maps Farm's request, render and
build lifecycles onto Sentry, so errors arrive with route context and requests are traced.

Farm.js is currently in beta.

## Install

```bash
pnpm add @farm.js/plugin-sentry @sentry/node
```

`@sentry/node` is an optional peer dependency. If a `dsn` is configured and it is not installed,
the plugin fails with a clear error rather than quietly reporting nothing.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { sentryPlugin } from "@farm.js/plugin-sentry";

export default defineConfig({
  plugins: [
    sentryPlugin({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      sourceMaps: true,
    }),
  ],
});
```

## Initialize early

The Node SDK patches other modules as they load, so it has to run before the rest of the
application. Add an instrumentation file for that:

```ts
// src/instrumentation.ts
import { registerSentry } from "@farm.js/plugin-sentry";

export const register = registerSentry({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

Without this the plugin still reports errors, but the SDK's automatic database and HTTP
instrumentation will not attach.

## What it does

| Hook              | Behavior                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| `runtime.start`   | initializes the SDK if nothing has already, and listens for error events |
| `runtime.context` | names the request span by route pattern                                  |
| `runtime.after`   | sets the span status from the response                                   |
| `runtime.error`   | captures the exception with route, kind and request context              |
| `runtime.close`   | flushes pending events on shutdown                                       |
| `build.configure` | enables source maps when `sourceMaps` is set                             |

Spans are named by route pattern rather than pathname, so `/users/[id]` stays one span name
instead of one per user.

Where the SDK's own HTTP instrumentation has already opened a span for the request, the plugin
renames that one rather than starting another, so automatic HTTP and database spans stay nested
under the request. It only creates a span when nothing is active.

## Serverless

Hosts that can terminate a process without a shutdown signal never run `runtime.close`, so
pending events are lost. Flush inside the request instead:

```ts
sentryPlugin({
  dsn: process.env.SENTRY_DSN,
  flushOnResponse: true,
});
```

The flush is handed to `waitUntil`, so the host keeps the invocation alive until it completes.

## Options

| Option             | Default              | Description                                                                    |
| ------------------ | -------------------- | ------------------------------------------------------------------------------ |
| `dsn`              |                      | Sentry project DSN.                                                            |
| `environment`      | instrumentation mode | Environment name.                                                              |
| `release`          |                      | Release identifier for the deploy.                                             |
| `tracesSampleRate` |                      | Fraction of requests traced. Errors are always sent.                           |
| `sendDefaultPii`   | `false`              | Include request headers and user data.                                         |
| `enabled`          | `true`               | Set false to register the hooks but report nothing.                            |
| `sdk`              | `@sentry/node`       | An SDK module to use instead of importing it.                                  |
| `flushOnResponse`  | `false`              | Flush after every response and after a failed request.                         |
| `flushTimeoutMs`   | `2000`               | Flush timeout.                                                                 |
| `sourceMaps`       | `false`              | Generate source maps in the production build. Does not upload them, see below. |

`sendDefaultPii` stays off by default because error events can carry request headers and user
data.

## Source maps

`sourceMaps: true` only generates source maps during the production build. It does not upload
them to Sentry, so production stack traces stay minified until the maps are uploaded separately,
for example with `sentry-cli`. Uploading from the build is not implemented yet.

Farm only uses its fast esbuild minifier while source maps are off, so enabling them moves
minification to Nitro's terser:

```bash
pnpm add -D @rollup/plugin-terser
```

Without it the production build fails with `Cannot find module '@rollup/plugin-terser'`.

## Runtime support

Node presets. `@sentry/node` does not run on Cloudflare Workers, which need `@sentry/cloudflare`
instead, so `registerSentry` is a no-op on `edge` and `bun` runtimes. Edge support is tracked
separately.

## Bring your own SDK

`sdk` accepts anything matching the small structural interface the plugin uses, which is also
how the package is unit tested:

```ts
import * as Sentry from "@sentry/node";

sentryPlugin({ sdk: Sentry });
```
