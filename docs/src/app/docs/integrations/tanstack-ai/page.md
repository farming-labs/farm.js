---
title: "TanStack AI"
description: "Stream AI chat from a Farm API route with TanStack AI, with server tools, browser tools, and your app's MCP tools, in any renderer."
section: "Integrations"
---

# TanStack AI

[TanStack AI](https://tanstack.com/ai) runs on Farm without an adapter. Its server API reads a web `Request` and returns a streaming `Response`, which is the shape of a Farm API route, and its `useChat` bindings cover React, Vue, Svelte, Solid, and Preact. There is no `@farm.js` package to install: you use TanStack AI directly.

A complete example lives in [`examples/tanstack-ai-chat`](https://github.com/farming-labs/farm.js/tree/main/examples/tanstack-ai-chat).

## Install

```bash
pnpm add @tanstack/ai @tanstack/ai-react @tanstack/ai-openai zod
```

Use the binding for your renderer instead of `@tanstack/ai-react` where needed: `@tanstack/ai-vue`, `@tanstack/ai-svelte`, `@tanstack/ai-solid`, or `@tanstack/ai-preact`. Swap `@tanstack/ai-openai` for another provider adapter, such as Anthropic or Gemini.

TanStack AI's tool schemas need **Zod 4.2 or newer**.

## Create a chat route

**src/app/api/chat/route.ts**

```ts
import { chat, chatParamsFromRequest, toServerSentEventsResponse } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

export async function POST(request: Request) {
  const { messages, threadId, runId } = await chatParamsFromRequest(request);
  const stream = chat({ adapter: openaiText("gpt-4o-mini"), messages, threadId, runId });
  return toServerSentEventsResponse(stream);
}
```

Set `OPENAI_API_KEY` in your server environment. The adapter and the key stay in the server bundle.

`toServerSentEventsResponse` streams Server-Sent Events, which Farm leaves uncompressed so tokens arrive as they are generated. `toHttpResponse` (newline-delimited JSON) also works; Farm may compress it in production, but still flushes every chunk.

For long generations on serverless targets, raise the route's limit with [`export const maxDuration`](/docs/route-runtime).

## Add tools

Define each tool once, as a schema shared by the server and the browser:

**src/lib/tools.ts**

```ts
import { toolDefinition } from "@tanstack/ai/client";
import { z } from "zod";

export const getFarmFact = toolDefinition({
  name: "get_farm_fact",
  description: "Look up a fact about Farm.js.",
  inputSchema: z.object({ topic: z.enum(["renderers", "deploy", "agents"]) }),
  outputSchema: z.object({ topic: z.string(), fact: z.string() }),
});

export const setAccent = toolDefinition({
  name: "set_accent",
  description: "Change the accent color of the page.",
  inputSchema: z.object({ color: z.enum(["green", "blue", "orange", "pink"]) }),
  outputSchema: z.object({ applied: z.string() }),
});
```

Import the definitions from `@tanstack/ai/client`, so a browser component can import the same file without pulling server code into its bundle.

### Server tools

Implement a server tool with `.server()` and pass it to `chat()`. Pass a browser tool as the bare definition; the model calls it, and the browser runs it.

**src/app/api/chat/route.ts**

```ts
import { chat, chatParamsFromRequest, toServerSentEventsResponse } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { getFarmFact, setAccent } from "../../../lib/tools";

const FACTS = {
  renderers: "Farm.js renders with React, Preact, Solid, Vue, and Svelte.",
  deploy: "Farm.js builds through Nitro to Vercel, Netlify, Cloudflare, Node, and more.",
  agents: "Farm.js apps serve Markdown mirrors and llms.txt, and expose routes as MCP tools.",
} as const;

export async function POST(request: Request) {
  const { messages, threadId, runId } = await chatParamsFromRequest(request);
  const stream = chat({
    adapter: openaiText("gpt-4o-mini"),
    messages,
    threadId,
    runId,
    tools: [getFarmFact.server(async ({ topic }) => ({ topic, fact: FACTS[topic] })), setAccent],
  });
  return toServerSentEventsResponse(stream);
}
```

### Browser tools

Implement the browser side with `.client()` and pass it to `useChat`. TanStack AI runs it in the browser and resumes the run with the result.

**src/app/chat.tsx**

```tsx
"use client";

import { clientTools, fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { setAccent } from "../lib/tools";

const ACCENTS = { green: "#8ce0b5", blue: "#8cb8ff", orange: "#ffb27a", pink: "#ff9ad5" } as const;

const tools = clientTools(
  setAccent.client(({ color }) => {
    document.documentElement.style.setProperty("--accent", ACCENTS[color]);
    return { applied: color };
  }),
);

export function Chat() {
  const { messages, sendMessage, isLoading, stop } = useChat({
    connection: fetchServerSentEvents("/api/chat"),
    tools,
  });
  // Render messages[].parts and an input that calls sendMessage(text).
}
```

## Other renderers

The chat route does not change between renderers; only the component does. In Svelte:

**src/app/page.svelte**

```svelte
<script lang="ts">
  import { createChat, fetchServerSentEvents } from "@tanstack/ai-svelte";

  const chat = createChat({ connection: fetchServerSentEvents("/api/chat") });
</script>
```

Vue, Solid, and Preact use `useChat` from their own TanStack AI package, with the same options.

## Use your app's MCP tools

Farm can [publish API routes as MCP tools](/docs/plugins/mcp), and TanStack AI can use any MCP server as a tool source. Together, the model in your chat calls your real API routes, with their validation and authorization.

### 1. Publish routes as MCP tools

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { GET as listProjects } from "./src/app/api/projects/route";

export default defineConfig({
  mcp: {
    name: "projects",
    tools: [
      {
        endpoint: listProjects,
        name: "list_projects",
        description: "List projects, optionally filtered by status.",
      },
    ],
    authorize: ({ request }) =>
      request.headers.get("authorization") === `Bearer ${process.env.MCP_TOKEN}`
        ? { subject: "chat-agent" }
        : false,
  },
});
```

`listProjects` is an ordinary endpoint:

**src/app/api/projects/route.ts**

```ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { projects } from "../../../lib/projects";

export const GET = createEndpoint(
  "/api/projects",
  {
    method: "GET",
    query: z.object({ status: z.enum(["active", "planned"]).optional() }),
  },
  async ({ query }) => ({
    projects: query.status ? projects.filter((p) => p.status === query.status) : projects,
  }),
);
```

### 2. Hand the MCP server to `chat()`

```bash
pnpm add @tanstack/ai-mcp @modelcontextprotocol/sdk
```

**src/app/api/chat/route.ts**

```ts
import { chat, chatParamsFromRequest, toServerSentEventsResponse } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { createMCPClient } from "@tanstack/ai-mcp";

export async function POST(request: Request) {
  const { messages, threadId, runId } = await chatParamsFromRequest(request);

  const projectsServer = await createMCPClient({
    transport: {
      type: "http",
      url: new URL("/api/mcp", request.url).href,
      headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` },
    },
  });

  const stream = chat({
    adapter: openaiText("gpt-4o-mini"),
    messages,
    threadId,
    runId,
    mcp: { clients: [projectsServer], connection: "close" },
  });
  return toServerSentEventsResponse(stream);
}
```

When a user asks "Which projects are active?":

1. `chat()` connects to `/api/mcp` and finds `list_projects` and its input schema.
2. The model calls `list_projects` with `{ "status": "active" }`.
3. Farm checks `authorize`, validates the input against the route's schema, and runs `GET /api/projects`.
4. The result goes back to the model, which answers. `connection: "close"` closes the MCP connection when the run ends.

Keep `MCP_TOKEN` on the server. Calling your own MCP server goes out over HTTP and back in, so external agents and your chat use the same path.

### Browser tools with WebMCP

TanStack AI's `registerWebMCPTools` and Farm's [WebMCP plugin](/docs/plugins/webmcp) both register tools through `document.modelContext`, so they can run on the same page. Give their tools distinct names.

## Try it without an API key

The example picks its model from the environment: `OPENAI_API_KEY` for OpenAI, or `AI_BASE_URL` (with `AI_MODEL`) for any OpenAI-compatible endpoint, such as Ollama, OpenRouter, or Groq. It also ships a mock model for local runs and tests:

```bash
cd examples/tanstack-ai-chat
node --experimental-strip-types test/serve-mock.ts   # prints AI_BASE_URL=...
AI_BASE_URL=<that url> pnpm dev
```

## Notes

- **Cancellation.** Pass `request.signal` to `chat()` through an `AbortController` so the model stops when the user leaves. The example's route shows how.
- **WebSockets.** TanStack AI's WebSocket transport needs a socket upgrade, which Farm API routes do not expose. Use Server-Sent Events or the HTTP stream transport.
- **Resumable streams.** TanStack AI's in-memory run store keeps state in one process. On serverless targets, a resumed stream can reach a different instance; back it with shared storage before relying on it.
