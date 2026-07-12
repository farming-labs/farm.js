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

## Server Function Form Actions

`createServerFn` pairs with `useServerFn` when a mutation is naturally a form action. Use `optimistic` to show the next UI state immediately, then let the server result replace it when the action completes.

**src/actions/todos.ts**

```ts
import { createServerFn } from "@farmjs/core/server-fn";
import { z } from "zod";

export const addTodo = createServerFn({
  input: z.object({
    title: z.string().min(1),
  }),
  async handler({ input, signal }) {
    signal.throwIfAborted();
    return {
      todos: await db.todo.create({ data: input }),
    };
  },
});
```

**src/components/todo-form.tsx**

```tsx
"use client";

import { useServerFn } from "@farmjs/core/server-fn/client";
import { addTodo } from "../actions/todos";

export function TodoForm() {
  const action = useServerFn(addTodo, {
    initialResult: { todos: [] },
    rollbackOnError: true,
    optimistic({ current, formData }) {
      return {
        todos: [
          ...(current?.todos ?? []),
          { id: "draft", title: String(formData?.get("title") ?? "") },
        ],
      };
    },
  });

  return (
    <form action={action.formAction}>
      <input name="title" />
      <button disabled={action.pending}>Add</button>
    </form>
  );
}
```

The optimistic callback receives the raw input, `formData` for form submissions, and the current result. Return `undefined` when a submission should not change the optimistic result. Use `rollbackOnError` for reversible UI state; keep authorization and validation on the server function itself.

When the function is called from the browser, `request` is the underlying Web `Request` and `signal` aborts with that request. A direct server-side call has no `request` and receives a stable, non-aborted signal. Pass `signal` to database or network clients that support cancellation.

Farm validates action origin metadata, accepted form/RSC content types, action ID shape, and request size before decoding an action. Browser calls use same-origin credentials and refuse redirects. Unexpected thrown values are logged on the server but become a generic `ServerActionError` in the browser, so secrets and stack traces are not serialized.

Return typed expected failures instead of throwing messages that the UI needs to display:

```ts
export const renameProject = createServerFn({
  input: renameProjectSchema,
  async handler({ input }) {
    const session = await requireSession();
    if (!session.canEdit(input.projectId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }

    await updateProject(input);
    return { ok: true as const };
  },
});
```

Action references identify which function to execute; they are not authorization tokens. Check authentication, roles, tenant ownership, and resource access inside every action that reads or changes private data.

## Production notes

- Keep generated API types committed or generated during CI.
- Prefer typed body/query schemas for mutations.
- Use server callers for secrets, auth cookies, and internal-only provider actions.
- Use invalidation after mutations that change cached route data.
- Keep optimistic updates scoped to UI state you can confidently roll back.
- Keep `serverActions.allowedOrigins` narrow and use API routes for intentionally cross-origin callers.
- Return typed expected failures; reserve thrown errors for unexpected failures.
