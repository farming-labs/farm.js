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

## Result shape

API and integration callers return a consistent result object:

```ts
const result = await api.hello.post({
  body: {
    name: "Ada",
  },
});

if (result.error) {
  console.error(result.error.status);
  return;
}

console.log(result.data.message);
```

This makes client components easier to write because failed responses do not need to be caught with `try/catch` unless you want that behavior.

## Server callers

Use server callers when the operation needs cookies, request headers, server-only credentials, or internal integration dispatch.

```ts
import { createServerAPIClient } from "@farmjs/core/client";
import type { APIRouter } from "./api.generated";

export async function loader(request: Request) {
  const api = createServerAPIClient<APIRouter>({
    request,
  });

  return await api.hello.post({
    body: {
      name: "Ada",
    },
  });
}
```

## Integration callers

Integrations use the same ergonomic style:

```ts
const checkout = await apiClient.billing.checkout.post({
  body: {
    productId: "pro",
    successPath: "/dashboard",
  },
});
```

If an integration operation is marked server-only, call it from `api`, not `apiClient`.

## Production notes

- Keep generated API types committed or generated during CI.
- Prefer typed body/query schemas for mutations.
- Use server callers for secrets, auth cookies, and internal-only provider actions.
- Use invalidation after mutations that change cached route data.
- Keep optimistic updates scoped to UI state you can confidently roll back.
