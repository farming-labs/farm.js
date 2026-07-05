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
