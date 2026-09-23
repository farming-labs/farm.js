# `@farm.js/scripts`

Typed, lifecycle-aware third-party browser scripts for Farm.js.

Use this plugin when a browser SDK arrives through an external `<script>` and exposes a global.
Farm owns when that script loads, deduplicates concurrent requests, waits for readiness, and gives
application code a typed handle instead of an ambient `window.vendor` access.

```bash
pnpm add @farm.js/scripts
```

```ts
// src/lib/scripts.ts
import { defineScript } from "@farm.js/scripts/client";

interface SupportChatSDK {
  load(options: { userId: string }): void;
  open(): void;
}

export const supportChat = defineScript<SupportChatSDK>({
  name: "support-chat",
  src: "https://cdn.example.com/chat.js",
  global: "SupportChat",
  load: "manual",
  preconnect: true,
});
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { scripts } from "@farm.js/scripts";
import { supportChat } from "./src/lib/scripts";

export default defineConfig({
  plugins: [scripts({ scripts: [supportChat] })],
});
```

```ts
await supportChat.use((sdk) => {
  sdk.load({ userId: "user_123" });
  sdk.open();
});
```

Built-in load strategies are `immediate`, `after-hydration`, `idle`, `interaction`, `manual`, and
element visibility. Definitions can also declare consent categories, dependency order, retries,
timeouts, preconnect hints, module scripts, SRI, CORS, referrer policy, fetch priority, and vendor
`data-*` attributes.

See the [Farm Scripts documentation](https://farmjs.dev/docs/plugins/scripts) for all options,
recipes, consent behavior, and limits.
