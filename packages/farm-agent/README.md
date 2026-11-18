# @farm.js/agent

Durable agents for Farm.js, built and run by
[agent-unit](https://github.com/farming-labs/agent-unit). The integration serves the agents in
`src/agents` as runs that can pause for a person's approval, survive restarts and redeploys, and
resume without repeating a model call or a side effect.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/agent agent-unit
```

`agent-unit` is a dependency of this package. Add it to the app as well, because agent files import
`defineAgent` from it and clients import `agent-unit/client`. `@farm.js/core` is a peer dependency,
and the package needs Node.js 22.13 or newer.

## Configure

```ts
// farm.config.ts
import { agent } from "@farm.js/agent";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  integrations: {
    agent: agent({
      storage: { driver: "redis", url: process.env.REDIS_URL },
    }),
  },
});
```

`farm dev` serves the agents from source and reloads them on change. `farm build` builds them into
the server for the app's deploy target, with run storage and a scheduled sweep that wakes sleeping
runs and recovers stalled ones. Settings evaluate where the server runs, so a value read from
`process.env` is never written into the build.

## Write an agent

Each file in `src/agents` is an agent named after the file:

```ts
// src/agents/refund.ts
import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("look up order", async () => ({ id: input.orderId, total: 42 }));
  const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
  return approved ? `refunded ${order.id}` : `kept ${order.id}`;
});
```

`run.step` runs once and is replayed from the run's journal afterwards. `run.interrupt` pauses the
run until an answer arrives. Agents written with the AI SDK, Mastra, LangGraph, or the OpenAI
Agents SDK work as a default export too; the framework is detected from `package.json`.

## Wait for an external event

With agent-unit 0.6.0, a run can wait for a webhook or another system:

```ts
// src/agents/checkout.ts
import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const payment = await run.waitFor<{ orderId: string; amount: number }>("payment.succeeded", {
    match: { orderId: input.orderId },
    timeout: "1h",
  });
  return { orderId: input.orderId, paid: payment.amount };
});
```

After verifying the webhook provider's signature, send its event to the app's guarded
`POST /api/agent/events` endpoint:

```json
{
  "name": "payment.succeeded",
  "data": { "orderId": "o_1", "amount": 42 },
  "id": "provider-event-1"
}
```

Matching runs resume with the event data. Reuse the provider event ID on retries to avoid
redelivery. Events are retained for 24 hours by default, so one sent after the run starts but
before it waits can still be consumed. A parked run has status `waiting` and emits `RUN_WAITING`.
A timeout throws `EventTimeoutError` from `agent-unit/runtime`.

Protect event sends with the same middleware and guards as the rest of the agent API. The
`authorize` callback receives `action: "send"` and the event name. Farm.js Infra's existing store
and clock support these waits; event sends go to the app, and event waits do not create human
approval requests in Infra.

## Call the agents

The API is mounted at `basePath`, `/api/agent` by default, as ordinary API routes, so the app's
middleware and integration guards run first in development and in every deploy target.

| Request                                  | Does                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/agent/agents/:name/runs`      | Starts a run with `{ input }`. `Accept: text/event-stream` streams it. |
| `GET /api/agent/runs/:id`                | Reads a run: its status, pending interrupt, and output.                |
| `GET /api/agent/runs/:id/events`         | Streams its events, from `?after=` or `Last-Event-ID`.                 |
| `POST /api/agent/runs/:id/resume`        | Answers the interrupt with `{ answer }`.                               |
| `GET /api/agent/runs?status=interrupted` | Lists runs, for an approvals inbox.                                    |
| `GET /api/agent/manifest.json`           | Lists the agents.                                                      |
| `POST /api/agent/events`                 | Sends an event to matching waiting runs.                               |
| `GET /api/agent/runs?status=waiting`     | Lists runs waiting for an event.                                       |
| `POST /api/agent/mcp`                    | The agents as MCP tools.                                               |

```ts
import { createAgentClient } from "agent-unit/client";

const agents = createAgentClient({ baseUrl: "/api/agent" });

for await (const event of agents.run("refund", { orderId: "o_1" })) {
  if (event.type === "RUN_INTERRUPTED") console.log("needs approval", event.interrupt.payload);
}
```

The integration owns every path under `basePath`; `farm dev` refuses to start when an API route in
`src/app` sits under it.

## Authorize requests

Every request reaches `authorize` before the agents. Return `false` to answer `401`, or a
`Response` to answer with. The second argument says what the request does:
`{ action, agent, runId, threadId }`.

```ts
agent({
  authorize: (request) =>
    request.headers.get("authorization") === `Bearer ${process.env.AGENT_TOKEN}`,
});
```

Set `authorize`, or a middleware guard on `basePath`, before anyone else can reach the app. Without
one, any caller can list, read, answer, and start runs. A guard should let agent-unit's internal
continue and sweep requests through; they carry `AGENT_UNIT_SECRET` as a bearer token, which
agent-unit checks itself. The same goes for Farm.js Infra's wake, answer, and cancel calls, signed
with `FARMJS_API_KEY` in a `farmjs-signature` header.

## Run an agent on a schedule

A task with `agent` starts a run of that agent once per scheduled time, on the target's scheduler.
A retried cron call gets the run the first call started:

```ts
agent({
  tasks: {
    "morning-digest": { schedule: "0 8 * * *", agent: "digest", input: { team: "support" } },
  },
});
```

## Approve runs in Farm.js Infra

With `FARMJS_API_KEY` set where the server runs, the interrupts runs wait on show up under Agents >
Approvals in Farm.js Infra, where an organization owner or admin approves, rejects, or cancels the
run.

## Options

| Option      | Default              | Description                                                  |
| ----------- | -------------------- | ------------------------------------------------------------ |
| `basePath`  | `/api/agent`         | Where the API is mounted. Must be under `/api`.              |
| `agentsDir` | `agents` in `srcDir` | The folder of agent files, relative to the app root.         |
| `agents`    |                      | Agents as an object, instead of the folder.                  |
| `framework` | detected             | `"ai-sdk"`, `"mastra"`, `"langgraph"`, or `"openai-agents"`. |
| `storage`   | disk on Node         | Run storage, as an unstorage driver config.                  |
| `presets`   |                      | Settings per deploy target, over the top-level ones.         |
| `authorize` |                      | Decides every request.                                       |
| `name`      | package name         | The name in the manifest, MCP, and A2A card.                 |
| `tasks`     |                      | Scheduled tasks: an `agent` to run or a `handler` module.    |
| `budget`    | per target           | How long a run works before it yields and continues.         |
| `retention` | kept                 | How long finished runs are kept.                             |
| `sweep`     | every minute         | The sweep's cron schedule, or `false`.                       |
| `adapters`  |                      | Adapters for other agent frameworks.                         |

Without `storage`, a Node server keeps runs on disk in `.data/agent-unit`, and targets without a
durable disk keep them in memory. Use a shared driver in production, per target if needed:

```ts
agent({
  storage: { driver: "fs-lite", base: ".data/agents" },
  presets: {
    vercel: { storage: { driver: "upstash" } },
    "cloudflare-module": { storage: { driver: "cloudflare-kv-binding", binding: "AGENTS" } },
  },
});
```

`@farm.js/agent/config` is the module agent-unit reads these settings from inside the built
server; apps do not import it.

## Documentation

- [Durable agents](https://farmjs.dev/docs/integrations/agent)
- [Agent frameworks](https://farmjs.dev/docs/integrations/agent-frameworks), for chat routes that
  do not need durable runs

The [`examples/agent`](https://github.com/farming-labs/farm.js/tree/main/examples/agent) app runs an
approval agent end to end.

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
