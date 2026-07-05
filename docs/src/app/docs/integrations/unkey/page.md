---
title: "Unkey Integration"
description: "Create, verify, revoke, update, and delete API keys, plus protect routes with key verification and rate-limit checks."
section: "Integrations"
---

# Unkey Integration

Create, verify, revoke, update, and delete API keys, plus protect routes with key verification and rate-limit checks.

## Configure Unkey

**farm.config.ts**

```ts
import { unkey } from "@farmjs/integrations/unkey";

export default defineFarmConfig({
  integrations: {
    keys: unkey({
      rootKey: process.env.UNKEY_ROOT_KEY,
      apiId: process.env.UNKEY_API_ID,
    }),
  },
});
```

## Create and verify keys

**Caller**

```ts
const created = await api.keys.createKey.post({
  body: {
    name: "Production key",
    permissions: ["documents.read"],
  },
});

const verified = await api.keys.verifyKey.post({
  body: {
    key: created.data!.key,
    permissions: "documents.read",
  },
});
```

## Best fit

- API products where customers need their own keys.
- Internal platform keys for service-to-service requests.
- Route protection where key validity, permissions, credits, or rate limits matter.
