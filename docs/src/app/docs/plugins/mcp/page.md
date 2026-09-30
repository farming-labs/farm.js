---
title: "API MCP Plugin"
description: "Expose an explicit allowlist of typed Farm API routes as authenticated MCP tools over Streamable HTTP."
section: "Plugin Ecosystem"
---

# API MCP Plugin

`@farm.js/mcp` turns selected Farm API routes into an MCP server. The plugin generates tool input
schemas from the routes' existing validators, then invokes the same endpoint implementation used by
ordinary HTTP and typed server callers.

The endpoint defaults to `/api/mcp` and implements MCP Streamable HTTP. It is a server capability,
unlike [WebMCP](/docs/plugins/webmcp), which registers tools in a supporting browser while a page is
open.

## Install and configure

```bash
pnpm add @farm.js/mcp
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { apiMcp } from "@farm.js/mcp";

export default defineConfig({
  plugins: [
    apiMcp({
      tools: {
        "GET /api/projects": {
          name: "list_projects",
          description: "List projects visible to the current user.",
          readOnlyHint: true,
        },
        "POST /api/projects": {
          name: "create_project",
          description: "Create a project.",
          destructiveHint: false,
        },
      },
      authorize: async ({ request, tool }) => {
        const session = await getSession(request);
        if (!session) return false;
        return { subject: session.user.id, scopes: session.scopes };
      },
    }),
  ],
});
```

Every tool is explicit. The plugin does not scan for routes to expose and cannot invoke a route that
is absent from `tools`. A missing route, duplicate tool name, unsupported schema, or unstable route
set fails the build instead of producing a partially working server.

## Keep the API route authoritative

Define validation and endpoint authorization on the route as usual:

```ts title="src/app/api/projects/route.ts"
import { createEndpoint, type EndpointMiddlewareContext } from "@farm.js/core/api";
import { z } from "zod";

async function requireProjectAccess({ request }: EndpointMiddlewareContext) {
  const session = await getSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return { session };
}

export const GET = createEndpoint(
  {
    method: "GET",
    query: z.object({ status: z.enum(["active", "planned"]).optional() }),
    middleware: [requireProjectAccess],
  },
  async ({ query, context }) => ({
    projects: await listProjects(context.session.user.id, query.status),
  }),
);
```

An MCP call runs the endpoint validator, middleware, handler, and error mapping exactly once. It also
forwards the original request's cookies and authorization header, so the route sees the same
credentials as the MCP boundary. Tool arguments cannot replace security-sensitive headers.

Use both authorization layers:

- `apiMcp.authorize` protects the MCP transport and can reject requests before protocol handling.
- Endpoint middleware protects the underlying API route, including direct HTTP and typed local calls.

Authorization is required by default. `allowUnauthenticated: true` is an explicit escape hatch for a
deliberately public server.

## Generated tool inputs

Farm maps route inputs into one MCP argument object:

| Route input | Tool argument | Notes                                                         |
| ----------- | ------------- | ------------------------------------------------------------- |
| Params      | `params`      | Includes dynamic, catch-all, and optional catch-all segments. |
| Query       | `query`       | Preserves repeated query values as arrays.                    |
| JSON body   | `body`        | Available for methods that accept a request body.             |
| Headers     | `headers`     | Sensitive credential headers are never agent-controlled.      |

For example, a tool call for `GET /api/projects/[team]` can send:

```json
{
  "params": { "team": "framework" },
  "query": { "status": ["active", "planned"] }
}
```

The route's Standard Schema implementation must be convertible to JSON Schema. Zod 4 routes work
without additional configuration. Selected routes currently need JSON responses; binary,
multipart, and streaming responses are rejected as tool errors.

## Connect a client

Point an MCP client at the deployed endpoint and supply credentials using that client's secure
header configuration. For a direct protocol check in local development:

```bash
curl http://localhost:3000/api/mcp \
  -H 'Authorization: Bearer development-token' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Do not put production tokens in source, browser code, an MCP tool description, or a checked-in
client configuration.

## Options

| Option                 | Default    | Purpose                                                              |
| ---------------------- | ---------- | -------------------------------------------------------------------- |
| `tools`                | required   | Explicit map of `METHOD /api/path` to MCP tool metadata.             |
| `authorize`            | required   | Authorize every MCP request and return a stable subject plus scopes. |
| `allowUnauthenticated` | `false`    | Deliberately permit a public MCP endpoint instead of `authorize`.    |
| `path`                 | `/api/mcp` | Canonical Farm API path for the Streamable HTTP endpoint.            |
| `name`                 | `farm-api` | MCP server name returned during initialization.                      |
| `version`              | `1.0.0`    | Application server version returned during initialization.           |

Tool metadata supports `name`, `title`, `description`, `readOnlyHint`, `destructiveHint`,
`idempotentHint`, and `openWorldHint`. Annotations describe intent to the client; they do not enforce
permissions or replace confirmation for consequential actions.

## Runtime support

The plugin works in development and production on Farm's stable Node, Vercel, Cloudflare, and
Netlify targets. Removing `apiMcp()` removes the endpoint and MCP runtime from the application
bundle.

The runnable [`examples/api-mcp`](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp)
shows authenticated read and write tools backed by one typed API route.
