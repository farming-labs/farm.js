---
title: "API Client"
description: "Call app API routes with apiClient.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates."
section: "Data and APIs"
---

# API Client

Call app API routes with apiClient.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates.

## Create both callers once

**src/lib/api.ts**

```ts
import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
```

Define each endpoint once in a file route or plugin. This shared module imports only generated
paths/methods and types, never server handlers or credentials. Import `api` in server code and
`apiClient` in browser code; do not create another caller in either component.

Both app-route callers return `{ data, error, key }` and preserve the same input, output, method,
and dynamic-parameter inference. Keep secrets out of this shared module, including its options.

If the app also has integrations, add `AppIntegrations` as the second type argument to this same
factory. You do not need a second caller setup. See [Integration callers](#integration-callers).

The HTTP client uses the current origin and `/api` by default. To point every default client at another
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
export const { api, apiClient } = createApiClients<APIRouter>({
  baseURL: "https://api.example.com/v1",
  credentials: "include",
});
```

Farm forwards `credentials` to every route request from that client. The API must also allow the
calling origin and credentialed requests through its CORS policy.

## Call a route

**Browser usage**

```ts
const result = await apiClient.hello.post({
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
const result = await apiClient["/users/get"].get();
```

The leading slash marks the whole key as a literal API path. This also works when the method-named
segment is in the middle of a colliding route, for example
`apiClient["/users/get/profile"].post(...)`. Non-conflicting paths keep their ordinary nested form.

A typed `HEAD` route is called with `.head()`. Its result keeps the same `{ data, error, key }`
shape, with `data` set to `undefined` because HTTP HEAD responses do not have a body.

Array-valued query inputs use repeated URL parameters. For example,

```ts
await apiClient.posts.get({ query: { tag: ["react", "vite"] } });
// GET /api/posts?tag=react&tag=vite
```

This is the same array representation that API route query schemas receive.

## Scoped dynamic routes

`farm generate`, development startup, and production builds emit `apiRoutes` alongside
`APIRouter` in `src/lib/api.generated.ts`. Pass that manifest to enable parameter resolution:

```ts
import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
```

For `POST /api/projects/[projectId]/uploads/[uploadId]`:

```ts
const project = apiClient.projects.$params({ projectId: "project-123" });

const result = await project.uploads.post({
  params: { uploadId: "upload-456" },
  body: { title: "Design draft" },
});

if (result.error) throw result.error;
console.log(result.data?.title);
```

`$params()` returns a reusable, immutable caller and sends no request. Only the explicit HTTP
method executes the call. Bound parameters do not have to be repeated and cannot be overwritten
by a descendant call. You can bind the final parameter as well:

```ts
const upload = project.uploads.$params({ uploadId: "upload-456" });
await upload.post({ body: { title: "Updated draft" } });
```

The generated types describe registered methods, required parameters, validated input, and JSON
response data. The runtime manifest contains only paths and methods; importing it never imports
the config, server handlers, validators, or credentials into the browser. Existing static clients
without a manifest remain supported.

Binding preserves position: `/files/[id]/versions` uses
`apiClient.files.$params({ id }).versions.get()`, while `/files/versions/[id]` uses
`apiClient.files.versions.get({ params: { id } })`. Catch-all parameters use arrays:
`apiClient.docs.$params({ parts: ["guides", "start"] }).get()` for `/api/docs/[...parts]`.
Optional catch-alls can bind an empty object. Intermediate parameters must be bound before
accessing their children through the shorthand; existing bracket-pattern access remains available.

The client encodes parameter values, respects the configured API base URL/path, and rejects
missing/unknown parameters, unsafe values, unregistered methods, and ambiguous calls before
fetching. A supplied `undefined` ID never falls back to a collection request. Static server
routes still win: if `/api/uploads/stats` exists, calling `/api/uploads/[id]` with `id: "stats"`
throws a shadowing error rather than calling the wrong endpoint. Choose non-conflicting IDs or paths.

Resolved URLs participate in caching and invalidation, so different bound IDs remain separate.
Bind the final parameter before passing a route reference to a hook or invalidation helper when
you need one concrete resource; collection/detail overloads otherwise describe multiple inputs.
Plugin paths containing HTTP method names use a literal alias such as
`apiClient["/projects/get"].get()`. `$params` is reserved for the scope helper.

Both callers returned by `createApiClients()` support these scopes. Use `api` for local calls
during a Farm server request and `apiClient` for HTTP calls. For standalone HTTP calls from server
code, give `apiClient` a trusted absolute `baseURL` and explicitly forward only the credentials
the target needs. See [Server callers](#server-callers) for local-dispatch boundaries.

## Type-safe QUERY requests

A route that exports `QUERY` becomes a `.query()` caller. Its body and response are inferred from
the endpoint, just like the existing `.get()` and `.post()` callers:

```ts
const result = await apiClient.products.search.query(
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

const result = await apiClient.imports.post({
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
import { apiClient } from "@/lib/api";

export function CreateProductButton() {
  const createProduct = useMutation(apiClient.products.post, {
    request: {
      invalidate: [[apiClient.products.get]],
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
import { apiClient } from "@/lib/api";

export function CreateProductForm() {
  const createProduct = useFetcher(apiClient.products.post, {
    request: {
      invalidate: [[apiClient.products.get]],
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
const quantity = useFetcher(apiClient.cart.post, {
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

`onResponse` is a transport observer. If it throws or returns a rejected promise, Farm reports that
failure through the platform `reportError` hook (or the console fallback) without retrying or
changing the completed API result.

Use a structured cache key when an API response intentionally shares data with route data or a [`createServerQuery`](/docs/server-queries):

```ts
const { apiClient: publicApi } = createApiClients<APIRouter>({ credentials: "omit" });

const product = await publicApi.products.get(
  { query: { id } },
  {
    cache: {
      key: ["product", id],
      scope: "shared",
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);
```

Structured keys use Farm's route-data key contract. Default API cache keys include the API origin.
Same-origin and otherwise credentialed requests keep their cache private to the created client, and
changing explicit headers or credentials clears that private cache. This prevents a new client from
reusing a response produced under an earlier cookie identity without placing credential values in a
public cache key. Invalidate session-specific reads when the same client logs in or out.

Use `scope: "shared"` only for public data requested with `credentials: "omit"` and no custom
headers that intentionally shares a structured key with route data or another API client:

```ts
cache: {
  key: ["catalog", "featured"],
  scope: "shared",
  policy: "cache-first",
}
```

Requests with `credentials: "omit"` and no custom headers may share by default because they carry
no browser identity. `scope: "client"` can keep those requests private as well. Credentialed or
header-carrying requests remain client-scoped even if `scope: "shared"` is supplied.

Set `cache.dedupeMs` to join identical requests started within that window. If an older request is
still running after the window expires, the newer request becomes the cache owner; the older result
still returns to its original caller but cannot replace the newer cached value.

## Optimistic cache updates

Farm's cache lifecycle is intentionally familiar to React Query and TanStack Query users, but it is
implemented by Farm's own typed API client and shared cache. A mutation can update an existing
query result immediately, roll it back after an error, and invalidate it after the server responds.

```ts
const products = await apiClient.products.get(
  { query: { category } },
  {
    cache: {
      key: ["products", category],
      policy: "stale-while-revalidate",
      staleTime: 30_000,
    },
  },
);

const createProduct = apiClient.products.post(
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
response type, so `current` is inferred from `apiClient.products.get`. You can also target a generated
route directly with `[apiClient.products.get, { query: { category } }, updater]`.

With `rollbackOnError: true`, Farm restores the exact previous cache entry when the mutation fails.
After a successful mutation, invalidation marks the key stale so mounted consumers or the next read
can load the canonical server result. Failed mutations do not invalidate known-good cached reads;
when rollback is disabled, only cache entries changed optimistically are marked stale so the next
read loads canonical data.

## Result shape

App-route and integration callers both expose `data` and `error`, so callers can branch on
`result.error`. App-route results also include a typed cache `key`; integration results retain
their own error contract and do not include that cache key.

```ts
const result = await apiClient.hello.post({
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
For app routes, if an HTTP error body is malformed, Farm still returns an `http_error` with the real status and
`Response`; the decoding failure is available as `error.cause`.

## Server callers

Import `api` from the same shared module. No endpoint imports, second factory, or request-bound
instance are needed:

```tsx
import { api } from "@/lib/api";

export default async function Page() {
  const result = await api.hello.post({ body: { name: "Ada" } });
  if (result.error) throw result.error;
  return <p>{result.data?.message}</p>;
}
```

`api` resolves the current request and that app's registered routes at call time. It works in Farm
server pages, queries, actions, and API handlers in development and the default universal
production runtime. Constructing the pair at module scope is safe. Calling `api` in the browser
or outside an active Farm request throws an actionable error; it never silently falls back to HTTP.

The local caller uses the app's server API mount, including custom base paths. A public
`baseURL` pointing at another origin affects `apiClient`, not local dispatch. The current
request's `Cookie`, `Authorization`, and `Accept-Language` headers are inherited; shared options
and per-call headers can override them. Other headers are not implicitly forwarded. Do not place
private tokens in the shared module: read them in server code and pass them per call where needed.

Local calls use the same route matching, params, input/output validation, endpoint middleware,
body limits, and response decoding as HTTP routes. They still serialize request/response data;
they avoid a network round trip, not all serialization. Request cancellation is inherited.
Opt-in caches and in-flight requests are isolated by request and credentials, never shared between
users. Dynamic `$params()` scopes work identically for both callers.

### Direct-call boundaries

`api` is a direct endpoint caller, **not a replay of the full HTTP request pipeline**. It does not
run path-level HTTP middleware, redirects/rewrites, plugin request/response lifecycle hooks, or
deployment-layer checks. Put authorization and other rules required for both transports in the
endpoint's `middleware`. Use `apiClient` when an operation must go through HTTP middleware.

Response cookies and headers from a local endpoint do not automatically become headers on the
outer page response. Post-response work scheduled by an endpoint uses the enclosing request's
lifecycle. Integrations remain available under `api.integrations` and `apiClient.integrations`,
using their existing integration-dispatch semantics.

### Existing factories

`createAPIClient()` remains supported for an HTTP-only caller, including standalone scripts with
an absolute `baseURL`. `createServerAPIClient({ hello: { get: GET } })` remains supported for
explicit endpoint-function maps in server-only modules. It returns the supplied functions and
their raw results; passing only `{ request }` does **not** discover routes. Prefer the paired
factory for a shared module and a consistent `{ data, error, key }` app-route result.

## Integration callers

Use the same shared module for file routes, plugin routes, and configured integrations:

**src/lib/api.ts**

```ts
import { createApiClients } from "@farm.js/core/client";
import { apiRoutes, type APIRouter } from "./api.generated";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createApiClients<APIRouter, AppIntegrations>({
  routes: apiRoutes,
});
```

Export `AppIntegrations = typeof appIntegrations` from the server-only module containing the
registry passed to `farm.config.ts`'s `integrations` field. Import only its type here, not the
registry value or provider SDKs. The type describes existing integrations; it does not register
them. Farm supplies their caller metadata at runtime.

File and plugin routes keep their generated paths, such as `apiClient.hello.post(...)`.
Integrations live under the reserved `.integrations` namespace on both callers. For example, with
the `billing` integration from the [custom integration guide](/docs/integrations/custom#shared-registration):

```ts
// Browser code
const checkout = await apiClient.integrations.billing.checkout.post({
  body: { priceId: "price_123" },
});

// Server code
const serverCheckout = await api.integrations.billing.checkout.post({
  body: { priceId: "price_123" },
});
```

Integration-specific defaults belong in `integrations: { data, headers, ... }` in the shared
factory options. Only put browser-safe values there. Set `integrations: false` if the app does
not need the reserved namespace.

The shared factory does not change integration execution semantics. Integration calls return
`{ data, error }`, not the app-route `{ data, error, key }` cache contract. Server integration
calls dispatch to a registered handler when possible and can fall back to HTTP when local
dispatch is unavailable. App-route `api` calls instead require an active Farm server request and
never fall back to HTTP. Operations marked `isServer: true` remain available only through
`api.integrations`, not `apiClient.integrations`.

### Integration-only callers

`createIntegrations<AppIntegrations>()` remains supported and is not deprecated. Existing apps
do not need to migrate. Use it when only integration callers are needed, or when you prefer to
keep them separate from app-route callers. It returns integration namespaces directly:
`apiClient.billing.checkout.post(...)` and `api.billing.checkout.post(...)`.
With `createApiClients`, those same calls need the
`.integrations` segment. Choose one setup for the shared module; do not create both pairs for
the same integrations. Switching factories requires updating the namespace and moving shared
integration defaults into the `integrations` option; it is not a drop-in rename.
The paired factory discovers configured integrations; it does not accept the integration-only
factory's explicit source map or separate server-options argument.

For deliberately separate modules, use `createApiClients<APIRouter>({ routes: apiRoutes,
integrations: false })` for app routes and `createIntegrations<AppIntegrations>()` for integration
callers. Disabling the paired factory's namespace does not unregister integrations or their
HTTP routes; it only leaves integration access to the separate caller module.

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
