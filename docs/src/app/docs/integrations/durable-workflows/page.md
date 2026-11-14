---
title: "Durable Workflows"
description: "Run multi-step work that sleeps, waits for approvals and webhooks, and resumes after a restart, with Workflow SDK or with Jobs and Inngest."
section: "Integrations"
---

# Durable Workflows

A durable workflow is a function whose progress is saved after every step. It can sleep for days, wait for an approval or a webhook, and pick up where it stopped after a crash or a redeploy, without running finished steps again.

Farm runs them two ways:

- **[Workflow SDK](#workflow-sdk)** runs workflows inside your app's server. You mark async functions with `"use workflow"` and `"use step"` and start them from API routes.
- **[Jobs with Inngest](#jobs-with-inngest)** keeps each run in Inngest, which calls your app for every step. Farm's [Jobs integration](/docs/integrations/jobs) starts runs and reads their status through `api.jobs`.

Jobs can also hand a run to [Trigger.dev](#jobs-with-trigger-dev), whose tasks run on its own servers.

## When to use one

| Need                                                                                              | Use                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Short best-effort work after a response                                                           | [`after()`](/docs/after)                   |
| Call one API route on a schedule                                                                  | [Cron](/docs/cron)                         |
| Background tasks with retries, status, and cancellation, run by your app, Trigger.dev, or Inngest | [Jobs](/docs/integrations/jobs)            |
| Multi-step work that sleeps, waits for an event or a webhook, and survives restarts               | Durable workflows (this page)              |
| An agent run that pauses for a person's approval                                                  | [Durable agents](/docs/integrations/agent) |

## Choose an approach

|                       | Workflow SDK                                   | Jobs with Inngest                             |
| --------------------- | ---------------------------------------------- | --------------------------------------------- |
| Where steps run       | Your server                                    | Your server, called by Inngest                |
| Where runs are stored | `.workflow-data` on a Node server, or Vercel   | Inngest                                       |
| `farm dev`            | Runs don't execute                             | Runs with the Inngest dev server              |
| Wait for an event     | `createHook()` and `resumeHook()`              | `step.waitForEvent()`                         |
| Start and read runs   | `start()` and `getRun()`                       | `api.jobs.<task>.trigger()` and `.status()`   |
| Service in production | None on a Node server, Vercel Queues on Vercel | Inngest Cloud or a self-hosted Inngest server |

## Workflow SDK

[Workflow SDK](https://workflow-sdk.dev) compiles workflow functions at build time and adds its own routes to Farm's server.

Workflows run in production builds. `farm dev` records a run but doesn't execute it, so try workflows with `farm build && farm start`. [Limits](#limits) lists the other places they don't run yet.

### How it fits together

| Piece               | Where                     | What it does                                                        |
| ------------------- | ------------------------- | ------------------------------------------------------------------- |
| Workflows and steps | `src/workflows/*.ts`      | The durable functions                                               |
| The plugin          | `farm.config.ts`          | Compiles workflow files and adds Workflow SDK's routes to the build |
| The startup hook    | `src/instrumentation.ts`  | Resumes unfinished runs when the server starts                      |
| API routes          | `src/app/api/**/route.ts` | Start runs, read their status, and resume them                      |

Workflow SDK serves its own routes under `/.well-known/workflow/v1/`. Its queue calls them to run each step, and webhooks arrive there.

### Install

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

### Configure Farm

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

### Resume runs on startup

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

### Write a workflow

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

### Start a run and read its status

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

### Wait for an event

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

### Receive a webhook

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

### Where runs are stored

Workflow SDK stores runs and queues steps through a _world_.

- **Node server.** The Local World keeps runs in `.workflow-data` in the directory the server starts from. Keep that folder on a persistent disk, and run one server process per folder. Runs started in `farm dev` also land there, stay `pending`, and run the next time `farm start` boots from the same folder.
- **Vercel.** Workflow SDK uses the Vercel World, backed by Vercel Queues.

Other worlds, such as `@workflow/world-postgres` selected with `WORKFLOW_TARGET_WORLD`, are loaded by package name when the server starts, so Farm's build output doesn't include them. Run the server from the app directory, where `node_modules` has the world installed.

### Deploy

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

### Limits

- **`farm dev`.** Runs are recorded but never execute. `build.configure` runs only in production builds, so the workflow routes don't exist in development.
- **Cloudflare.** A `cloudflare-module` build fails to start with `No such module "node:http"`, imported by Workflow SDK.
- **`experimental.serverComponents: { mode: "rsc" }`.** The RSC build doesn't run `build.configure`, so the workflow routes are missing and runs stay `pending`. The default and islands modes work.

## Jobs with Inngest

Inngest keeps each run's state and calls your app over HTTP to run the next step, so a run survives restarts and redeploys of the app. This builds the same refund flow as [Wait for an event](#wait-for-an-event) with the Inngest SDK's steps.

### Install

```bash
pnpm add @farm.js/jobs inngest
```

With pnpm, also allow the build script of `protobufjs`, which the Inngest SDK brings:

```yaml title="pnpm-workspace.yaml"
allowBuilds:
  protobufjs: true
```

### Write the function

**src/inngest/client.ts**

```ts
import { Inngest } from "inngest";

export const inngestClient = new Inngest({ id: "shop" });
```

**src/inngest/refund.ts**

```ts
import { inngestClient } from "./client";

export const refundOrder = inngestClient.createFunction(
  { id: "refund-order", triggers: [{ event: "farm/refund-order" }] },
  async ({ event, step }) => {
    const orderId: string = event.data.orderId;

    const decision = await step.waitForEvent("wait-for-approval", {
      event: "shop/refund.decided",
      match: "data.orderId",
      timeout: "7d",
    });
    if (!decision?.data.approved) return { orderId, status: "rejected" };

    await step.run("issue-refund", () => {
      console.log(`Refunded order ${orderId}`);
    });
    return { orderId, status: "refunded" };
  },
);
```

Jobs sends an event named `farm/<task id>`, so the function listens for `farm/refund-order`. `step.waitForEvent()` pauses the run until a `shop/refund.decided` event with the same `data.orderId` arrives, and returns `null` when the timeout passes first. An approval for another order doesn't resume this run. `step.run()` runs its callback once and saves the result for the function's later calls.

### Serve it from the app

**src/app/api/inngest/route.ts**

```ts
import { serve } from "inngest/edge";
import { inngestClient } from "../../../inngest/client";
import { refundOrder } from "../../../inngest/refund";

const handler = serve({ client: inngestClient, functions: [refundOrder] });

export { handler as GET, handler as POST, handler as PUT };
```

Inngest calls this route to register the function and to run each step. In production, the SDK checks each request's signature with `INNGEST_SIGNING_KEY`.

### Trigger it with Jobs

**src/lib/jobs.ts**

```ts
import { defineTasks, task } from "@farm.js/jobs";

export const tasks = defineTasks({
  refundOrder: task({
    id: "refund-order",
    // Inngest runs the function in src/inngest/refund.ts. This callback only types its input and output.
    async run(input: { orderId: string }) {
      return { orderId: input.orderId, status: "refunded" as "refunded" | "rejected" };
    },
  }),
});
```

**src/lib/integrations.ts**

```ts
import { inngest, jobs } from "@farm.js/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({
    runtime: inngest({
      eventKey: process.env.INNGEST_EVENT_KEY,
      signingKey: process.env.INNGEST_SIGNING_KEY,
      eventBaseUrl: process.env.INNGEST_EVENT_BASE_URL,
      apiBaseUrl: process.env.INNGEST_API_BASE_URL,
    }),
    tasks,
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { appIntegrations } from "./src/lib/integrations";

export default defineConfig({
  integrations: appIntegrations,
});
```

**src/lib/api.server.ts**

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api } = createIntegrations<AppIntegrations>();
```

**src/app/api/refunds/route.ts**

```ts
import { api } from "../../../lib/api.server";

export async function POST(request: Request) {
  const { orderId } = await request.json();
  const result = await api.jobs.refundOrder.trigger({ body: { orderId } });
  if (result.error) throw result.error;
  return Response.json({ handleId: result.data!.handleId }, { status: 202 });
}
```

**src/app/api/refunds/approve/route.ts**

```ts
import { inngestClient } from "../../../../inngest/client";

export async function POST(request: Request) {
  const { orderId, approved } = await request.json();
  // Check that the caller may approve refunds before sending the decision.
  await inngestClient.send({
    name: "shop/refund.decided",
    data: { orderId, approved: approved === true },
  });
  return new Response(null, { status: 204 });
}
```

**src/app/api/refunds/status/route.ts**

```ts
import { api } from "../../../../lib/api.server";

export async function GET(request: Request) {
  const handleId = new URL(request.url).searchParams.get("handleId");
  if (!handleId) return Response.json({ error: "Pass ?handleId=<id>." }, { status: 400 });

  const result = await api.jobs.refundOrder.status({ query: { handleId } });
  if (result.error) throw result.error;
  return Response.json({ status: result.data!.status, output: result.data!.output });
}
```

If the app also uses Workflow SDK, add `integrations` to the same `farm.config.ts`. The task's `run` only gives `api.jobs` its input and output types; Inngest runs the function. A run waiting for its event reports `running`. As with the hook version, check the caller's session in the approve route before sending the decision.

### Run it locally

Start the [Inngest dev server](https://www.inngest.com/docs/dev-server) and point it at the route, using your dev server's port:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

**.env**

```bash
INNGEST_DEV=1
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=signkey-local-0000
INNGEST_EVENT_BASE_URL=http://localhost:8288
INNGEST_API_BASE_URL=http://localhost:8288
```

Then run `farm dev`. The function is an ordinary API route, so it runs in development too. The dev server accepts these placeholder keys. It reports `output` as an empty string, so locally `status` tells you that a run finished but not what it returned. Stop and restart the app while a refund waits: the approval still resumes it, because the run lives in Inngest.

### Go to production

Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` from your Inngest environment, remove `INNGEST_DEV` and the two base URLs, and sync `https://<your-domain>/api/inngest` in Inngest. [Inngest](/docs/integrations/inngest) lists the runtime's options and what it can't do, such as cancel a run.

## Jobs with Trigger.dev

Trigger.dev runs tasks on its own servers. Write the task with the Trigger.dev SDK, which pauses with `wait.for()` and waits for a person or another system with `wait.forToken()`, and deploy it with Trigger.dev's CLI. Farm triggers it by task id through the same `api.jobs` calls; see [Trigger.dev](/docs/integrations/trigger).

## Jobs with `local()`

The Jobs `local()` runtime runs a task's own `run` in your app and retries the whole task when it fails. It has no steps, sleeps, or waits, so a retry starts over. It fits one-step background work; see [Jobs](/docs/integrations/jobs).
