---
title: "Durable Workflows"
description: "Run multi-step work that sleeps, waits for approvals and webhooks, and resumes after a restart, with Workflow SDK on Farm's production server."
section: "Integrations"
---

# Durable Workflows

A durable workflow is a function whose progress is saved after every step. It can sleep for days, wait for an approval or a webhook, and pick up where it stopped after a crash or a redeploy, without running finished steps again.

This page sets up [Workflow SDK](https://workflow-sdk.dev) on Farm. You write workflows as async functions marked with `"use workflow"` and `"use step"`, and start them from API routes.

Workflows run in production builds. `farm dev` records a run but doesn't execute it, so try workflows with `farm build && farm start`. [Limits](#limits) lists the other places they don't run yet.

## When to use one

| Need                                                                                              | Use                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Short best-effort work after a response                                                           | [`after()`](/docs/after)                   |
| Call one API route on a schedule                                                                  | [Cron](/docs/cron)                         |
| Background tasks with retries, status, and cancellation, run by your app, Trigger.dev, or Inngest | [Jobs](/docs/integrations/jobs)            |
| Multi-step work that sleeps, waits for an event or a webhook, and survives restarts               | Durable workflows (this page)              |
| An agent run that pauses for a person's approval                                                  | [Durable agents](/docs/integrations/agent) |

## How it fits together

| Piece               | Where                     | What it does                                                        |
| ------------------- | ------------------------- | ------------------------------------------------------------------- |
| Workflows and steps | `src/workflows/*.ts`      | The durable functions                                               |
| The plugin          | `farm.config.ts`          | Compiles workflow files and adds Workflow SDK's routes to the build |
| The startup hook    | `src/instrumentation.ts`  | Resumes unfinished runs when the server starts                      |
| API routes          | `src/app/api/**/route.ts` | Start runs, read their status, and resume them                      |

Workflow SDK serves its own routes under `/.well-known/workflow/v1/`. Its queue calls them to run each step, and webhooks arrive there.

## Install

```bash
pnpm add workflow
pnpm add -D @workflow/rollup
```

pnpm runs a dependency's build script only when it's allowed. Allow the two that Workflow SDK brings, next to the entries Farm's templates already list:

```yaml title="pnpm-workspace.yaml"
allowBuilds:
  "@swc/core": true
  cbor-extract: true
```

Add the folder where runs are stored to `.gitignore`:

```txt title=".gitignore"
.workflow-data
```

## Configure Farm

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { definePlugin } from "@farm.js/core/plugin";
import { workflowTransformPlugin } from "@workflow/rollup";

const workflowSdk = definePlugin({
  name: "workflow-sdk",
  build: {
    configure(nitroConfig) {
      return {
        ...nitroConfig,
        modules: [...(nitroConfig.modules ?? []), "workflow/nitro"],
        workflow: { dirs: ["src"] },
      };
    },
  },
});

export default defineConfig({
  vite: { plugins: [workflowTransformPlugin()] },
  plugins: [workflowSdk],
});
```

The Vite plugin compiles `"use workflow"` and `"use step"` functions. The plugin's [`build.configure`](/docs/plugins/create-plugin#extend-builds) hook adds Workflow SDK's Nitro module, which generates the workflow routes, and limits its file scan to `src`. Naming the module as a string, instead of importing it, keeps build-only code out of the server bundle.

## Resume runs on startup

**src/instrumentation.ts**

```ts
import type { FarmInstrumentationContext } from "@farm.js/core/instrumentation";

export async function register(context: FarmInstrumentationContext) {
  if (context.runtime !== "nodejs") return;

  const { getWorld } = await import("workflow/runtime");
  const world = await getWorld();
  await world.start?.();
}
```

Without this hook, a run that was sleeping or waiting when the server stopped stays `running` after a restart. If the app already has an [instrumentation file](/docs/observability), add these lines to its `register` function.

## Write a workflow

**src/workflows/welcome.ts**

```ts
import { sleep } from "workflow";

export async function welcome(email: string) {
  "use workflow";

  const user = await createUser(email);
  await sleep("5s");
  await sendWelcomeEmail(user.email);

  return { email: user.email, status: "welcomed" };
}

async function createUser(email: string) {
  "use step";
  return { email };
}

async function sendWelcomeEmail(email: string) {
  "use step";
  console.log(`Sent welcome email to ${email}`);
}
```

The workflow function decides what happens next; each step is a checkpoint. When a step finishes, Workflow SDK saves its result, and a replay after a restart reuses it instead of running the step again. Steps run as ordinary server code, so database calls, SDK calls, and `process.env` belong there. Workflow functions are replayed in a sandbox and must be deterministic.

`sleep()` accepts a duration such as `"5s"` or `"7d"`. A sleeping run uses no compute.

## Start a run and read its status

**src/app/api/signup/route.ts**

```ts
import { start } from "workflow/api";
import { welcome } from "../../../workflows/welcome";

export async function POST(request: Request) {
  const { email } = await request.json();
  const run = await start(welcome, [email]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
```

**src/app/api/runs/route.ts**

```ts
import { getRun } from "workflow/api";
import { WorkflowRunNotFoundError } from "workflow/errors";

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("id");
  if (!runId) return Response.json({ error: "Pass ?id=<runId>." }, { status: 400 });

  const run = getRun(runId);
  try {
    const status = await run.status;
    const result = status === "completed" ? await run.returnValue : undefined;
    return Response.json({ runId, status, result });
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error)) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }
    throw error;
  }
}
```

Build, start, and try it:

```bash
farm build && farm start

curl -X POST http://localhost:3000/api/signup \
  -H "content-type: application/json" -d '{"email":"ada@example.com"}'
# {"runId":"wrun_..."}

curl "http://localhost:3000/api/runs?id=wrun_..."
# {"runId":"wrun_...","status":"completed","result":{"email":"ada@example.com","status":"welcomed"}}
```

A run's status is `pending`, `running`, `completed`, `failed`, or `cancelled`. Stop the server while a run sleeps and start it again: the run finishes after the restart.

## Wait for an event

A hook pauses a run until your app resumes it. Give the hook a token you can rebuild later, such as one derived from an order id.

**src/workflows/refund.ts**

```ts
import { createHook } from "workflow";

export async function refund(orderId: string) {
  "use workflow";

  const approval = createHook<{ approved: boolean }>({ token: `refund:${orderId}` });
  const { approved } = await approval;

  if (!approved) return { orderId, status: "rejected" };
  await issueRefund(orderId);
  return { orderId, status: "refunded" };
}

async function issueRefund(orderId: string) {
  "use step";
  console.log(`Refunded order ${orderId}`);
}
```

**src/app/api/refunds/route.ts**

```ts
import { start } from "workflow/api";
import { refund } from "../../../workflows/refund";

export async function POST(request: Request) {
  const { orderId } = await request.json();
  const run = await start(refund, [orderId]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
```

**src/app/api/refunds/approve/route.ts**

```ts
import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

export async function POST(request: Request) {
  const { orderId, approved } = await request.json();
  // Check that the caller may approve refunds before resuming the run.
  try {
    await resumeHook(`refund:${orderId}`, { approved: approved === true });
  } catch (error) {
    if (HookNotFoundError.is(error)) {
      return Response.json({ error: "No refund is waiting for approval." }, { status: 404 });
    }
    throw error;
  }
  return new Response(null, { status: 204 });
}
```

Anyone who can call the approve route can approve a refund, so check the caller's session there before resuming. `resumeHook` throws `HookNotFoundError` when no run is waiting on the token, for example after the refund was already decided.

## Receive a webhook

A webhook gives one run its own URL. Another service calls it, and the run resumes with that request.

**src/workflows/payment.ts**

```ts
import { createWebhook } from "workflow";

export async function awaitPayment(orderId: string) {
  "use workflow";

  const webhook = createWebhook();
  await sendPaymentLink(orderId, webhook.token);

  const request = await webhook;
  const event = await request.json();
  return { orderId, paid: event.status === "paid" };
}

async function sendPaymentLink(orderId: string, token: string) {
  "use step";
  const callbackUrl = `${process.env.SITE_URL}/.well-known/workflow/v1/webhook/${token}`;
  console.log(`Payment callback for ${orderId}: ${callbackUrl}`);
}
```

**src/app/api/payments/route.ts**

```ts
import { start } from "workflow/api";
import { awaitPayment } from "../../../workflows/payment";

export async function POST(request: Request) {
  const { orderId } = await request.json();
  const run = await start(awaitPayment, [orderId]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
```

The webhook route answers `202` for a token a run is waiting on and `404` for any other token. Off Vercel, `webhook.url` points at `http://localhost:<port>`, so the step builds the public URL from `SITE_URL`, your app's public origin, and the token.

## Where runs are stored

Workflow SDK stores runs and queues steps through a _world_.

- **Node server.** The Local World keeps runs in `.workflow-data` in the directory the server starts from. Keep that folder on a persistent disk, and run one server process per folder. Runs started in `farm dev` also land there, stay `pending`, and run the next time `farm start` boots from the same folder.
- **Vercel.** Workflow SDK uses the Vercel World, backed by Vercel Queues.

Other worlds, such as `@workflow/world-postgres` selected with `WORKFLOW_TARGET_WORLD`, are loaded by package name when the server starts, so Farm's build output doesn't include them. Run the server from the app directory, where `node_modules` has the world installed.

## Deploy

**Node.** `farm build` writes a server to `.farm/.output` that runs on its own, without `node_modules`. Start it with `farm start` or `node .farm/.output/server/index.mjs`, and set `SITE_URL` if workflows create webhooks.

**Vercel.** Set the target:

```ts title="farm.config.ts"
export default defineConfig({
  vite: { plugins: [workflowTransformPlugin()] },
  plugins: [workflowSdk],
  deploy: { target: "vercel" },
});
```

The build puts `/.well-known/workflow/v1/flow` in its own function, with the longest duration the plan allows and a Vercel Queues trigger. The rest of the app stays in one function.

## Limits

- **`farm dev`.** Runs are recorded but never execute. `build.configure` runs only in production builds, so the workflow routes don't exist in development.
- **Cloudflare.** A `cloudflare-module` build fails to start with `No such module "node:http"`, imported by Workflow SDK.
- **`experimental.serverComponents: { mode: "rsc" }`.** The RSC build doesn't run `build.configure`, so the workflow routes are missing and runs stay `pending`. The default and islands modes work.

For background jobs on Trigger.dev or Inngest, see [Jobs](/docs/integrations/jobs).
