---
title: "Backend-Only Apps"
description: "Run Farm as an API server with no pages, no browser bundle, and no React: set renderer to false."
section: "Data and APIs"
---

# Backend-Only Apps

Run Farm as an API server with no pages, no browser bundle, and no React: set `renderer` to `false`.

A backend-only app keeps Farm's server features: file and programmatic API routes, validated
endpoints, middleware, the generated API client, OpenAPI, health checks, graceful shutdown,
storage, cache, cron, observability, and every deployment target. It drops everything that only
serves pages.

## Set up

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  renderer: false,
  // Optional: serve src/app/api/** from the root, so /todos answers as well as /api/todos.
  api: { basePath: "/" },
});
```

Install Farm without React:

```bash
pnpm add @farm.js/core
pnpm add -D @farm.js/cli vite typescript
```

**package.json**

```json
{
  "type": "module",
  "scripts": {
    "dev": "farm dev",
    "build": "farm build --preset node-server",
    "start": "farm start"
  }
}
```

`farm dev` reloads routes as you edit them. `farm build` writes the server to `.farm/.output`, and
`farm start` runs it. The server listens on `HOST` and `PORT`, so there is no `listen()` call to
write.

## Routes

Every `route.ts` under `src/app/api` is an endpoint, and its folder path is the URL:

```txt
src/app/api/route.ts               -> /api   (and / with api.basePath "/")
src/app/api/todos/route.ts         -> /api/todos
src/app/api/todos/[id]/route.ts    -> /api/todos/:id
```

**src/app/api/todos/route.ts**

```ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { createTodo, listTodos } from "../../../lib/todos";

export function GET() {
  return Response.json({ todos: listTodos() });
}

export const POST = createEndpoint(
  { body: z.object({ title: z.string().min(1) }) },
  async ({ body }) => Response.json(createTodo(body.title), { status: 201 }),
);
```

See [API Routes](/docs/api-routes) for validation, typed errors, uploads, and streaming, and
[API Client](/docs/api-client) for the typed client Farm generates from these files.

To list routes in one file instead, export `defineRoutes` from `src/routes.ts`. Its paths need no
`/api` prefix:

**src/routes.ts**

```ts
import { defineRoutes } from "@farm.js/core/routes";

export default defineRoutes(({ api }) => [
  api("/", { GET: () => Response.json({ status: "ok" }) }),
  api("/users/[id]", {
    GET: (request) => Response.json({ path: new URL(request.url).pathname }),
  }),
]);
```

Both styles can live in one app. Routes from `src/routes.ts` are not in the generated API client
yet; see [Programmatic routes](/docs/routing#programmatic-routes).

## Middleware

`src/app/**/middleware.ts` files run before the matching routes, as in any Farm app. Answer early by
returning a `Response`:

**src/app/middleware.ts**

```ts
import type { RequestMiddlewareContext } from "@farm.js/core/middleware";

export function middleware(request: Request, context: RequestMiddlewareContext) {
  context.headers.set("x-request-id", crypto.randomUUID());

  if (request.method !== "GET" && !request.headers.get("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```

Import from server entries such as `@farm.js/core/api`, `@farm.js/core/routes`, and
`@farm.js/core/middleware`. The package root and `@farm.js/core/navigation` (`redirect()`,
`notFound()`) are page APIs that load React; return a `Response` instead.

## What changes

With `renderer: false`, Farm:

- builds no browser client and no server-side renderer, and does not load React in development or
  production;
- answers a request that matches no route with JSON: `404 {"error":"Not found","pathname":"/..."}`,
  including a miss under `api.basePath: "/"`;
- defaults [`images`](/docs/images) to `provider: "none"`, so the image optimizer and Sharp stay out
  of the server;
- turns off the page-derived agent defaults: JSON-LD, `/llms.txt`, `/sitemap.xml`, and the
  read-only `/mcp` server that reads pages. Set any of them under `agent` to turn it back on;
- fails the build, and `farm dev`, if the app has a page or layout, naming each file;
- skips the page and root-layout checks in `farm doctor` and DevTools, and checks for API routes
  instead.

Built-in health probes (`/_farm/health/live`, `/_farm/health/ready`), graceful shutdown, and every
[deployment target](/docs/deployment) work as in any other app.

## Plugins

Server plugins work as in any app: [Health](/docs/plugins/health), [API MCP](/docs/plugins/mcp),
[Sentry](/docs/plugins/sentry), [Content](/docs/plugins/content), [Sync](/docs/plugins/sync),
[Plugin Tables](/docs/plugins/schema-tables), [Analyzer](/docs/plugins/analyzer) (it reports the
server bundle), [WebAssembly](/docs/plugins/wasm) for `.wasm` imports in API routes,
[MSW](/docs/plugins/msw) for server-side mocking, and plugins you write with
[`definePlugin`](/docs/plugins/create-plugin): `setup`, runtime hooks, `routes`, and lifecycle
hooks all run.

Plugins that only serve pages stop `farm dev` and `farm build` with a message naming
`renderer: false`: [Partytown](/docs/plugins/partytown), [PWA](/docs/plugins/pwa),
[Search](/docs/plugins/search), [StyleX](/docs/plugins/stylex), [WebMCP](/docs/plugins/webmcp),
[Federation](/docs/plugins/federation), and MSW with `browser: true`.

Development plugins that act on pages have no effect: [Hints](/docs/plugins/hints),
[Progress](/docs/plugins/progress), and [Scripts](/docs/plugins/scripts).
[DevTools](/docs/plugins/devtools) opens its standalone panel at `/__farm/devtools`, which lists the
app's API routes, middleware, and plugins.

A plugin must import from Farm's subpath entries, such as `@farm.js/core/plugin`; the package root
loads React. The [Blyp](/docs/plugins/blyp) integration imports the root today, so it needs React
installed.

## Integrations

Server integrations load without React: AI, Agent, Auth0, Auth.js, Autumn, Better Auth, Clerk,
Convex, Jobs, Polar, Sanity, Strapi, Stripe, Supabase, Unkey, and WorkOS.
[Email](/docs/integrations/email) renders React Email templates, so it needs React installed. An
integration you write imports `defineIntegration` and `integrationRoute` from
`@farm.js/core/integrations`, and its client bindings import `api` from `@farm.js/core/api/client`.

## Testing

`createFarmTestHarness` from `@farm.js/core/testing` calls API routes without React. Only its
`page()` helper needs a renderer. See [Testing](/docs/testing).

## Example

[`examples/api-server`](https://github.com/farming-labs/farm.js/tree/main/examples/api-server) is a
todo API with validated endpoints, a middleware that requires a token for writes, JSON 404s, and an
OpenAPI document at `/openapi.json`.
