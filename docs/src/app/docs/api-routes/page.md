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
import { createEndpoint } from "@farmjs/core/api";
import { z } from "zod";

export const POST = createEndpoint({
  body: z.object({
    name: z.string().min(1),
  }),
  async handler({ input }) {
    return Response.json({ message: "Hello " + input.body.name });
  },
});
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
export const GET = createEndpoint({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
  }),
  async handler({ input }) {
    return Response.json({
      q: input.query.q ?? "",
      page: input.query.page,
    });
  },
});
```

Farm parses and validates input before the handler runs. Invalid input returns a `400` response with structured validation issues.

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

The exact generated shape comes from route generation. Body and query schemas become typed caller input, and path segments become the nested `api.users.get` style namespace. Run `farm generate` when you want updated route/API types without a full build.

## When to use integrations instead

Use API routes for app-owned endpoints. Use integrations when a provider or feature needs a package-like surface: config validation, lifecycle hooks, storage schema, middleware, providers, and typed callers bundled together.
