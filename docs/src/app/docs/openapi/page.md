---
title: "OpenAPI Reference"
description: "Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation."
section: "Content"
---

# OpenAPI Reference

Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation.

## Enable OpenAPI

**farm.config.ts**

```ts
export default defineFarmConfig({
  openapi: {
    enabled: true,
    route: "/docs/reference",
    title: "Farm API",
    version: "1.0.0",
  },
});
```

## Reference route

The OpenAPI route can be included in generated route types so docs navigation and Link hrefs stay aware of the reference page.

## What gets documented

Farm scans API route files and generates an OpenAPI 3.0.3 spec from the discovered routes, methods, route params, query schemas, body schemas, and response metadata it can infer.

**src/app/api/users/route.ts**

```ts
import { createEndpoint } from "@farmjs/core/api";
import { z } from "zod";

export const GET = createEndpoint(
  {
    method: "GET",
    query: z.object({
      limit: z.coerce.number().int().positive().default(20),
    }),
  },
  async ({ query }) => {
    return Response.json({
      users: await listUsers(query.limit),
    });
  },
);
```

The route appears in the generated reference with a typed `limit` query parameter.

## Add metadata

```ts
export default defineFarmConfig({
  openapi: {
    enabled: true,
    route: "/docs/reference",
    title: "Acme API",
    description: "Public and internal API routes for Acme.",
    version: "1.0.0",
    servers: [
      {
        url: "https://api.acme.com",
        description: "Production",
      },
    ],
    contact: {
      name: "API Support",
      email: "support@acme.com",
    },
  },
});
```

## Serve the reference

The configured route serves a Scalar-powered reference page with the generated spec embedded in the page. The route can be visited during development and included in production docs.

**Terminal**

```bash
farm generate
farm build
```

`farm dev` and `farm generate` keep route types aware of the reference URL. `farm build` includes the reference route in the app output when OpenAPI is enabled.

## Production notes

- Enable OpenAPI for APIs you want to document publicly or internally.
- Keep private admin routes out of public docs unless the site is protected.
- Use Zod schemas on API routes for better generated parameter and body details.
- Pair OpenAPI with typed callers so server/client code and published docs describe the same route surface.
