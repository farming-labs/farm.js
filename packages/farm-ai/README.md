# @farm.js/ai

Farm.js AI route helpers

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

```bash
npm install @farm.js/ai
```

```ts
// src/app/api/chat/route.ts
import { aiChatRoute } from "@farm.js/ai";

export const POST = aiChatRoute({
  model: "openai/gpt-4o-mini",
  // Required: every request spends your model credits. Without authorize the
  // route answers 403 unless allowUnauthenticated is true.
  authorize: async ({ request }) => Boolean(await getSession(request)),
});
```

Cross-site requests get a 403, and `system` messages from the client are dropped unless
`allowSystemMessages: true`.

See the [Farm.js repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.
