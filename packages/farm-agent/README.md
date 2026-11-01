# @farm.js/agent

Durable agents for Farm.js, served and built by [agent-unit](https://github.com/farming-labs/agent-unit)

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

```bash
npm install @farm.js/agent agent-unit
```

```ts
// farm.config.ts
import { agent } from "@farm.js/agent";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  integrations: {
    agent: agent({ storage: { driver: "redis", url: process.env.REDIS_URL } }),
  },
});
```

See the [durable agents guide](https://farmjs.dev/docs/integrations/agent) for agents, the API, storage, and deploy targets.
