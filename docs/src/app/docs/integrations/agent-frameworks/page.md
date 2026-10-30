---
title: "Agent Frameworks"
description: "Run AI SDK, Mastra, LangGraph, the OpenAI Agents SDK, or any other agent framework in a Farm API route, with one chat UI."
section: "Integrations"
---

# Agent Frameworks

Farm works with any JavaScript agent framework without an adapter. An API route receives a Web `Request` and returns a `Response`, and every major agent framework can return its stream as a `Response`. Define the agent in a server module, call it from a route, and render it with a chat UI.

This page shows the [AI SDK](https://ai-sdk.dev), [Mastra](https://mastra.ai), [LangGraph](https://langchain-ai.github.io/langgraphjs/), and the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/). All four can stream the AI SDK's UI message format, so one chat component works with every one of them.

## How it fits together

| Piece                                 | Where                                | Runs on     |
| ------------------------------------- | ------------------------------------ | ----------- |
| The agent: model, instructions, tools | `src/agents/*.ts`                    | Server only |
| The route that runs it                | `src/app/api/agents/<name>/route.ts` | Server      |
| The chat UI                           | A `"use client"` component           | Browser     |

Keep provider keys in server environment variables, for example `OPENAI_API_KEY` in `.env`. Import agent modules only from routes and other server code, never from a client component, so keys and tool code stay out of the browser bundle.

## The chat UI

Install the AI SDK's React hooks:

```bash
pnpm add ai @ai-sdk/react
```

**src/components/chat.tsx**

```tsx
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

export function Chat({ api }: { api: string }) {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api }),
  });
  const [input, setInput] = useState("");

  return (
    <div>
      {messages.map((message) => (
        <p key={message.id}>
          {message.role}:{" "}
          {message.parts.map((part, index) =>
            part.type === "text" ? <span key={index}>{part.text}</span> : null,
          )}
        </p>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input value={input} onChange={(event) => setInput(event.target.value)} />
        <button type="submit" disabled={status !== "ready"}>
          Send
        </button>
      </form>
    </div>
  );
}
```

Point `api` at any of the routes below, for example `<Chat api="/api/agents/support" />`.

## AI SDK

```bash
pnpm add ai @ai-sdk/openai zod
```

**src/agents/support.ts**

```ts
import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";

export const supportAgent = new ToolLoopAgent({
  model: openai("gpt-4.1-mini"),
  instructions: "You help customers with their orders.",
  tools: {
    getOrder: tool({
      description: "Look up an order by id",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => db.orders.find(id),
    }),
  },
  stopWhen: stepCountIs(5),
});
```

**src/app/api/agents/support/route.ts**

```ts
import { createAgentUIStreamResponse } from "ai";
import { supportAgent } from "../../../../agents/support";

export async function POST(request: Request) {
  const { messages } = await request.json();
  return createAgentUIStreamResponse({
    agent: supportAgent,
    uiMessages: messages,
    abortSignal: request.signal,
  });
}
```

`abortSignal: request.signal` stops the model when the visitor closes the page. For a chat route without tools, [`@farm.js/ai`](/docs/integrations) provides `aiChatRoute()`.

Every `aiChatRoute()` request spends your model provider's credits, so the route needs an
`authorize` hook. Without one it answers 403, unless you set `allowUnauthenticated: true` because
middleware or the edge already gates the route. `authorize` receives `{ request, body }` and returns
`true` to run the completion, `false` for a 403, or a `Response` to answer with:

```ts
import { aiChatRoute } from "@farm.js/ai";
import { getSession } from "../../../lib/session";

export const POST = aiChatRoute({
  model: "openai/gpt-4o-mini",
  system: "You are a helpful assistant.",
  authorize: async ({ request }) => Boolean(await getSession(request)),
});
```

The route also answers 403 to a cross-site request (add trusted origins with `allowedOrigins`), and
drops `system` messages the client sends so a caller cannot replace your instructions. Set
`allowSystemMessages: true` to keep them. The AI starter (`--template ai` and
`farm add integration ai`) authorizes only in development until you check a session in its
`authorize`.

`aiChatRoute()` accepts file attachments only as `data:` URLs, which is what `useChat` sends for
attached files. A `file` or `reasoning-file` part with any other URL answers 400, and the server
fetches no file URL that model messages carry, so a visitor cannot make it request an internal
address. To accept files you host, allow their URLs:

```ts
import { aiChatRoute } from "@farm.js/ai";

export const POST = aiChatRoute({
  model: "openai/gpt-4o-mini",
  authorize: async ({ request }) => Boolean(await getSession(request)),
  allowFileUrls: (url) => url.origin === "https://files.example.com",
});
```

`allowFileUrls: true` accepts every URL, as the AI SDK does by default. The function sees the
requested URL only, so allow an origin that does not redirect elsewhere. An
`experimental_download` you pass in `options` or `prepare` replaces this check.

## Mastra

```bash
pnpm add @mastra/core @mastra/ai-sdk ai
```

**src/mastra/index.ts**

```ts
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";

const supportAgent = new Agent({
  id: "support",
  name: "Support",
  instructions: "You help customers with their orders.",
  model: "openai/gpt-4.1-mini",
});

export const mastra = new Mastra({ agents: { supportAgent } });
```

**src/app/api/agents/mastra/route.ts**

```ts
import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra } from "../../../../mastra";

export async function POST(request: Request) {
  const params = await request.json();
  const stream = await handleChatStream({ mastra, agentId: "support", params, version: "v7" });
  return createUIMessageStreamResponse({ stream });
}
```

`version: "v7"` matches the message format of `ai` 7. Without it, `handleChatStream` streams the older v5 format.

Mastra keeps memory and workflow state in its own storage. Without a `storage` option it uses memory and logs a warning, so configure a persistent Mastra store before production.

## LangGraph

```bash
pnpm add langchain @langchain/core @langchain/openai @ai-sdk/langchain ai zod
```

**src/agents/research.ts**

```ts
import { createAgent, tool } from "langchain";
import { z } from "zod";

const search = tool(async ({ query }) => searchTheWeb(query), {
  name: "search",
  description: "Search the web",
  schema: z.object({ query: z.string() }),
});

export const researchAgent = createAgent({
  model: "openai:gpt-4.1-mini",
  systemPrompt: "You research questions step by step.",
  tools: [search],
});
```

**src/app/api/agents/research/route.ts**

```ts
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse } from "ai";
import { researchAgent } from "../../../../agents/research";

export async function POST(request: Request) {
  const { messages } = await request.json();
  const stream = await researchAgent.stream(
    { messages: await toBaseMessages(messages) },
    { streamMode: ["values", "messages"] },
  );
  return createUIMessageStreamResponse({ stream: toUIMessageStream(stream) });
}
```

A graph you build yourself with `StateGraph` works the same way: pass its compiled graph's `.stream()` result to `toUIMessageStream`.

## OpenAI Agents SDK

```bash
pnpm add @openai/agents @openai/agents-extensions ai
```

**src/agents/triage.ts**

```ts
import { Agent } from "@openai/agents";

export const triageAgent = new Agent({
  name: "Triage",
  instructions: "Route the customer to the right answer.",
  model: "gpt-4.1-mini",
});
```

**src/app/api/agents/triage/route.ts**

```ts
import { run } from "@openai/agents";
import { createAiSdkUiMessageStreamResponse } from "@openai/agents-extensions/ai-sdk-ui";
import type { UIMessage } from "ai";
import { triageAgent } from "../../../../agents/triage";

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const text = messages
    .at(-1)!
    .parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  const result = await run(triageAgent, text, { stream: true });
  return createAiSdkUiMessageStreamResponse(result);
}
```

This route sends the agent the latest message. To keep a conversation, store the run's history (`result.history`) and pass it as the input of the next `run()`.

## Other frameworks

Any framework that produces a `Response`, a `ReadableStream`, or an async iterable fits the same shape: run it in a route and return the stream. Frameworks that ship their own server, such as an Eve agent or a Cloudflare Agents Durable Object, run beside Farm instead; see [Eve](/docs/integrations/eve) and [Cloudflare Agents](/docs/integrations/cf-agent).

## Production notes

- **Errors.** The AI SDK replaces stream errors with "An error occurred." before they reach the browser, so a failing model call is easy to miss. Log the error and choose the message the visitor sees with `onError`:

  ```ts
  return createAgentUIStreamResponse({
    agent: supportAgent,
    uiMessages: messages,
    abortSignal: request.signal,
    onError: (error) => {
      console.error(error);
      return "The assistant is unavailable right now.";
    },
  });
  ```

- **Long runs.** A route lives as long as its request. For work that outlasts the request or must survive a restart, hand it to [jobs](/docs/integrations/jobs) or to the framework's own durable runtime.
