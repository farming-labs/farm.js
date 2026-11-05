# @farm.js/ai

Vercel AI SDK chat routes for Farm.js. `aiChatRoute()` turns an AI SDK model into a `POST` handler
for an API route: it validates the `useChat` request body, refuses unauthorized and cross-site
callers, and streams the reply in the AI SDK's UI message format.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/ai
```

The AI SDK (`ai`) is a dependency of this package and installs with it. The chat UI imports from
the AI SDK directly, so add it to the app with the React hooks:

```bash
pnpm add ai @ai-sdk/react
```

`farm add integration ai` scaffolds the route at `src/app/api/chat/route.ts`. The scaffold answers
only in development until its `authorize` checks a session. No `farm.config.ts` wiring is needed.

## Usage

```ts
// src/app/api/chat/route.ts
import { aiChatRoute } from "@farm.js/ai";
import { getSession } from "../../../lib/session";

export const POST = aiChatRoute({
  model: "openai/gpt-4o-mini",
  system: "You are a helpful assistant.",
  authorize: async ({ request }) => Boolean(await getSession(request)),
});
```

`getSession` stands for the app's own session check. `model` takes any AI SDK `LanguageModel`. A
model id string such as `"openai/gpt-4o-mini"` goes through the Vercel AI Gateway, which reads
`AI_GATEWAY_API_KEY`; pass a provider model, for example `openai("gpt-4o-mini")` from
`@ai-sdk/openai`, to call the provider directly.

Point `useChat` at the route from a client component:

```tsx
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

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
      <button disabled={status !== "ready"} onClick={() => sendMessage({ text: "Hello" })}>
        Say hello
      </button>
    </div>
  );
}
```

## Request guards

Every request spends the model provider's credits, so the route fails closed:

- `authorize({ request, body })` returns `true` to run the completion, `false` for a `403`, or a
  `Response` to answer with. Without `authorize` the route answers `403`, unless
  `allowUnauthenticated: true` is set because middleware or the edge already gates it.
- A cross-site request gets a `403` before `authorize` runs. Add trusted origins with
  `allowedOrigins`, using the `serverActions.allowedOrigins` syntax. A request with no origin
  metadata, such as a server-to-server call, still reaches `authorize`.
- `system` messages sent by the client are dropped, so a caller cannot replace the app's
  instructions. Set `allowSystemMessages: true` to keep them.
- A body that is not `{ messages: [...] }` with a `role` and `parts` on each message answers `400`.

## File attachments

File parts are accepted only as `data:` URLs, which is what `useChat` sends for attached files. A
`file` or `reasoning-file` part with any other URL answers `400`, and the server fetches no file URL
the model messages carry, so a visitor cannot make it request an internal address. To accept files
you host, allow their URLs:

```ts
export const POST = aiChatRoute({
  model: "openai/gpt-4o-mini",
  authorize: async ({ request }) => Boolean(await getSession(request)),
  allowFileUrls: (url) => url.origin === "https://files.example.com",
});
```

`allowFileUrls: true` restores the AI SDK's default download behavior. The function sees only the
requested URL, so allow an origin that does not redirect elsewhere.

## Options

| Option                          | Description                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `model`                         | Required. AI SDK `LanguageModel` or model id string.                                 |
| `authorize`                     | Decides each request. Returns `true`, `false`, or a `Response`.                      |
| `allowUnauthenticated`          | Serve without `authorize`. Default `false`.                                          |
| `allowedOrigins`                | Extra trusted origins for the cross-site check.                                      |
| `allowSystemMessages`           | Keep client `system` messages. Default `false`.                                      |
| `allowFileUrls`                 | `true`, or a function that accepts hosted file URLs. Default: `data:` URLs only.     |
| `system`, `instructions`        | Passed to `streamText`.                                                              |
| `options`                       | Other `streamText` options, such as `tools`. `model`, `messages`, `prompt` excluded. |
| `prepare`                       | Per request `streamText` options from `{ request, body, messages, modelMessages }`.  |
| `selectMessages`                | `(body, request) => messages`, to choose which messages reach the model.             |
| `responseOptions`               | Options for `toUIMessageStreamResponse`, or a function returning them.               |
| `convertToModelMessagesOptions` | Passed to the AI SDK's `convertToModelMessages`.                                     |

`createAIChatRoute` and `defineAIChatRoute` are aliases of `aiChatRoute`. The body validator is
exported as `aiChatRequestBodySchema`, with `parse` and `safeParse`.

## Documentation

- [Agent frameworks](https://farmjs.dev/docs/integrations/agent-frameworks): chat routes with the
  AI SDK, Mastra, LangGraph, and the OpenAI Agents SDK, and the shared chat UI.

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
