---
title: "Durable Agents"
description: "Serve agents written with the AI SDK, Mastra, LangGraph, the OpenAI Agents SDK, or plain TypeScript as durable runs that pause for approval and survive restarts and redeploys."
section: "Integrations"
---

# Durable Agents

`@farm.js/agent` serves the agents in `src/agents` as durable runs, built and run by [agent-unit](https://github.com/farming-labs/agent-unit). A run can pause for a person's approval, survive a restart or a redeploy, and resume without repeating a model call or a side effect. Clients reconnect to a run's event stream from the last event they saw. The same agents are also an MCP server and an A2A agent.

Use it when a run must outlast its request. For a chat that streams one answer per request, a plain API route is enough; see [agent frameworks](/docs/integrations/agent-frameworks).

## Install

```bash
pnpm add @farm.js/agent agent-unit
```

## Register the integration

**farm.config.ts**

```ts
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

`farm dev` serves the agents from source and reloads them when they change. `farm build` builds them into the server for the app's deploy target: agent-unit adds the agents' framework adapters, run storage, and a scheduled sweep that wakes sleeping runs and recovers stalled ones. The settings evaluate where the server runs, so a storage URL or a token read from `process.env` is never written into the build.

## Write an agent

Each file in `src/agents` is an agent named after the file. Write it with the framework you already use and export it as the default. Plain TypeScript agents use `defineAgent`:

**src/agents/refund.ts**

```ts
import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("look up order", () => findOrder(input.orderId));
  const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
  return approved ? await refund(order) : "kept";
});
```

`run.step` runs once and is replayed from the run's journal afterwards. `run.interrupt` pauses the run until an answer arrives, across restarts and deploys.

Agents from the [AI SDK](https://ai-sdk.dev) (`new ToolLoopAgent(…)`), [Mastra](https://mastra.ai) (`new Agent(…)`), [LangGraph](https://langchain-ai.github.io/langgraphjs/) (`graph.compile()`), and the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) (`new Agent(…)`) work unchanged. Their own pauses become interrupts: tool approvals, Mastra's `suspend()`, and LangGraph's `interrupt()`. The framework is detected from `package.json`; name it to serve only that framework:

```ts
agent({ framework: "mastra" });
```

With `framework` set, the build fails with the install command when that framework is missing.

## Call the agents

The API lives under `basePath`, `/api/agent` by default:

| Request                                  | Does                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/agent/agents/:name/runs`      | Starts a run with `{ input }`. `Accept: text/event-stream` streams it. |
| `GET /api/agent/runs/:id`                | Reads a run: its status, the interrupt it waits on, and its output.    |
| `GET /api/agent/runs/:id/events`         | Streams its events, from `?after=` or `Last-Event-ID`.                 |
| `POST /api/agent/runs/:id/resume`        | Answers the interrupt with `{ answer }`.                               |
| `GET /api/agent/runs?status=interrupted` | Lists runs, for an approvals inbox.                                    |
| `GET /api/agent/manifest.json`           | Lists the agents.                                                      |
| `POST /api/agent/mcp`                    | The agents as MCP tools.                                               |

Events follow [AG-UI](https://docs.ag-ui.com). The typed client reconnects dropped streams:

```ts
import { createAgentClient } from "agent-unit/client";

const agents = createAgentClient({ baseUrl: "/api/agent" });

for await (const event of agents.run("refund", { orderId: "o_1" })) {
  if (event.type === "RUN_INTERRUPTED") console.log("needs approval:", event.interrupt.payload);
}
for await (const event of agents.resume(runId, { approved: true })) console.log(event.type);
```

The integration owns every path under `basePath`. `farm dev` refuses to start when an API route in `src/app` sits under it; move the route or set another `basePath`.

## Authorize requests

Every request reaches `authorize` before the agents. Return `false` to answer `401`, or decide per action, agent, and run:

```ts
agent({
  authorize: (request) =>
    request.headers.get("authorization") === `Bearer ${process.env.AGENT_TOKEN}`,
});
```

Without `authorize`, anyone who can reach the server can start and resume runs.

## Storage and deploy targets

Runs live in any [unstorage](https://unstorage.unjs.io) driver. Without `storage`, a Node server keeps them on disk in `.data/agent-unit`, and targets without a durable disk keep them in memory and warn during the build. Set a shared driver for production, and use `presets` to choose one per target:

```ts
agent({
  storage: { driver: "fs-lite", base: ".data/agents" },
  presets: {
    vercel: { storage: { driver: "upstash" } },
    "cloudflare-module": { storage: { driver: "cloudflare-kv-binding", binding: "AGENTS" } },
  },
});
```

On Redis, runs and leases change atomically, so two instances never take the same approval twice. Each target's scheduler runs the sweep; Netlify, AWS Lambda, and Vercel's Hobby plan need a step of their own, listed in agent-unit's [host table](https://github.com/farming-labs/agent-unit#deploy-anywhere).

## Options

| Option      | Default          | Description                                                                          |
| ----------- | ---------------- | ------------------------------------------------------------------------------------ |
| `basePath`  | `"/api/agent"`   | Where the API is mounted.                                                            |
| `agentsDir` | `"src/agents"`   | The folder of agent files, relative to the app root (`agents` in `srcDir`).          |
| `framework` | detected         | `"ai-sdk"`, `"mastra"`, `"langgraph"`, or `"openai-agents"`.                         |
| `storage`   | disk on Node     | Run storage, as an unstorage driver config.                                          |
| `presets`   | none             | Settings per deploy target, applied over the top-level ones.                         |
| `authorize` | none             | Decides every request.                                                               |
| `name`      | the package name | The name in the manifest, MCP, and A2A.                                              |
| `tasks`     | none             | Scheduled tasks that run on the target's scheduler.                                  |
| `budget`    | per target       | How long a run works before it yields and continues: 240s on Vercel, 25s on Workers. |
| `retention` | kept             | How long finished runs are kept.                                                     |
| `sweep`     | every minute     | The sweep's cron schedule, or `false`.                                               |
| `agents`    | `src/agents`     | Agents as an object, instead of the folder.                                          |
| `adapters`  | none             | Adapters for other frameworks.                                                       |

The Nitro and Workers settings belong in `farm.config.ts`. A framework's own server, such as Mastra's, and agent-unit's Durable Objects runtime are built by `agent-unit build` instead of this integration.

The [`examples/agent`](https://github.com/farming-labs/farm.js/tree/main/examples/agent) app runs an approval agent end to end.
