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

Use a structured cache key when an API response intentionally shares data with route data or a [`createServerQuery`](/docs/server-queries):

```ts
const product = await api.products.get(
  { query: { id } },
  {
    cache: {
      key: ["product", id],
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);
```

Structured keys use Farm's route-data key contract. Default API cache keys include the API origin and remain isolated from other clients.

## Optimistic cache updates

Farm's cache lifecycle is intentionally familiar to React Query and TanStack Query users, but it is
implemented by Farm's own typed API client and shared cache. A mutation can update an existing
query result immediately, roll it back after an error, and invalidate it after the server responds.

```ts
const products = await api.products.get(
  { query: { category } },
  {
    cache: {
      key: ["products", category],
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);

const createProduct = api.products.post(
  {
    body: {
      name,
      category,
    },
  },
  {
    optimistic: {
      update: [
        [
          products.key,
          (current) => ({
            ...current,
            products: [
              { id: "optimistic", name, category },
              ...(current?.products ?? []),
            ],
          }),
        ],
      ],
      rollbackOnError: true,
    },
    invalidate: [products.key],
  },
);

await createProduct;
```

The updater runs synchronously before the POST finishes. `products.key` preserves the cached
response type, so `current` is inferred from `api.products.get`. You can also target a generated
route directly with `[api.products.get, { query: { category } }, updater]`.

With `rollbackOnError: true`, Farm restores the exact previous cache entry when the mutation fails.
After the request settles, invalidation marks the key stale so mounted consumers or the next read
can load the canonical server result.

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
  output: z.object({
    todos: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
      }),
    ),
  }),
  async handler({ input, signal }) {
    signal.throwIfAborted();
    return {
      todos: await db.todo.create({ data: input }),
    };
  },
});
```

`input` validates values before the handler runs. An optional `output` schema validates the
resolved handler result before it crosses the server-function boundary. Its parsed type becomes
the function's return type, and schema transforms are supported:

```ts
const PublicUser = z.object({
  id: z.string(),
  email: z.string().email(),
});

export const getUser = createServerFn({
  input: z.object({ id: z.string() }),
  output: PublicUser,
  async handler({ input }) {
    // PublicUser strips passwordHash before this result can reach the browser.
    return db.user.findUniqueOrThrow({ where: { id: input.id } });
  },
});
```

Output parsing also runs for direct server calls, form actions, and browser calls. Invalid results
reject the function just like invalid input. Keep the output contract narrow for private data;
do not rely on TypeScript alone to prevent an extra database field from being returned at runtime.

### Composable middleware

Use `createServerMiddleware` for server-only behavior shared by several functions, such as session
loading, authorization, transactions, rate limits, and auditing. Middleware can depend on other
middleware, and every context value is inferred by functions that install it.

```ts
import { createServerFn, createServerMiddleware } from "@farmjs/core/server-fn";

const withSession = createServerMiddleware({
  async handler({ request, next }) {
    if (!request) throw new Error("A request is required");

    const session = await getSession(request);
    if (!session.user) throw new UnauthorizedError();

    return next({ context: { session } });
  },
});

const withTransaction = createServerMiddleware({
  middleware: [withSession],
  async handler({ context, next }) {
    return db.transaction((tx) => next({ context: { tx } }));
  },
});

export const renameProject = createServerFn({
  middleware: [withTransaction],
  input: z.object({ projectId: z.string(), name: z.string().min(1) }),
  async handler({ input, context }) {
    // context.session and context.tx are both typed.
    await requireProjectEditor(context.session, input.projectId);
    return context.tx.project.update({
      where: { id: input.projectId },
      data: { name: input.name },
    });
  },
});
```

Dependencies run first and are de-duplicated by middleware identity. For
`middleware: [withTransaction, withAudit]`, a shared `withSession` dependency runs once. The chain
uses onion ordering: code before `await next()` runs from outer to inner, and code after it unwinds
from inner to outer.

Every middleware must call `next()` exactly once and return its result. Throw to reject a request;
middleware cannot silently skip the handler. Input validation finishes before the chain starts,
while output validation runs after the whole chain unwinds. Context is created on the server,
shallowly frozen, and never accepted from the browser.

Keep shared authentication in middleware, but still perform resource-specific authorization where
the resource is loaded. Derive identities, roles, tenant IDs, and rate-limit keys from the trusted
request or server state, never from unvalidated client fields. Middleware errors use the same
sanitized server-action error boundary as handler errors.

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

When the function is called from the browser, `request` is the underlying Web `Request` and `signal` aborts with that request. A direct call made while rendering can inherit the current render request; a background or direct call outside request scope has no `request` and receives a stable, non-aborted signal. The same values are available to middleware. Pass `signal` to database or network clients that support cancellation.

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
- Add narrow output schemas to functions that return private database records.
