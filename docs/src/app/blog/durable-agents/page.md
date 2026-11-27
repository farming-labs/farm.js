---
title: "Build durable agents with your framework and Farm Infra"
description: "Keep your agent framework, make work resumable with agent-unit, and choose Farm Infra storage, wake-ups, and approvals."
---

# Build durable agents with your framework and Farm Infra

KinfeMichael Tariku · Nov 2026

A customer asks for a refund. Your agent looks up the order, asks someone to approve it, and waits. The person answers tomorrow. In between, you deploy a new version of the app.

That is the example I want to build here.

**A durable agent saves enough progress to continue after the request, process, or deployment that started it has ended.** With `agent-unit`, a completed step has a saved result, a pending approval has a run ID, and the next server invocation can continue the work.

You can use the AI SDK, Mastra, LangGraph, the OpenAI Agents SDK, or plain TypeScript. Your web app can stay on its existing framework. Farm Infra can provide the pieces you choose, including run storage, wake-ups, and a dashboard where people answer approvals.

<span id="start-with-a-refund-that-waits" className="blog-heading-anchor" />

## Start with a refund that waits

Here is a complete small agent in `agents/refund.ts`. The order and refund result are demo data so you can see the control flow.

```ts
import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("load-order", async () => ({
    id: input.orderId,
    amountCents: 3600,
    currency: "USD",
  }));

  const decision = await run.interrupt<{ approved: boolean }>("approve-refund", order);

  if (!decision.approved) {
    return { orderId: order.id, status: "declined" };
  }

  return run.step("refund-order", async () => ({
    orderId: order.id,
    status: "refunded",
    amountCents: order.amountCents,
  }));
});
```

`run.step` saves a completed operation's result. `run.interrupt` saves a pause and the information the reviewer needs. When the person answers, the agent replays the saved order lookup, receives the decision, and moves on to the refund.

Here is the request that starts it.

```http
POST /agents/refund/runs
Content-Type: application/json

{"input":{"orderId":"bag-order-123"}}
```

The run gets an ID. Its state becomes `interrupted`, with an `approve-refund` payload containing the order ID, amount, and currency. A caller can answer that specific run.

```http
POST /runs/<run-id>/resume
Content-Type: application/json

{"answer":{"approved":true}}
```

The final output is `{"orderId":"bag-order-123","status":"refunded","amountCents":3600}`. Answering `false` returns `"status":"declined"` and skips the refund step.

These are the engine's default paths. Mounting it under `/api/agents` adds that prefix to each path.

<span id="make-the-real-side-effect-safe-to-repeat" className="blog-heading-anchor" />

## Make the real side effect safe to repeat

For a real shop, replace the demo lookup with your order database and the final step with your payment provider. The provider call needs the step's idempotency key, a stable identifier the provider uses to recognize a repeated operation.

For example, with an authenticated Stripe client and the payment ID loaded from your database, the final step becomes this.

```ts
const refund = await run.step("refund-order", ({ idempotencyKey }) =>
  stripe.refunds.create({ payment_intent: order.paymentId }, { idempotencyKey }),
);
```

There is a specific failure this handles. Stripe might accept the refund just before your process dies and before the step's result is saved. Recovery executes the unfinished step again with the same key. Stripe can return the original operation.

Completed steps replay their saved results. Unfinished steps may execute again. Keep external effects and random values inside steps, and keep the decisions between them reproducible from saved values. Load the refund amount and payment ID from the order record. The request supplies the order ID.

<span id="use-your-agent-framework" className="blog-heading-anchor" />

## Use your agent framework

The TypeScript function makes the waiting behavior visible. An AI SDK agent can ask for the same approval inside a tool.

```ts
// agents/support.ts
import { openai } from "@ai-sdk/openai";
import { stepCountIs, tool, ToolLoopAgent } from "ai";
import { useRun } from "agent-unit";
import { z } from "zod";

export default new ToolLoopAgent({
  model: openai("gpt-4.1-mini"),
  instructions: "Help with refunds. Use requestRefund for the order the customer names.",
  tools: {
    requestRefund: tool({
      description: "Ask a person to approve a demo refund.",
      inputSchema: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => {
        const decision = await useRun().interrupt<{ approved: boolean }>("approve-refund", {
          orderId,
        });
        return { orderId, approved: decision.approved };
      },
    }),
  },
  stopWhen: stepCountIs(5),
});
```

This tool returns the approval decision. Put the actual refund behind that decision and use the tool call's `useRun().idempotencyKey()` for the payment provider. The model key belongs in the server environment.

When built through the engine, agent-unit detects supported frameworks from the app's dependencies. You can also select one explicitly.

```ts
// agent-unit.config.ts
import { defineConfig } from "agent-unit";

export default defineConfig({
  framework: "ai-sdk",
  storage: "farmjs",
});
```

Here is how the built-in adapters handle other frameworks.

| Your agent        | Export from the agent file | How it asks for approval          |
| ----------------- | -------------------------- | --------------------------------- |
| AI SDK            | A `ToolLoopAgent`          | `useRun().interrupt()` in a tool  |
| Mastra            | A Mastra `Agent`           | Tool approval or `suspend()`      |
| OpenAI Agents SDK | An SDK `Agent`             | A tool with `needsApproval: true` |
| LangGraph         | A compiled graph           | `interrupt()` in a node           |
| Plain TypeScript  | `defineAgent(...)`         | `run.interrupt()`                 |

The adapters preserve model and tool results or the framework's checkpoints so the engine can resume the run. Additional frameworks can provide an adapter through `defineAdapter`. A framework with its own server and persistence can also be built through agent-unit's `server` option. In that mode, the framework owns its runs and recovery. [Framework adapters and server options](https://github.com/farming-labs/agent-unit/blob/5bb0d40725236bcf436926408c37e79711ad9b7d/README.md#bring-your-framework)

<span id="keep-your-existing-web-app" className="blog-heading-anchor" />

## Keep your existing web app

The engine exposes a Web `Request` → `Response` handler. You can mount it inside a Fetch-based server or deploy it beside your app.

For the plain TypeScript refund agent above, this server module mounts the engine under `/api/agents`.

```ts
// src/agent-server.ts
import { createAgentUnit } from "agent-unit/server";
import refund from "../agents/refund";

export const unit = createAgentUnit({
  agents: { refund },
  storage: "farmjs",
  basePath: "/api/agents",
});
```

In a Hono app, attach it to the matching path. Apply your existing authentication and project or user authorization before forwarding requests.

```ts
app.all("/api/agents/*", (c) => unit.handler(c.req.raw));
```

In a Next.js App Router catch-all handler at `app/api/agents/[...path]/route.ts`, export the same handler for the methods the engine uses.

```ts
import { unit } from "@/src/agent-server";

export const GET = (request: Request) => unit.handler(request);
export const POST = GET;
export const DELETE = GET;
```

The import path should match your app's alias. Without a host `waitUntil` callback, start and resume requests wait for the current work to finish or pause. Hosts that support `waitUntil` can pass it in `unit.handler(request, { waitUntil })`. Sleeping runs still need a wake-up mechanism and persistent storage.

When mounting an AI SDK agent this way, also pass `adapters: [aiSdkAdapter]`, imported from `agent-unit/adapters/ai-sdk`. The build command discovers adapters automatically; a manually created unit receives them explicitly.

A Farm app has a dedicated integration.

```ts
import { defineConfig } from "@farm.js/core";
import { agent } from "@farm.js/agent";

export default defineConfig({
  integrations: {
    agent: agent({ storage: "farmjs" }),
  },
});
```

That integration discovers agents in `src/agents` and mounts them at `/api/agent`. The agent function itself keeps the same step and approval code. [Mounting the engine](https://github.com/farming-labs/agent-unit/blob/5bb0d40725236bcf436926408c37e79711ad9b7d/README.md#mount-it-in-an-existing-app) · [Farm integration](https://farmjs.dev/docs/integrations/agent)

<span id="choose-what-farm-infra-handles" className="blog-heading-anchor" />

## Choose what Farm Infra handles

Run storage, waking a run, and answering an approval are separate jobs. Pick the combination your app needs.

| What you need                   | Configuration                              | Where it happens                                         |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| Hosted run history and journals | `storage: "farmjs"`                        | Farm Infra stores run state                              |
| Your existing Redis store       | Explicit Redis storage                     | Your Redis stores run state                              |
| Hosted wake-ups                 | Runtime key and a reachable deployment URL | Infra calls the app when work is due                     |
| Approval inbox                  | The same runtime key and URL               | An owner or admin answers in Infra                       |
| Approvals with your own clock   | `AGENT_UNIT_CLOCK=local`                   | Infra handles approvals; your timers and sweep wake runs |

Create a project in Farm Infra and a project-scoped API key with `agents:runtime`. Configure these values on the server.

```dotenv
FARMJS_API_KEY=<project-scoped-runtime-key>
AGENT_UNIT_URL=https://agents.example.com
FARMJS_ENVIRONMENT=production
```

Use your deployment's reachable HTTPS URL. If the engine is mounted at `/api/agents`, its configured base path is added to the callback routes. The endpoint needs to be reachable through any deployment protection.

With `storage: "farmjs"` selected explicitly, the key is read when the server runs. For the CLI build, leaving storage unspecified lets the build choose hosted storage when its environment contains the key. Explicit storage makes that choice visible in the code.

Development through `agent-unit dev` uses local storage and does not contact Infra by default. To try the hosted behavior, run the built deployment with the runtime key and URL configured. [Storage and runtime configuration](https://github.com/farming-labs/agent-unit/blob/5bb0d40725236bcf436926408c37e79711ad9b7d/README.md#farmjs-storage)

### Keep Redis and add the approval inbox

This configuration keeps your existing store and disables the hosted clock. The runtime key still enables Infra approvals.

```ts
// agent-unit.config.ts
import { defineConfig } from "agent-unit";

export default defineConfig({
  storage: {
    driver: "redis",
    url: process.env.REDIS_URL,
  },
});
```

```dotenv
AGENT_UNIT_CLOCK=local
```

Your host needs its own timers or scheduled sweep to recover runs and wake sleeping work. Leave the clock setting unset to use hosted wake-ups where supported.

### Answer the refund in the dashboard

When the refund reaches `run.interrupt`, the pending decision appears under **Agents → Approvals**. An organization owner or admin can approve, reject, add a note, or cancel the waiting run.

Infra sends a signed callback to the deployed app. The engine checks it and resumes the specific pause with an answer shaped like this.

```ts
{
  approved: true,
  by: "reviewer-id",
  note: "Return received."
}
```

The refund function only needs `approved`. An app that wants to record the reviewer can include `by` and `note` in its decision type.

If the app has already answered that pause, a late dashboard answer cannot resume a later pause of the same name. Keep the engine's signed callback endpoints reachable through your app's middleware. Authenticate user-facing run and approval requests with your own access rules. [Approval callbacks](https://github.com/farming-labs/agent-unit/blob/5bb0d40725236bcf436926408c37e79711ad9b7d/README.md#approve-interrupts-in-farmjs-infra)

### Wake a run tomorrow

An agent can park until a reminder is due.

```ts
await run.sleep("1d");
await run.step("send-reminder", ({ idempotencyKey }) =>
  sendReminder({ orderId: input.orderId, idempotencyKey }),
);
```

Here, `sendReminder` is your app's delivery function. It must use the supplied key to deduplicate delivery.

With hosted wake-ups configured, Infra calls the deployed engine when the run is due. The app executes the agent code. On Node, Bun, and Deno, in-process timers also handle scheduled work. Cloudflare's Durable Objects runtime uses its own alarms. [Wake-up behavior by host](https://github.com/farming-labs/agent-unit/blob/5bb0d40725236bcf436926408c37e79711ad9b7d/README.md#wake-runs-with-farmjs-infra)

<span id="add-the-other-infrastructure-when-the-app-needs-it" className="blog-heading-anchor" />

## Add the other infrastructure when the app needs it

The refund flow can use more of Farm Infra as it grows.

- **Previews** gives reviewers a temporary public URL for a running local app. The app and tunnel stay running while the link is in use.
- **Webhooks** can receive provider events, track delivery attempts, and replay a failed delivery. Your app maps a verified provider event to the relevant order or agent event.
- **Cron jobs** can call a reconciliation endpoint on a schedule.
- **Analytics** can report requests and tool calls when the app sends telemetry. Connecting an agent runtime key does not automatically instrument every framework's routes.

Choose each service for the work it owns. A refund agent may only need hosted storage and approvals. An existing Redis-backed agent may only need the approval inbox. [Farm Infra](https://app.farmjs.dev) · [Previews](https://farmjs.dev/docs/preview) · [Analytics](https://farmjs.dev/docs/infra-analytics)

<span id="check-the-pause-before-adding-a-real-payment-provider" className="blog-heading-anchor" />

## Check the pause before adding a real payment provider

The engine's test helper can run the TypeScript agent with an in-memory store. This checks both decisions and simulates replacing the engine while an approval is pending, using the same store.

```ts
import assert from "node:assert/strict";
import { createTestUnit } from "agent-unit/testing";
import refund from "./agents/refund";

const unit = createTestUnit({ refund });

const pending = await unit.run("refund", { orderId: "bag-order-123" });
assert.equal(pending.status, "interrupted");

unit.close();
const restarted = createTestUnit({ refund }, { storage: unit.storage });
const finished = await restarted.resume(pending.id, { approved: true });
assert.equal(finished.output.status, "refunded");

const another = await restarted.run("refund", { orderId: "bag-order-456" });
const declined = await restarted.resume(another.id, { approved: false });
assert.equal(declined.output.status, "declined");
restarted.close();
```

For production verification, pause a run on the actual deployment, restart it, and answer the saved run ID. Check that the completed lookup is replayed and that the provider receives the same idempotency key if an unfinished refund is retried.

The agent code describes the work. The journal preserves progress. Your chosen host runs it, and Farm Infra supplies the storage, clock, or human decision your app needs.

For the wider framework release, read the [Farm.js 0.2 preview](/blog/0.2).
