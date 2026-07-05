---
title: "API Client"
description: "Call app API routes with api.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates."
section: "Data and APIs"
---

# API Client

Call app API routes with api.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates.

## Create the client

**src/lib/api-client.ts**

```ts
import { createAPIClient } from "@farmjs/core/client";
import type { APIRouter } from "./api.generated";

export const api = createAPIClient<APIRouter>();
```

## Call a route

**Browser usage**

```ts
const result = await api.hello.post({
  body: { name: "Ada" },
});

if (result.error) {
  console.error(result.error);
} else {
  console.log(result.data.message);
}
```

## Client options

- cache: choose cache-first, network-only, or stale-while-revalidate.
- retry: retry transient failures with count and delay.
- invalidate: mark typed route keys stale after mutations.
- optimistic: update cached query data before the server response returns.
- onRequest, onResponse, onSuccess, onError, onSettled, and onStatus: observe the full client lifecycle.
