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
import { defineConfig } from "@farm.js/core";
import { unkey } from "@farm.js/integrations/unkey";

export default defineConfig({
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
const created = await api.keys.create.post({
  body: {
    name: "Production key",
    permissions: ["documents.read"],
  },
});

const verified = await api.keys.verify.post({
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

## What Unkey adds

| Area       | Details                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| Create     | Server-only route for creating customer or service keys.                          |
| Verify     | Server-only route for checking validity, permissions, credits, and rate limits.   |
| Update     | Server-only route for changing metadata, roles, permissions, credits, and limits. |
| Revoke     | Server-only route for disabling a key without deleting its record.                |
| Delete     | Server-only route for deleting a key when the app no longer needs it.             |
| Middleware | Optional protected route matcher that verifies request keys before app code runs. |

## Server-only callers

Unkey mutation and verification callers are marked as server-only. Use `api` from `createIntegrations`, not `apiClient` in browser components.

```ts
import { api } from "../lib/api";

export async function createCustomerKey(userId: string) {
  const created = await api.keys.create.post({
    body: {
      externalId: userId,
      permissions: ["documents.read"],
      ratelimits: [
        {
          name: "documents",
          limit: 1000,
          duration: 60_000,
        },
      ],
    },
  });

  return created.data;
}
```

## Protect routes

```ts
unkey({
  rootKey: process.env.UNKEY_ROOT_KEY,
  apiId: process.env.UNKEY_API_ID,
  protectedRoutes: ["/api/public/[...path]"],
  protection: {
    header: "authorization",
    permissions: ["documents.read"],
  },
});
```

When a request matches `protectedRoutes`, the integration verifies the key before the route handler runs.

## Production notes

- Keep `UNKEY_ROOT_KEY` server-only.
- Use server callers for key creation and verification.
- Prefer permissions and ratelimits over one global "valid key" check.
- Revoke keys before deleting them when users may need an audit trail.
- Test expired keys, missing permissions, exhausted credits, and rate-limit failures.
