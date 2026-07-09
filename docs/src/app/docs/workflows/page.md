---
title: "Cron and Workflows"
description: "Define lightweight scheduled and manually-triggered server workflows that build across Nitro targets, Vercel Cron Jobs, and URL-based schedulers."
section: "Runtime"
---

# Cron and Workflows

Farm workflows are small server functions that live with the app and can be triggered by a schedule or by a URL.

Use them for lightweight backend work:

- refresh a CMS cache
- delete expired sessions
- sync a billing catalog
- send a daily summary
- warm app data after deploy

For long-running durable jobs, queues, replay, and provider dashboards, use the [Jobs Integration](/docs/integrations/jobs) with Trigger.dev or Inngest. Core workflows are intentionally smaller: code-first functions, Nitro task output, and a portable HTTP runner route.

## Define a Cron

Create a workflow module in `src/jobs`, `src/workflows`, or `src/cron`.

```ts title="src/jobs/daily-cleanup.ts"
import { defineCron } from "@farmjs/core/workflows";

export default defineCron({
  id: "daily-cleanup",
  schedule: "0 2 * * *",
  description: "Delete expired sessions every night.",

  async run(ctx) {
    ctx.log.info("cleanup started", ctx.scheduledTime);

    return {
      deleted: 12,
    };
  },
});
```

Farm discovers the file, creates a Nitro task, and exposes a runner URL:

```txt
/api/_farm/workflows/daily-cleanup
```

## Manual Workflows

Use `defineWorkflow` or `defineTask` for work that should be triggered manually.

```ts title="src/workflows/sync-cms.ts"
import { defineWorkflow } from "@farmjs/core/workflows";

export default defineWorkflow({
  id: "sync-cms",
  description: "Pull latest CMS entries into the app cache.",

  async run(ctx) {
    const { collection = "pages" } = ctx.payload as {
      collection?: string;
    };

    return {
      collection,
      syncedAt: new Date().toISOString(),
    };
  },
});
```

Trigger it from an internal scheduler, CI job, dashboard, or provider webhook:

```bash
curl -X POST https://app.example.com/api/_farm/workflows/sync-cms \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"collection":"posts"}'
```

## Configuration

The default config is enough for most apps.

```ts title="farm.config.ts"
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  workflows: true,
});
```

Customize the scanned directory, route, or secret env when needed.

```ts title="farm.config.ts"
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  workflows: {
    dir: "src/background",
    route: "/api/internal/workflows",
    secretEnv: "CRON_SECRET",
  },
});
```

| Option | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Enables file discovery. |
| `dir` / `dirs` | `src/jobs`, `src/workflows`, `src/cron` | Directories to scan. |
| `route` | `/api/_farm/workflows` | URL prefix for manual and URL-based cron invocation. |
| `secretEnv` | `CRON_SECRET` | Env var used to protect the runner route. |
| `secret` | none | Inline secret for local-only testing. Prefer `secretEnv` in deployed apps. |

## Cloud Support

Farm builds workflows through Nitro tasks and an HTTP runner route.

| Platform family | How it runs |
| --- | --- |
| Vercel | Farm writes Vercel `crons` into Build Output API config and Vercel calls the workflow URL. Set `CRON_SECRET` in the project env to protect the route. |
| Cloudflare Workers / Pages | Farm emits Nitro `scheduledTasks`, and the Cloudflare Nitro preset can wire them to Cron Triggers. The generated HTTP route also works from another scheduler. |
| Node, Bun, Deno, self-hosted servers | Nitro can run schedules inside the server process when the process stays alive. For more predictable production operations, call the HTTP route from system cron, Kubernetes CronJob, GitHub Actions, or a hosted scheduler. |
| Netlify | Call the Farm workflow route from a Netlify Scheduled Function or another scheduler. |
| AWS | Call the route from EventBridge Scheduler, EventBridge Rules, Lambda, or API Gateway. |
| Azure | Call the route from Azure Functions Timer Trigger, Logic Apps, or Container Apps Jobs. |
| Google Cloud | Call the route from Cloud Scheduler, Cloud Run Jobs, or Cloud Tasks. |
| Railway, Render, Fly.io, DigitalOcean, Kubernetes | Call the generated HTTP route from the provider's cron/job primitive. |
| Custom Nitro presets | Farm still emits Nitro tasks and the workflow runner route. Use the provider scheduler that matches the preset. |

This is the portability layer: native task hooks where the runtime supports them, and a stable HTTPS endpoint everywhere else.

The workflow manifest is also written during build so deploy adapters and custom automation can inspect the generated targets:

```json title=".farm/.nitro/farm-workflows/manifest.json"
{
  "route": "/api/_farm/workflows",
  "secretEnv": "CRON_SECRET",
  "trigger": {
    "method": "GET",
    "authorization": "Bearer $CRON_SECRET"
  },
  "workflows": [
    {
      "id": "daily-cleanup",
      "schedule": ["0 2 * * *"],
      "path": "/api/_farm/workflows/daily-cleanup"
    }
  ]
}
```

## Security

Set `CRON_SECRET` in production. The workflow runner accepts:

```txt
Authorization: Bearer <secret>
x-farm-workflow-secret: <secret>
```

Query-string secrets are accepted for simple local checks, but headers are preferred for deployed apps.

```bash
curl https://app.example.com/api/_farm/workflows/daily-cleanup \
  -H "authorization: Bearer $CRON_SECRET"
```

Schedulers that can only call a URL can use `?secret=<secret>`. Farm accepts that for portability, but removes it from `ctx.payload` before your workflow runs.

If no secret is configured, the route is public. That is useful for local development, but not recommended for production workflows that mutate data.

## Local Development

Run the app:

```bash
farm dev
```

List discovered workflows:

```bash
curl http://localhost:3000/api/_farm/workflows
```

Run one workflow:

```bash
curl http://localhost:3000/api/_farm/workflows/daily-cleanup
```

Farm logs the request and the workflow can write to `ctx.log`.

## Build Output

During `farm build`, Farm:

- discovers workflow modules
- writes Nitro task wrappers
- maps schedules to Nitro `scheduledTasks`
- creates the HTTP runner route
- adds Vercel `crons` when building with `deploy.target: "vercel"`

No `vercel.json` or custom route wrapper is needed for Vercel. Other platforms use the same generated route, then wire their own scheduler, cron trigger, timer function, or job runner to call it.

## When to Use Integrations Instead

Use the Jobs Integration when the task needs:

- durable retries after process restarts
- queue concurrency controls
- long-running execution
- provider dashboards
- cancellation/status APIs
- event-driven fan-out

Use core workflows when the task is small, server-local, and easy to retry from the caller.
