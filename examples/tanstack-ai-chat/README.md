# Farm.js + TanStack AI

A streaming chat on a Farm.js API route using [TanStack AI](https://tanstack.com/ai), with one server tool and one tool that runs in the browser.

- `src/app/api/chat/route.ts`: the route. TanStack AI reads the `Request` and returns a streaming `Response`, which is exactly the shape of a Farm API route, so no adapter is needed.
- `src/lib/tools.ts`: tool definitions shared by the server and the browser (schemas only).
- `src/app/chat.tsx`: the page, using `useChat` from `@tanstack/ai-react` and the browser implementation of `set_accent`.
- `src/lib/model.server.ts`: picks the model. Provider SDKs and keys stay on the server.

## Run it

With OpenAI:

```bash
OPENAI_API_KEY=... pnpm dev
```

With any OpenAI-compatible endpoint (Ollama, OpenRouter, Groq, LM Studio):

```bash
AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=llama3.2 pnpm dev
```

Without a key, use the bundled mock model:

```bash
node --experimental-strip-types test/serve-mock.ts   # prints AI_BASE_URL=...
AI_BASE_URL=<that url> pnpm dev
```

Then ask "What renderers does Farm support?" (server tool) or "Make the page pink" (browser tool).

## Notes

- TanStack AI needs Zod 4.2 or newer for tool schemas, so this example pins Zod 4.6.5.
- `pnpm test` runs the route against the mock model: the server tool's result reaches the model, the browser tool is handed back to the client, and a missing model answers 503.
