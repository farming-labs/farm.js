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
export default defineConfig({
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

Use an absolute pathname, such as `/docs/reference`. Farm rejects query strings, fragments,
backslashes, encoded separators, and dot segments such as `..` or `%2e%2e` that browsers
would reinterpret. Integration route paths and `workflows.route` use the same validation.

## What gets documented

Farm scans API route files and generates an OpenAPI 3.0.3 spec from the discovered routes, methods, route params, query schemas, body schemas, and response metadata it can infer.

**src/app/api/users/route.ts**

```ts
import { createEndpoint } from "@farm.js/core/api";
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

Dynamic API segments use OpenAPI path parameters. Optional catch-all routes such as
`/api/files/[[...slug]]` produce both `/files` and `/files/{slug}` operations because OpenAPI path
parameters themselves must always be required. Required catch-all routes produce only the
parameterized operation.

`QUERY` routes include their request-body schema too. Farm currently emits OpenAPI 3.0.3, whose
Path Item Object does not have a native `query` field. To keep the document valid, Farm places each
`QUERY` Operation Object under the registered `x-oai-additionalOperations.QUERY` extension. This
maps directly to the native `query` field available in OpenAPI 3.2 without mislabeling the route as
`GET` or `POST`.

## Add metadata

```ts
export default defineConfig({
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

Farm pins the Scalar browser assets to the reviewed version shipped with the framework and verifies CDN responses with subresource integrity. Scalar upgrades therefore arrive with Farm releases instead of floating independently in production.

## Describe authentication

OpenAPI operations are public by default because Farm cannot infer authorization from arbitrary
middleware. Set a document-wide default with `openapi.security`, then override individual typed
endpoints when public and protected routes share one document:

```ts
export default defineConfig({
  openapi: { enabled: true, security: "cookie" },
});

export const GET = createEndpoint({ method: "GET", openapi: { security: "public" } }, async () => ({
  status: "ok",
}));

export const POST = createEndpoint(
  { method: "POST", openapi: { security: "bearer" } },
  async () => ({ created: true }),
);
```

Supported modes are `public`, `bearer`, `cookie`, and `either`. This metadata documents the
contract; authentication middleware must still enforce it at runtime.

## Describe responses

Farm does not guess status codes or body formats from arbitrary handler code. Add response metadata
to a typed endpoint when clients need an exact contract:

```ts
export const GET = createEndpoint(
  {
    method: "GET",
    openapi: {
      responses: {
        200: {
          body: "json",
          description: "Current account",
          schema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        },
        404: { body: "empty", description: "Account not found" },
      },
    },
  },
  async () => Response.json(await getAccount()),
);
```

Use `body: "empty"` for responses without content, `body: "stream"` with an explicit
`contentType` for streams, and `body: "binary"` for files. JSON and binary responses default to
`application/json` and `application/octet-stream`. When response metadata is absent, Farm emits an
unspecified default response instead of claiming an unknown status code or JSON schema.

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
- Farm recognizes Zod schemas structurally, including Zod 3/4 schemas loaded from another package
  copy. Standard Schema validators without portable schema metadata remain valid at runtime, but
  the generated document uses an explicit metadata-unavailable fallback instead of inventing a
  shape.
- Pair OpenAPI with typed callers so server/client code and published docs describe the same route surface.
