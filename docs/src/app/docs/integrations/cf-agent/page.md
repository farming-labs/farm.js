---
title: "Cloudflare Agents Integration"
description: "Run Cloudflare Agents beside Farm and deploy the UI, Agent classes, WebSockets, and Durable Objects as one Worker."
section: "Integrations"
---

# Cloudflare Agents Integration

`@farmjs/cf-agent` joins a Farm application and [Cloudflare Agents](https://developers.cloudflare.com/agents/) without replacing the Agents SDK. Farm manages Wrangler in development, proxies Agent WebSockets at the application origin, and composes both builds into one Worker for production.

## Install

Cloudflare Agents and Wrangler require Node.js 22 or newer.

```bash
pnpm add @farmjs/cf-agent agents
pnpm add -D wrangler
pnpm add -D @cloudflare/workers-types
```

## Define an Agent

**agent.ts**

```ts
import { Agent, callable, routeAgentRequest } from "agents";

export interface CounterState {
  count: number;
}

export interface Env {
  CounterAgent: DurableObjectNamespace<CounterAgent>;
}

export class CounterAgent extends Agent<Env, CounterState> {
  initialState: CounterState = { count: 0 };

  @callable()
  increment(): number {
    const count = this.state.count + 1;
    this.setState({ count });
    return count;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeAgentRequest(request, env)) ??
      Response.json({ error: "Agent not found" }, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
```

## Configure Durable Objects

Wrangler remains the source of truth for Agent bindings, compatibility flags, migrations, variables, and environments.

**wrangler.jsonc**

```json
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "farm-cloudflare-agent",
  "main": "agent.ts",
  "compatibility_date": "2026-07-16",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      {
        "name": "CounterAgent",
        "class_name": "CounterAgent"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["CounterAgent"]
    }
  ]
}
```

Create a new migration entry when adding, renaming, or deleting a Durable Object class. Never reuse a deployed migration tag.

## Register the runtime

**farm.config.ts**

```ts
import { cfAgent } from "@farmjs/cf-agent";
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  integrations: {
    agent: cfAgent(),
  },
  deploy: {
    target: "cloudflare",
    preset: "cloudflare-module",
    output: ".output",
  },
});
```

The `cloudflare-module` preset is required when Farm and the Agent runtime share one Worker. During `farm dev`, Farm starts Wrangler on an available loopback port and proxies `/agents` with WebSocket upgrades enabled.

## Connect from React

**src/app/page.tsx**

```tsx
"use client";

import { useAgent } from "agents/react";
import type { CounterAgent, CounterState } from "../../agent";

export default function Page() {
  const agent = useAgent<CounterAgent, CounterState>({
    agent: "CounterAgent",
    name: "shared-demo",
  });

  return (
    <main>
      <p>Count: {agent.state?.count ?? 0}</p>
      <button disabled={!agent.identified} onClick={() => agent.stub.increment()}>
        Increment
      </button>
    </main>
  );
}
```

State synchronization, reconnection, and callable RPC stay typed through Cloudflare's `useAgent()` hook. Farm only gives that protocol a same-origin home.

## Build and deploy

```bash
farm build
farm deploy --cloudflare
```

After the Farm build, the integration:

1. Preserves the original `wrangler.jsonc`.
2. Generates a Worker entry that sends `/agents/**` to `routeAgentRequest()` and all other requests to Farm.
3. Re-exports Agent classes so Durable Object bindings remain valid.
4. Writes `.farm-cf-agent.wrangler.jsonc` and `.farm/cf-agent/deploy.json`.
5. Lets `farm deploy --cloudflare` deploy the combined Worker with Wrangler.

Run a provider-side verification without uploading:

```bash
wrangler deploy --dry-run --config .farm-cf-agent.wrangler.jsonc
```

## Custom route prefix

Keep the Farm prefix and Cloudflare router prefix identical.

```ts
// farm.config.ts
agent: cfAgent({ routePrefix: "/api/agents" });
```

```ts
// agent.ts
await routeAgentRequest(request, env, {
  prefix: "/api/agents",
});
```

## Use an external Worker

Point Farm at an existing Worker when the app and Agent need independent deployment boundaries.

```ts
agent: cfAgent({
  origin: process.env.CF_AGENT_ORIGIN,
});
```

`CF_AGENT_ORIGIN` is also read automatically. With an external origin, Farm keeps the public route prefix but skips combined Worker generation.

## Options

| Option | Purpose |
| --- | --- |
| `config` | Wrangler config relative to `farm.config.ts`. Defaults to `wrangler.jsonc`. |
| `routePrefix` | Same-origin Agent route. Defaults to `/agents`. |
| `origin` | Existing Cloudflare Worker origin. |
| `environment` | Wrangler environment used by development and deployment. |
| `dev: false` | Disable the managed Wrangler development process. |
| `dev.port` | Fixed local Wrangler port. Farm selects an available port by default. |
| `dev.remote` | Use Wrangler remote development. |
| `dev.logs` | Forward Wrangler output through the Farm logger. Defaults to `true`. |
| `dev.timeoutMs` | Maximum startup wait. Defaults to 60 seconds. |

## Secure Agent routes

Same-origin WebSockets prevent cross-origin configuration drift, but they do not prove who the user is. Reject unauthorized HTTP and WebSocket requests before they enter an Agent.

```ts
import { getSession } from "./auth";

async function authorize(request: Request) {
  const session = await getSession(request);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
}

await routeAgentRequest(request, env, {
  onBeforeConnect: authorize,
  onBeforeRequest: authorize,
});
```

Also validate every callable argument, enforce resource ownership inside the Worker, store secrets with Wrangler rather than public Farm env, and rate-limit expensive model or tool operations.

See Cloudflare's guides for [Agent routing](https://developers.cloudflare.com/agents/runtime/communication/routing/), [Agent APIs](https://developers.cloudflare.com/agents/runtime/agents-api/), and [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).
