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
import { createAPIClient } from "@farm.js/core/client";
import type { APIRouter } from "./api.generated";

export const api = createAPIClient<APIRouter>();
```

The client uses the current origin and `/api` by default. To point every default client at another
API, configure it once in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  api: {
    baseURL: () => process.env.API_ORIGIN,
    basePath: "/api",
  },
});
```

`https://api.example.com` becomes `https://api.example.com/api`. A URL that already has a path,
such as `https://api.example.com/v1`, uses that path directly. `baseURL` and `basePath` may be sync
or async resolver functions; Farm evaluates them during config resolution and embeds only the
resulting public URL.

For a cross-origin API that uses cookies or HTTP authentication, pass the browser fetch credential
mode when creating the client:

```ts
export const api = createAPIClient<APIRouter>({
  baseURL: "https://api.example.com/v1",
  credentials: "include",
});
```

Farm forwards `credentials` to every route request from that client. The API must also allow the
calling origin and credentialed requests through its CORS policy.

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

If a route path contains a lowercase HTTP method segment such as `get`, `post`, or `delete` that
collides with a method on its parent route, the generated client exposes a leading-slash literal
alias so the two cannot be confused:

```ts
// Both src/app/api/users/route.ts and src/app/api/users/get/route.ts export GET.
const result = await api["/users/get"].get();
```

The leading slash marks the whole key as a literal API path. This also works when the method-named
segment is in the middle of a colliding route, for example
`api["/users/get/profile"].post(...)`. Non-conflicting paths keep their ordinary nested form.

A typed `HEAD` route is called with `.head()`. Its result keeps the same `{ data, error, key }`
shape, with `data` set to `undefined` because HTTP HEAD responses do not have a body.

Array-valued query inputs use repeated URL parameters. For example,

```ts
await api.posts.get({ query: { tag: ["react", "vite"] } });
// GET /api/posts?tag=react&tag=vite
```

This is the same array representation that API route query schemas receive.

## Type-safe QUERY requests

A route that exports `QUERY` becomes a `.query()` caller. Its body and response are inferred from
the endpoint, just like the existing `.get()` and `.post()` callers:

```ts
const result = await api.products.search.query(
  {
    body: {
      filters: [{ field: "category", value: "tools" }],
      limit: 20,
    },
  },
  {
    cache: {
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);

if (!result.error) {
  // Inferred from the QUERY handler response.
  console.log(result.data.products, result.data.total);
}
```

TypeScript reports an error if `body` is missing or a filter has the wrong shape. Farm sends the
body as JSON and uses the `QUERY` method on the wire. Opt-in cache keys include the API origin,
path, URL query parameters, request body, `Content-Type`, and `Content-Encoding`. Multipart QUERY
requests need an explicit cache key because a generated multipart boundary cannot be represented
reliably before `fetch` sends the request.

Farm adds `Content-Type: application/json` when it serializes a JSON request body. Bodyless
requests do not receive that header, and an explicitly configured content type takes precedence
regardless of header casing.

## Upload files and consume progress streams

`toFormData()` retains the endpoint's body shape while sending files as real multipart fields. When
an endpoint returns `jsonStream()`, the generated client exposes a typed, single-consumer async
iterable:

```ts
import { toFormData } from "@farm.js/core/api";

const result = await api.imports.post({
  body: toFormData({
    title: "Quarterly report",
    file,
  }),
});

if (result.error) {
  throw result.error;
}

for await (const event of result.data) {
  if (event.phase === "accepted") {
    console.log(`Uploading ${event.bytes} bytes`);
  } else {
    console.log(`Imported ${event.imported} rows`);
  }
}
```

Farm passes the `FormData` object directly to `fetch`, allowing the runtime to generate the required
multipart boundary. Do not set `Content-Type` manually. Stream items are decoded only as the
consumer advances the iterator, and `result.data.cancel()` aborts the response reader when the UI
no longer needs progress.

## Track mutations in React

`useMutation` gives generated API methods and Farm server functions the same pending, result, and
error lifecycle. API methods keep using the typed HTTP client underneath; they are not converted
into React Server Actions.

```tsx
"use client";

import { useMutation } from "@farm.js/core/client";
import { api } from "@/lib/api-client";

export function CreateProductButton() {
  const createProduct = useMutation(api.products.post, {
    request: {
      invalidate: [[api.products.get]],
    },
  });

  return (
    <button
      disabled={createProduct.pending}
      onClick={() =>
        createProduct.mutate({
          body: { name: "Strata", category: "tools" },
        })
      }
    >
      {createProduct.pending ? "Creating..." : "Create product"}
    </button>
  );
}
```

Use `mutate` for event handlers and `mutateAsync` when later code needs the resolved value:

```ts
const product = await createProduct.mutateAsync({
  body: { name, category },
});
```

The return value includes `data`, `error`, `variables`, `status`, `pending`, and `reset`. Pass the
existing API-client cache, retry, invalidation, and optimistic options through `request`. Local
`optimistic` state on `useMutation` is separate from an API cache update: it controls
`mutation.data`, while `request.optimistic` updates shared cached queries.

## Submit without navigation

Use `useFetcher` when a button or form should run an operation without changing the current route.
It accepts generated API methods, Farm server functions, and ordinary async functions:

```tsx
"use client";

import { useFetcher } from "@farm.js/core/client";
import { api } from "@/lib/api-client";

export function CreateProductForm() {
  const createProduct = useFetcher(api.products.post, {
    request: {
      invalidate: [[api.products.get]],
    },
  });

  return (
    <createProduct.Form>
      <input name="name" required />
      <input name="category" required />
      <button disabled={createProduct.pending}>
        {createProduct.pending ? "Creating..." : "Create product"}
      </button>

      {createProduct.error ? <p role="alert">{createProduct.error.message}</p> : null}
      {createProduct.data ? <p>Created {createProduct.data.name}</p> : null}
    </createProduct.Form>
  );
}
```

The fetcher exposes `state` (`idle` or `submitting`), `status`, `pending`, `data`, `error`,
`variables`, the active `formData`, `submit`, `submitAsync`, `Form`, and `reset`. It uses the same
optimistic updates, rollback, callbacks, typed errors, and API-client request options as
`useMutation`.

Generated API forms map fields to `{ body: ... }` by default, or `{ query: ... }` for GET routes.
Use `mapFormData` when the validated input needs coercion or a different shape:

```tsx
const quantity = useFetcher(api.cart.post, {
  mapFormData(formData) {
    return {
      body: {
        productId: String(formData.get("productId")),
        quantity: Number(formData.get("quantity")),
      },
    };
  },
});
```

After hydration, `<fetcher.Form>` prevents navigation and submits through the typed target. For a
server function, the function itself remains the native form action, preserving React's
progressive-enhancement path before JavaScript loads. Generated GET and POST API forms use the
real endpoint URL as their native fallback; a native fallback navigates to the endpoint response,
while the hydrated fetcher stays on the page.

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

Structured keys use Farm's route-data key contract. Default API cache keys include the API origin.
Clients that configure headers or non-default credentials keep their cache private to that client,
and changing that request context clears the private cache. This prevents an authenticated response
from being reused by a client with a different identity without placing credential values in a
public cache key. Clients using the default same-origin request context can still share structured
keys with Farm's route-data cache.

Set `cache.dedupeMs` to join identical requests started within that window. If an older request is
still running after the window expires, the newer request becomes the cache owner; the older result
still returns to its original caller but cannot replace the newer cached value.

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
            products: [{ id: "optimistic", name, category }, ...(current?.products ?? [])],
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
import { createServerAPIClient } from "@farm.js/core/client";
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
import { createServerFn } from "@farm.js/core/server-fn";
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
import { createServerFn, createServerMiddleware } from "@farm.js/core/server-fn";

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

import { useServerFn } from "@farm.js/core/server-fn/client";
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

### Typed server function errors

Declare expected failures next to the input contract. `error` accepts only declared codes, validates
the public payload, and preserves the code, status, and data across the RSC action transport:

```ts
export const updateProduct = createServerFn({
  input: updateProductSchema,

  errors: {
    NOT_FOUND: {
      status: 404,
      data: z.object({ id: z.string() }),
    },
  },

  handler({ input, error }) {
    const product = findProduct(input.id);

    if (!product) {
      return error("NOT_FOUND", { id: input.id });
    }

    return product;
  },
});
```

`useServerFn`, `useMutation`, and `useFetcher` infer the declared error union. Narrow by `name` and
`code` to recover the exact payload:

```tsx
const update = useServerFn(updateProduct);

if (update.error?.name === "ServerFnFailure" && update.error.code === "NOT_FOUND") {
  // id is inferred as string.
  showMissingProduct(update.error.data.id);
}
```

Add an optional `message` only when it is safe to display publicly. Declared error data schemas must
support synchronous `parse()` or `safeParse()` because `error()` throws immediately. Hydrated calls
carry `status` inside the Flight error envelope; progressive form submissions also use it as the HTTP
status. Unexpected exceptions remain sanitized as a generic `ServerActionError`, without their
message, stack, or custom properties.

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
