---
title: "Cron"
description: "Map portable UTC schedules to ordinary Farm API routes, run them locally, and compile them to deployment-native cron triggers."
section: "Runtime"
---

# Cron

Farm Cron maps a schedule to an ordinary GET API route. The route owns the application logic; Farm owns validation, local tooling, deployment metadata, and scheduler adapters.

```txt
UTC schedule -> named cron entry -> GET API route -> application code
```

Use Cron for periodic work such as deleting expired sessions, refreshing cached data, reconciling billing state, or sending a daily digest.

Cron is intentionally not a workflow engine. It does not add durable steps, persistence, retries, execution history, queues, or distributed locks. Use the [Jobs Integration](/docs/integrations/jobs) when the work needs those guarantees.

## Configure a Schedule

Add named entries under `cron` in `farm.config.ts`.

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  cron: {
    dailyCleanup: {
      schedule: "0 2 * * *",
      path: "/api/maintenance/cleanup",
      description: "Delete expired sessions every night.",
    },
  },
});
```

Each entry has one job:

| Option        | Required | Purpose                                                              |
| ------------- | -------- | -------------------------------------------------------------------- |
| `schedule`    | yes      | One portable five-field cron expression, or an array of expressions. |
| `path`        | yes      | Application pathname for an ordinary GET API route.                  |
| `description` | no       | Human-readable purpose shown by CLI output and the build manifest.   |
| `enabled`     | no       | Set to `false` to keep an entry in config without scheduling it.     |

`path` must be a root-relative application pathname. Farm rejects hosts, query strings, hashes,
dot segments, backslashes, control characters, and encoded path separators so local invocations
and deployment schedulers call the same route.

Use an array when the same route should run at more than one time:

```ts
cron: {
  reconcileBilling: {
    schedule: ["0 0 * * *", "0 12 * * *"],
    path: "/api/billing/reconcile",
  },
}
```

## Implement the Route

The target is a normal route under `src/app/api`. It can use KV storage, application databases, integrations, cache invalidation, and other server APIs just like any other GET handler.

```ts title="src/app/api/maintenance/cleanup/route.ts"
import { cronRoute } from "@farm.js/core/cron";

export const GET = cronRoute(async () => {
  const deleted = await deleteExpiredSessions();

  return Response.json({
    ok: true,
    deleted,
  });
});
```

`cronRoute()` also wraps an endpoint made with [`createEndpoint`](/docs/api-routes). The endpoint
keeps its validation, its typed client, and its OpenAPI and MCP metadata; only the scheduler can
call it:

```ts title="src/app/api/maintenance/cleanup/route.ts"
import { createEndpoint } from "@farm.js/core/api";
import { cronRoute } from "@farm.js/core/cron";
import { z } from "zod";

export const GET = cronRoute(
  createEndpoint(
    { query: z.object({ olderThanDays: z.coerce.number().int().positive().default(30) }) },
    async ({ query }) =>
      Response.json({ deleted: await deleteSessionsOlderThan(query.olderThanDays) }),
  ),
);
```

To schedule a route you already have, import its export into a cron-only route:

```ts title="src/app/api/cron/cleanup/route.ts"
import { cronRoute } from "@farm.js/core/cron";
import { GET as cleanup } from "../../maintenance/cleanup/route";

export const GET = cronRoute(cleanup);
```

`cronRoute()` returns a guarded copy and leaves the original alone, so `/api/maintenance/cleanup`
still answers without the secret. When only the scheduler may call a route, wrap it where it is
defined instead.

The secret is checked where endpoint middleware runs: after the input is validated, before any
middleware or the handler. Invalid input answers `400` first; valid input without the secret answers
`401`. In both cases the handler does not run.

## Schedule in the Route

`cronRoute()` can carry the schedule beside the code. A route whose options set `schedule` is a
cron job, equivalent to a `cron` config entry; config entries and route options merge into one job
list for `farm cron list`, `farm dev --cron`, the build manifest, and deployment output. The same
job name in both places fails the build.

```ts title="src/app/api/maintenance/cleanup/route.ts"
import { createEndpoint } from "@farm.js/core/api";
import { cronRoute } from "@farm.js/core/cron";

export const GET = cronRoute(
  createEndpoint(async ({ context }) =>
    Response.json({ deleted: await deleteSessionsOlderThan(context.cron.input.olderThanDays) }),
  ),
  {
    schedule: "0 2 * * *",
    name: "cleanup",
    description: "Delete expired sessions every night.",
    input: { olderThanDays: 30 },
    timeoutMs: 60_000,
    overlap: "skip",
  },
);
```

| Option        | Purpose                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `schedule`    | One portable five-field UTC cron expression, or an array. Same syntax and validation as config.                                  |
| `name`        | Job name. Defaults to the route path without the leading `/api/`, here `maintenance/cleanup`.                                    |
| `description` | Human-readable purpose shown by CLI output and the build manifest.                                                               |
| `input`       | JSON literal handed to the handler as `context.cron.input`.                                                                      |
| `timeoutMs`   | Aborts `context.cron.signal` and answers `504` when the handler runs longer. A handler that finishes first keeps its own result. |
| `overlap`     | `"skip"` answers `409 { "skipped": true }` while a run of the same job is still going, without running the handler.              |
| `enabled`     | `false` keeps the route callable with the same auth but removes it from scheduling outputs.                                      |

`secretEnv`, `secret`, and `allowUnsecured` keep working next to these. `path` is never an option:
it is the route file's own location.

The build reads `schedule`, `name`, `description`, `input`, `timeoutMs`, and `enabled` statically
from the source, without running the module. Write them as literals in the call; a computed value
fails the build and names the file. A scheduled route cannot sit under a dynamic segment such as
`[id]`, because a scheduler cannot fill route params.

In the endpoint form the handler reads `context.cron`:

| Field         | Value                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| `name`        | From the `x-farm-cron-name` header. A direct platform call sends none, so it is optional. |
| `scheduledAt` | A `Date` from the `x-farm-cron-scheduled-at` header (a millisecond epoch); also optional. |
| `input`       | The literal `input` from the options; `undefined` when unset.                             |
| `signal`      | An `AbortSignal` that aborts when the handler outlives `timeoutMs`.                       |

A plain `(request) => ...` handler gets no `context.cron`; it reads the same headers from the
`Request` itself. `timeoutMs` and `overlap` guard both forms.

`overlap: "skip"` is per-process in v1. Replicas and serverless instances do not share the
in-flight set, so it is not a distributed lock; the [reliability model](#reliability-model) still
applies.

`cronRoute()` verifies `Authorization: Bearer <CRON_SECRET>` whenever `CRON_SECRET` exists.
The standard authentication scheme is case-insensitive, so schedulers may send either `Bearer` or
`bearer`. Outside development and test it fails closed when the secret is missing, so a forgotten
environment variable does not silently expose a mutating route.

Set the same value in the application and scheduler environment:

```bash
CRON_SECRET="use-a-long-random-value"
```

Vercel automatically sends its project `CRON_SECRET` as a bearer token. Farm's Cloudflare and in-process adapters read the same variable and forward it to the API route. External schedulers should add the header themselves.

## Run It Locally

List the resolved config:

```bash
farm cron list
```

```txt
NAME          SCHEDULE (UTC)  ROUTE                     DESCRIPTION
dailyCleanup  0 2 * * *       /api/maintenance/cleanup  Delete expired sessions every night.
```

Start the app, then invoke one entry immediately:

```bash
farm dev
farm cron run dailyCleanup
```

`farm cron run` defaults to `http://localhost:3000`, reads `CRON_SECRET`, and returns the route response. Point it at another running app when needed:

```bash
farm cron run dailyCleanup --url http://localhost:4319
farm cron run dailyCleanup --url https://preview.example.com
```

Use the opt-in development scheduler to run every configured expression in memory:

```bash
farm dev --cron
```

The development scheduler uses UTC, prints each next run, and skips a run when any previous local invocation of the same named job is still active, including one started by another expression in its schedule array. It stops its timers and aborts active requests with the dev server, and it does not persist state across restarts.

## Schedule Syntax

Farm accepts the portable numeric five-field subset shared by its first-class deployment adapters.

```txt
┌──────── minute (0-59)
│ ┌────── hour (0-23)
│ │ ┌──── day of month (1-31)
│ │ │ ┌── month (1-12)
│ │ │ │ ┌ day of week (0-6, Sunday is 0)
│ │ │ │ │
* * * * *
```

Examples:

| Expression     | Runs                                            |
| -------------- | ----------------------------------------------- |
| `*/5 * * * *`  | Every five minutes.                             |
| `0 * * * *`    | At the start of every hour.                     |
| `0 2 * * *`    | Every day at 02:00 UTC.                         |
| `30 8 * * 1-5` | Weekdays at 08:30 UTC.                          |
| `0 0 1 * *`    | At midnight UTC on the first day of each month. |

Month and weekday names, six-field expressions, and provider-only extensions are rejected. For portability, an expression cannot constrain both day-of-month and day-of-week. All schedules run in UTC.

## Production Output

`farm build` validates the config, generates adapter tasks, and writes `.farm/cron-manifest.json`.

| Target            | Production behavior                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel            | Farm writes each configured path and schedule to Build Output API `crons`. Vercel sends an HTTP GET to the route.                         |
| Cloudflare Worker | With `deploy.preset: "cloudflare-module"`, Farm writes Wrangler Cron Triggers and dispatches the matching route inside the Worker.        |
| Cloudflare Pages  | Pages output does not install Cron Triggers. Use `cloudflare-module` or call the route from an external scheduler.                        |
| Node, Bun, Deno   | Nitro runs schedules in the long-lived server process and internally calls the route.                                                     |
| Other targets     | Use the generated manifest to configure the provider's scheduler to call the route with GET and bearer auth.                              |
| Any, connected    | With `FARMJS_API_KEY` at build time, [Farm.js Infra schedules the jobs](#run-by-farmjs-infra) and the host outputs above are not written. |

Cloudflare Cron Triggers require Worker output:

```ts title="farm.config.ts"
export default defineConfig({
  deploy: {
    preset: "cloudflare-module",
  },
  cron: {
    dailyCleanup: {
      schedule: "0 2 * * *",
      path: "/api/maintenance/cleanup",
    },
  },
});
```

Build and deploy the generated Worker config with Wrangler:

```bash
npx wrangler secret put CRON_SECRET
farm build
npx wrangler deploy --config .farm/.output/server/wrangler.json
```

For a self-hosted app with more than one replica, do not run an in-process scheduler in every replica. Run one dedicated scheduler instance, or configure system cron, a Kubernetes CronJob, or another external scheduler to call the HTTP route.

## Choose the scheduler

Select who runs the schedules in `farm.config.ts`. The default is the deployment host:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: { target: "vercel" },
  cron: { infra: "farmjs" }, // Use "host" for the deployment target's scheduler.
});
```

Schedules declared with `cronRoute()` are discovered automatically. To keep schedules in config,
put them under `jobs` when using `infra`:

```ts
cron: {
  infra: "farmjs",
  jobs: {
    dailyCleanup: {
      schedule: "0 2 * * *",
      path: "/api/maintenance/cleanup",
    },
  },
},
```

The existing flat `cron: { dailyCleanup: { schedule, path } }` form remains supported.
`cron: false` disables config and route-local schedules. Only `cron.infra` selects the scheduler:
a `FARMJS_API_KEY` in the environment never switches an app to Infra.

### Run by Farm.js Infra

`farm build` writes `.farm/cron-manifest.json`. With `infra: "farmjs"`, it emits no Farm cron
entries for the host scheduler. Builds do not contact Infra or need an API key.

Deploy the application, then synchronize the manifest from that exact build:

```bash
# Set these in your deployment environment; keep the real key out of source control.
export FARMJS_API_KEY="<server key with cron:jobs permission>"
export FARMJS_ENVIRONMENT="production"
export FARMJS_PROJECT_ID="<project id>"

# Review the endpoint, scope, and job list. No network request is made.
farm cron sync --url https://app.example.com

# Run only after that build is deployed.
farm cron sync --url https://app.example.com --apply
```

`--url` is the app's public HTTPS origin. It is explicit so preview builds cannot accidentally
select the production hostname. Set `FARMJS_ENVIRONMENT` explicitly to the corresponding Infra
environment (`production`, `staging`, or `development`). Use a separate endpoint with `staging`
for preview deployments. Project-scoped keys supply their project; otherwise set `FARMJS_PROJECT_ID`.
`FARMJS_API_URL` overrides the Infra service origin (default `https://app.farmjs.dev`).

Use `--manifest path/to/cron-manifest.json` for custom build directories or downloaded artifacts,
and `--json` for a versioned plan or result. The command reads the manifest, without loading
`farm.config.ts` or rescanning routes. Registration failures, redirects, timeouts, and incomplete
acknowledgements fail the command. Retry the same manifest after resolving the error.

Infra sends signed GET requests to the application's routes. Set the same `FARMJS_API_KEY` in
the deployed server environment; `cronRoute()` verifies `farmjs-signature`. `CRON_SECRET` remains
supported for manual or host calls. Infra's per-request `timeoutMs` is 1000–60000 milliseconds;
route-local `input` stays in the handler and is not sent during registration.

### Remove or move schedules

Sync replaces all jobs for the endpoint within the selected environment/project. Removing a job
from the next deployed manifest removes it from Infra on the next sync. An empty manifest or a
manifest built with `infra: "host"` clears the endpoint's Infra jobs:

```bash
farm cron sync --url https://app.example.com
farm cron sync --url https://app.example.com --apply --allow-delete
```

Keep the old endpoint, environment, project, and credential available until cleanup completes.
If the hostname changes, clear the old endpoint separately. Switching schedulers is not atomic:
disable the previous host schedule before enabling Infra, or clear Infra before enabling the new
host schedule. Already running requests may finish. `farm dev --cron`, `farm cron list`, and
`farm cron run` remain local tooling and never register schedules with Infra.

## Build Manifest

The manifest is the stable handoff for custom deployment adapters and external automation.

```json title=".farm/cron-manifest.json"
{
  "schemaVersion": 1,
  "scheduler": "host",
  "secretEnv": "CRON_SECRET",
  "jobs": [
    {
      "name": "dailyCleanup",
      "schedule": ["0 2 * * *"],
      "path": "/api/maintenance/cleanup",
      "description": "Delete expired sessions every night."
    }
  ]
}
```

An external scheduler should make a GET request to `path` and send:

```txt
Authorization: Bearer <CRON_SECRET>
```

## Reliability Model

Treat cron delivery as at least once. A platform can deliver the same schedule more than once, and a new invocation can overlap a slow previous invocation.

Make handlers safe to repeat:

- set or reconcile state instead of blindly incrementing it
- use a database uniqueness key for one logical run
- take a distributed lock when concurrent execution would be harmful
- return a non-2xx response when the work fails so platform logs are useful
- keep work within the deployment provider's request duration limit

Farm's local `--cron` runner prevents overlap inside one development process. That protection is not a distributed production lock.

## Cron, Jobs, and Post-response Work

| Need                                                                             | Use                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------- |
| Run one API operation on a UTC schedule                                          | Framework Cron                              |
| Run short best-effort work after an HTTP response                                | [`after()`](/docs/after)                    |
| Durable retries, long-running steps, queues, status, cancellation, or dashboards | [Jobs Integration](/docs/integrations/jobs) |

The older `defineCron()` workflow-module API remains available for compatibility. Its HTTP trigger
parses `application/json` and `application/*+json` bodies as JSON, wraps other non-empty bodies as
`{ text }`, and rejects malformed JSON consistently in development and production. New applications
should use `cron` config plus an ordinary API route so local, deployment, security, and testing
behavior share one model. Its generated production route also fails closed when no workflow secret
is configured or available; legacy applications that intentionally expose the route may set
`workflows.allowUnsecured: true`. On Vercel, scheduled workflow modules run only through that
route: Farm writes one Build Output API cron per schedule pointing at it and does not mount Nitro's
`/_vercel/cron` handler. Existing workflow-module applications may configure
`workflows.dir` or `workflows.dirs` with project-relative or absolute directories; absolute
directories remain rooted outside the project instead of being remounted below it. Production
preparation replaces the generated workflow wrappers on each run, so removed modules or disabling
`workflows` cannot leave an executable stale task behind.
