---
title: "API Routes"
description: "Expose HTTP handlers from src/app/api and validate input with schemas before handler code runs."
section: "Data and APIs"
---

# API Routes

Expose HTTP handlers from src/app/api and validate input with schemas before handler code runs.

## Route handlers

API route modules export HTTP methods. Farm discovers them, runs the route pipeline, and can generate typed client callers from the route shape.

**src/app/api/hello/route.ts**

```ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const POST = createEndpoint(
  {
    method: "POST",
    body: z.object({
      name: z.string().min(1),
    }),
  },
  async ({ body }) => {
    return Response.json({ message: "Hello " + body.name });
  },
);
```

## Next-style exports

You can also manually export GET, POST, PATCH, and other handlers from the route file. Farm keeps this familiar while layering typed helpers around it.

**src/app/api/status/route.ts**

```ts
export async function GET() {
  return Response.json({ ok: true });
}
```

## Validation

> **Zod and standard schema**
>
> Endpoint and integration route inputs can use Zod or compatible standard-schema validators so the handler sees parsed input instead of raw unknown data.

## Route file shape

Farm follows the familiar route-file convention: each route lives in `src/app/api/**/route.ts` and exports one or more HTTP methods.

```txt
src/app/api/hello/route.ts          -> /api/hello
src/app/api/users/[id]/route.ts     -> /api/users/:id
src/app/api/files/[...path]/route.ts -> /api/files/*
```

Use `createEndpoint` when you want input validation and typed client generation. Use plain `GET`, `POST`, `PATCH`, and friends when you want to handle the raw `Request`.

## Body and query input

```ts
export const GET = createEndpoint(
  {
    method: "GET",
    query: z.object({
      q: z.string().optional(),
      page: z.coerce.number().int().positive().default(1),
    }),
  },
  async ({ query }) => {
    return Response.json({
      q: query.q ?? "",
      page: query.page,
    });
  },
);
```

Farm parses and validates `body`, `query`, and `headers` before middleware or handler code runs. Header schema keys use the lower-case names exposed by the Fetch `Headers` API. Invalid input returns a `400` response with structured validation issues.

## Endpoint middleware

Put plain async functions in `middleware`. There is no middleware factory and no `next()` callback. Functions run in declaration order after endpoint input validation.

**src/app/api/projects/[id]/route.ts**

```ts
import { createEndpoint, type EndpointMiddlewareContext } from "@farm.js/core/api";
import { z } from "zod";

type Session = {
  user: { id: string; roles: string[] };
};

async function requireAuth({ request }: EndpointMiddlewareContext) {
  const session = await getSession(request);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { session: session as Session };
}

const requireRole =
  (role: string) =>
  async ({ context }: EndpointMiddlewareContext<{ session: Session }>) => {
    return context.session.user.roles.includes(role);
  };

async function loadProject({
  body,
  context,
  params,
}: EndpointMiddlewareContext<{ session: Session }, { name: string }>) {
  const project = await db.project.findUniqueOrThrow({
    where: {
      id: String(params.id),
      ownerId: context.session.user.id,
    },
  });

  return { project };
}

export const PATCH = createEndpoint(
  {
    method: "PATCH",
    body: z.object({ name: z.string().min(1) }),
    middleware: [requireAuth, requireRole("admin"), loadProject],
  },
  async ({ body, context }) => {
    // context.session and context.project are inferred from middleware returns.
    return db.project.update({
      where: { id: context.project.id },
      data: { name: body.name },
    });
  },
);
```

Middleware return values have deliberate control-flow meaning:

| Return value | Result                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------- |
| Plain object | Shallow-merges its properties into typed `context` for later middleware and the handler. |
| `true`       | Continues without adding context.                                                        |
| `false`      | Stops and returns Farm's JSON `403 Forbidden` response.                                  |
| `Response`   | Stops and returns that response unchanged. Use this for custom status, body, or headers. |

Only literal `false` is the default denial signal. Returning `null`, `undefined`, an array, or another value is an error, which catches forgotten returns instead of silently skipping authorization. Context is shallowly frozen, duplicate keys are rejected, and `__proto__`, `constructor`, and `prototype` cannot be provided as context keys.

Endpoint middleware is local to one `createEndpoint` declaration and can use its validated input. Use `src/app/**/middleware.ts` for path-level behavior shared by many routes, such as request tracing, common headers, or an early rewrite before endpoint parsing.

> **Authorization boundary**
>
> Derive users, roles, tenants, and rate-limit identities from the trusted `Request` or server state. Middleware context is created only on the server and is never accepted from client input. Keep resource-specific permission checks close to the resource query even when shared authentication runs in middleware.

## Typed expected errors

Declare failures that are part of an endpoint's public contract, then return them through the typed
`fail` function:

```ts
export const POST = createEndpoint(
  {
    method: "POST",
    body: z.object({
      name: z.string().min(1),
    }),
    errors: {
      duplicate: {
        status: 409,
        message: "A product with this name already exists",
        schema: z.object({
          existingId: z.string(),
        }),
      },
      forbidden: {
        status: 403,
        schema: z.object({
          permission: z.string(),
        }),
      },
    },
  },
  async ({ body, fail }) => {
    const existing = await findProductByName(body.name);
    if (existing) {
      return fail("duplicate", {
        existingId: existing.id,
      });
    }

    return createProduct(body);
  },
);
```

Error codes and payloads are checked in the handler and carried into the generated API client:

```ts
const result = await api.products.post({
  body: { name },
});

if (result.error?.code === "duplicate") {
  // existingId is inferred as string.
  showExistingProduct(result.error.data.existingId);
}
```

Farm validates the failure payload before returning a JSON error response. Declared messages and
payloads are public, so do not include secrets. Undeclared exceptions remain unexpected server
errors and are not converted into a declared failure. Endpoints without an `errors` declaration
keep the existing `Error` client type.

## Client inference

Routes become client namespaces from their path:

```ts
await api.hello.post({
  body: {
    name: "Ada",
  },
});

await api.users.get({
  query: {
    limit: 10,
  },
});
```

The exact generated shape comes from route generation. Body and query schemas become typed caller input, and path segments become the nested `api.users.get` style namespace. During `farm dev`, Farm regenerates route/API types when page or API route files are added, changed, or removed. Run `farm generate` when you want the same refresh outside the dev server.

## Declare invalidation with the mutation

When every caller of a mutation makes the same data stale, declare that relationship on the
endpoint instead of repeating client-side invalidation:

```ts
export const PATCH = createEndpoint(
  {
    method: "PATCH",
    body: z.object({
      id: z.string(),
      name: z.string().min(1),
    }),
    invalidates: ({ body }) => [
      { key: ["product", body.id] },
      { key: ["products", "list"] },
      { tag: "products" },
      { path: "/products" },
    ],
  },
  async ({ body }) => {
    return db.product.update({
      where: { id: body.id },
      data: { name: body.name },
    });
  },
);
```

Farm applies declared keys, tags, and paths to the server cache after the handler succeeds. Normal
`api.products.patch(...)` callers also receive the key invalidations through response metadata, so
matching browser queries become stale without repeating an `invalidate` option. A response with a
status of 400 or higher, or middleware that stops before the handler, does not invalidate.

The resolver receives validated body, query, and headers plus the accumulated typed middleware
context. Invalidation is declarative rather than inferred: database writes do not reliably reveal
every affected query. Existing client-side `invalidate` options remain supported for
caller-specific cache relationships, and handlers can continue calling `invalidate(...)` or
`revalidatePath(...)` directly.

## When to use integrations instead

Use API routes for app-owned endpoints. Use integrations when a provider or feature needs a package-like surface: config validation, lifecycle hooks, storage schema, middleware, providers, and typed callers bundled together.
