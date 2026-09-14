---
title: "Health Plugin"
description: "Expose dependency-aware liveness, readiness, and startup probes for Farm applications and hosting platforms."
section: "Plugin Ecosystem"
---

# Health Plugin

`@farm.js/health` gives a hosting platform three small HTTP probes and adds application dependency
checks to readiness. It is designed for containers, Kubernetes, load balancers, and external uptime
monitors that need to decide whether a Farm instance should receive traffic.

Farm core already exposes process-level liveness and readiness at `/_farm/health/live` and
`/_farm/health/ready`. Use those built-in endpoints when process startup and graceful shutdown are
the only signals you need. Add this plugin when readiness also depends on resources such as a
database, cache, queue, or required startup work.

## Install

```bash
pnpm add @farm.js/health
```

## Add health checks

Register `health()` in `farm.config.ts`. A function is a required check. Use the object form to make
a check optional or give it a shorter timeout.

```ts
import { defineConfig } from "@farm.js/core";
import { health } from "@farm.js/health";
import { database, redis } from "./src/server/services";

export default defineConfig({
  plugins: [
    health({
      checks: {
        database: () => database.execute("select 1"),
        cache: {
          check: () => redis.ping(),
          required: false,
          timeout: "500ms",
        },
      },
    }),
  ],
});
```

The plugin serves these paths by default:

| Endpoint              | Meaning                                                                                | Failure behavior                      |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| `GET /health/live`    | The Farm runtime can answer HTTP requests. It does not call external dependencies.     | `503` during shutdown or after close. |
| `GET /health/ready`   | Required startup work and all current required dependency checks pass.                 | `503` removes the instance from use.  |
| `GET /health/startup` | Required startup checks have passed at least once during the current process lifetime. | `503` while startup is incomplete.    |

`HEAD` has the same status and headers without a body. Other methods return `405` with
`Allow: GET, HEAD`. Every response uses `Cache-Control: no-store` so a proxy cannot reuse a stale
health result.

The plugin does not poll itself. Your hosting platform or monitor sends requests to these URLs and
decides what to do with the status code.

Health uses exact, route-scoped runtime endpoints. Ordinary pages, APIs, actions, and assets do not
run the checks, and installing the plugin does not make otherwise static pages dynamic.

## Check behavior

Checks run concurrently and get their own timeout. Returning `false`, throwing, or exceeding the
timeout marks a check unavailable. Any other fulfilled result passes, so provider methods such as
`ping()` can be returned directly.

- A required failure makes the whole probe `unavailable` and returns `503`.
- An optional failure makes the probe `degraded` and still returns `200`.
- An `ok` probe returns `200`.

Checks receive an abort signal. Pass it to SDKs that support cancellation so timed-out work does not
continue in the background:

```ts
health({
  timeout: "1s",
  checks: {
    catalog: ({ signal }) =>
      fetch("https://catalog.internal/status", {
        signal,
        headers: { accept: "application/json" },
      }).then((response) => response.ok),
  },
});
```

Keep readiness checks cheap and shallow. Check the dependency needed to serve requests, not every
service reachable from it. Never put a database or provider check in liveness because a shared
dependency outage should stop traffic, not restart every healthy application process.

## Startup checks

Use `startupChecks` for work that must finish once before an instance receives traffic, such as
confirming migrations or loading a required local model.

```ts
health({
  startupChecks: {
    migrations: () => migrationState.isCurrent(),
    searchModel: ({ signal }) => searchModel.waitUntilLoaded({ signal }),
  },
  checks: {
    database: () => database.execute("select 1"),
  },
});
```

Farm retries failed startup checks when `/health/startup` or `/health/ready` is requested. Once all
required startup checks pass, that result is latched for the lifetime of the runtime. Readiness then
runs only the checks in `checks` on each request.

## Configure the hosting platform

Installing the plugin does not change deployment traffic by itself. Configure the platform to call
the endpoints. A Kubernetes container can use:

```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: 3000
  periodSeconds: 2
  failureThreshold: 30

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  periodSeconds: 5
  failureThreshold: 2

livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  periodSeconds: 10
  failureThreshold: 3
```

Set the platform's probe timeout above the longest configured check timeout. The values above are a
starting point, not universal production defaults. Tune periods and thresholds to the application's
startup time and recovery behavior.

When a platform accepts only one health URL, use `/health/ready`. It answers the most important
traffic question: can this instance serve a real request now? A Docker image can use the same URL in
its `HEALTHCHECK`, and an external monitor can use it for availability alerts.

Request-driven serverless and edge platforms generally create and remove isolated invocations
themselves rather than polling a long-lived process. The endpoints can still support external
monitoring, but they do not control provider routing unless that provider explicitly supports an
HTTP health setting.

## Response details and security

Responses expose only the overall status by default:

```json
{ "status": "unavailable" }
```

Set `details: true` to include check names, status, whether they are required, probe type, and
duration. Raw errors, messages, connection strings, provider responses, and stack traces are never
included.

```json
{
  "status": "degraded",
  "checks": {
    "database": {
      "status": "ok",
      "required": true,
      "probe": "readiness",
      "durationMs": 4
    },
    "cache": {
      "status": "unavailable",
      "required": false,
      "probe": "readiness",
      "durationMs": 501
    }
  }
}
```

Check names can still reveal infrastructure. Keep details disabled on a public endpoint, or use a
request predicate to disclose them only to an authenticated monitor:

```ts
health({
  details(request) {
    const token = process.env.HEALTH_DETAILS_TOKEN;
    return Boolean(token) && request.headers.get("authorization") === `Bearer ${token}`;
  },
  checks: {
    database: () => database.execute("select 1"),
  },
});
```

The predicate controls response detail, not access to the probe or its status code.

## Paths and base paths

Customize the application-relative paths when a platform expects a particular convention:

```ts
health({
  paths: {
    liveness: "/status/live",
    readiness: "/status/ready",
    startup: "/status/startup",
  },
});
```

Farm automatically prefixes the configured `basePath`. With `basePath: "/store"`, the default
readiness URL is `/store/health/ready`. Configure the hosting platform with the final public path.

Health paths must be distinct safe absolute paths. They are reserved by the plugin's runtime
endpoints, so do not create application pages or API routes at the same locations. The plugin
rejects a collision with core's `server.health` paths because core owns those handlers before plugin
endpoints run.

## Options

| Option          | Default                                            | Purpose                                                       |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `checks`        | `{}`                                               | Named checks evaluated for every readiness request.           |
| `startupChecks` | `{}`                                               | Named checks retried until required startup work passes once. |
| `timeout`       | `"1s"`                                             | Default timeout for each check.                               |
| `details`       | `false`                                            | Safe response details or a request predicate that enables it. |
| `paths`         | `/health/live`, `/health/ready`, `/health/startup` | Application-relative endpoint paths.                          |

Numbers passed as timeouts are milliseconds. Duration strings support `ms`, `s`, `m`, and `h`.
