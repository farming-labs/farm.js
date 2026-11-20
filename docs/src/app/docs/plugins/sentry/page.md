---
title: "Sentry"
description: "Report Farm server errors with route context, trace requests, and flush pending Sentry events safely."
section: "Plugin Ecosystem"
---

# Sentry

`@farm.js/sentry` connects Farm's request, render, build, and shutdown lifecycle to Sentry. It reports server errors with Farm event and route context, names request spans by route pattern, and safely flushes pending events without letting monitoring failures stop the application.

## Install

Install the Farm plugin and the Sentry Node SDK:

```bash
pnpm add @farm.js/sentry @sentry/node
```

`@farm.js/sentry` provides the Farm lifecycle integration. `@sentry/node` collects and sends the events. The SDK is an optional peer dependency so applications can control its version or supply a compatible SDK explicitly.

## Configure

Add the Sentry project DSN to the application environment:

```bash
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
```

Register the plugin in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";
import { sentryPlugin } from "@farm.js/sentry";

export default defineConfig({
  plugins: [
    sentryPlugin({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    }),
  ],
});
```

The DSN is the only credential needed to report runtime events. A Sentry auth token is only needed for a separate source-map upload workflow.

## Initialize before application modules

The Node SDK instruments modules as they load. Initialize it from `src/instrumentation.ts` so HTTP and database instrumentation attaches before the rest of the application starts:

```ts
import { registerSentry } from "@farm.js/sentry";

export const register = registerSentry({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

The plugin still captures Farm errors without this file, but automatic HTTP and database instrumentation will not attach.

## What it captures

| Farm lifecycle            | Sentry behavior                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime start             | Resolves and initializes the SDK once.                                                                                               |
| Request context           | Names the request span by route pattern, such as `GET /users/[id]`.                                                                  |
| Response                  | Records the response status and finishes plugin-owned spans.                                                                         |
| Runtime and render errors | Captures the exception with the Farm event, request kind, and route context.                                                         |
| Browser errors            | Captures window errors, unhandled rejections, and hydration failures with the Farm phase and page context, when `browserDsn` is set. |
| Runtime shutdown          | Flushes pending events without allowing a flush failure to stop shutdown.                                                            |
| Production build          | Generates source maps when `sourceMaps` is enabled.                                                                                  |

When the Sentry SDK already created an HTTP span, Farm renames that span instead of creating a competing request span. Automatic HTTP and database spans therefore remain correctly nested.

## Serverless deployments

Some serverless hosts terminate an invocation without running the normal shutdown lifecycle. Enable response flushing on those deployments:

```ts
sentryPlugin({
  dsn: process.env.SENTRY_DSN,
  flushOnResponse: true,
});
```

Farm hands the flush promise to `waitUntil`, allowing supported hosts to keep the invocation alive long enough to deliver pending events. Rejected flushes are logged and do not replace the application response or original error.

## Pass an existing SDK

Applications can pass the Sentry SDK module instead of letting the plugin import it:

```ts
import * as Sentry from "@sentry/node";
import { sentryPlugin } from "@farm.js/sentry";

sentryPlugin({
  sdk: Sentry,
  dsn: process.env.SENTRY_DSN,
});
```

The `sdk` option accepts the module's structural API, not a separately constructed client. If the application already initialized Sentry, the plugin detects the active client and does not initialize it again.

## Options

| Option             | Default              | Description                                                                   |
| ------------------ | -------------------- | ----------------------------------------------------------------------------- |
| `dsn`              |                      | Sentry project DSN.                                                           |
| `browserDsn`       |                      | Browser project DSN, provided explicitly. Never reuse the server DSN.         |
| `environment`      | Instrumentation mode | Environment name.                                                             |
| `release`          |                      | Release identifier for the deployment.                                        |
| `tracesSampleRate` |                      | Fraction of requests traced. Errors are always reported.                      |
| `sendDefaultPii`   | `false`              | Include request headers and user data.                                        |
| `enabled`          | `true`               | Set to `false` to keep the hooks registered without reporting.                |
| `sdk`              | `@sentry/node`       | Compatible SDK module to use instead of importing `@sentry/node`.             |
| `flushOnResponse`  | `false`              | Flush after successful and failed requests for serverless deployments.        |
| `flushTimeoutMs`   | `2000`               | Maximum time allowed for each flush.                                          |
| `sourceMaps`       | `false`              | Generate production source maps. This does not upload them.                   |
| `sentryOptions`    | `{}`                 | Extra `Sentry.init` options such as `beforeSend`, `ignoreErrors`, or `debug`. |

`sendDefaultPii` remains disabled by default because error events can contain request headers and user information.

## Source maps

`sourceMaps: true` generates production source maps but does not upload them to Sentry. Upload the generated maps separately with Sentry's tooling. Enabling source maps moves minification to Nitro's terser, so install its build dependency too:

```bash
pnpm add -D @rollup/plugin-terser
```

## Runtime support

The default SDK integration currently supports Node presets. Cloudflare Workers require `@sentry/cloudflare`, so early `registerSentry` initialization is a no-op for `edge` and `bun` runtimes.

## Browser errors

Window errors, unhandled rejections, and hydration failures reach the client `error` hook, which has no consumer until a browser DSN is configured:

```ts
sentryPlugin({
  dsn: process.env.SENTRY_DSN,
  browserDsn: process.env.PUBLIC_SENTRY_DSN,
});
```

`browserDsn` must be a separate browser DSN, provided explicitly — never reuse the server DSN. A browser DSN is public by design (it ships in the browser bundle); a server DSN is a secret. Only the browser DSN and scalar options cross into the browser bundle. Without `browserDsn` no browser code is registered and `@sentry/browser` stays out of the browser bundle.

Browser errors are tagged with the Farm error phase (`farm.phase`) and the page they happened on, with the route pattern when the error happened during a navigation. Install the browser SDK for this:

```bash
pnpm add @sentry/browser
```

To pass an SDK the application already initialized instead, register the reporter from the app client entry:

```ts
// src/client.ts
import { defineClient } from "@farm.js/core/client";
import { sentryClient } from "@farm.js/sentry/client";
import * as Sentry from "@sentry/browser";

export default defineClient(
  sentryClient({ sdk: Sentry, browserDsn: import.meta.env.PUBLIC_SENTRY_DSN }),
);
```

If a browser DSN is configured but no SDK resolves, Farm logs a clear error and continues without reporting. Monitoring failures must not prevent the application from starting, responding, or shutting down.
