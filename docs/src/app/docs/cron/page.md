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
import { defineConfig } from "@farmjs/core";

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

| Option | Required | Purpose |
| --- | --- | --- |
| `schedule` | yes | One portable five-field cron expression, or an array of expressions. |
| `path` | yes | Application pathname for an ordinary GET API route. |
| `description` | no | Human-readable purpose shown by CLI output and the build manifest. |
| `enabled` | no | Set to `false` to keep an entry in config without scheduling it. |

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

The target is a normal route under `src/app/api`. It can use storage, integrations, cache invalidation, and other server APIs just like any other GET handler.

```ts title="src/app/api/maintenance/cleanup/route.ts"
import { cronRoute } from "@farmjs/core/cron";

export const GET = cronRoute(async () => {
  const deleted = await deleteExpiredSessions();

  return Response.json({
    ok: true,
    deleted,
  });
});
```

`cronRoute()` verifies `Authorization: Bearer <CRON_SECRET>` whenever `CRON_SECRET` exists. In production it fails closed when the secret is missing, so a forgotten environment variable does not silently expose a mutating route.

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

The development scheduler uses UTC, prints each next run, and skips a run when its previous local invocation is still active. It stops with the dev server and does not persist state across restarts.

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

| Expression | Runs |
| --- | --- |
| `*/5 * * * *` | Every five minutes. |
| `0 * * * *` | At the start of every hour. |
| `0 2 * * *` | Every day at 02:00 UTC. |
| `30 8 * * 1-5` | Weekdays at 08:30 UTC. |
| `0 0 1 * *` | At midnight UTC on the first day of each month. |

Month and weekday names, six-field expressions, and provider-only extensions are rejected. For portability, an expression cannot constrain both day-of-month and day-of-week. All schedules run in UTC.

## Production Output

`farm build` validates the config, generates adapter tasks, and writes `.farm/cron-manifest.json`.

| Target | Production behavior |
| --- | --- |
| Vercel | Farm writes each configured path and schedule to Build Output API `crons`. Vercel sends an HTTP GET to the route. |
| Cloudflare Worker | With `deploy.preset: "cloudflare-module"`, Farm writes Wrangler Cron Triggers and dispatches the matching route inside the Worker. |
| Cloudflare Pages | Pages output does not install Cron Triggers. Use `cloudflare-module` or call the route from an external scheduler. |
| Node, Bun, Deno | Nitro runs schedules in the long-lived server process and internally calls the route. |
| Other targets | Use the generated manifest to configure the provider's scheduler to call the route with GET and bearer auth. |

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

## Build Manifest

The manifest is the stable handoff for custom deployment adapters and external automation.

```json title=".farm/cron-manifest.json"
{
  "schemaVersion": 1,
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

| Need | Use |
| --- | --- |
| Run one API operation on a UTC schedule | Framework Cron |
| Run short best-effort work after an HTTP response | [`after()`](/docs/after) |
| Durable retries, long-running steps, queues, status, cancellation, or dashboards | [Jobs Integration](/docs/integrations/jobs) |

The older `defineCron()` workflow-module API remains available for compatibility. New applications should use `cron` config plus an ordinary API route so local, deployment, security, and testing behavior share one model.
