# @farm.js/federation

Publish and consume independently deployed browser modules from Farm applications.

```bash
pnpm add @farm.js/federation
```

```ts
import { defineConfig } from "@farm.js/core";
import { federation } from "@farm.js/federation";

export default defineConfig({
  plugins: [
    federation({
      name: "storefront",
      remotes: {
        checkout: "https://checkout.example.com/mf-manifest.json",
      },
    }),
  ],
});
```

Load configured modules after hydration:

```ts
import { loadRemote } from "@farm.js/federation/client";

const checkout = await loadRemote("checkout/UpgradeCard");
```

The first release is deliberately browser-only. Server functions, API handlers, Server
Components, credentials, and other server capabilities stay local to each application. Server
federation is being designed in [RFC #885](https://github.com/farming-labs/farm.js/issues/885).

Read the [Federation Plugin guide](https://farmjs.dev/docs/plugins/federation) for producer setup,
typed loading, shared dependencies, deployment, and security guidance.
