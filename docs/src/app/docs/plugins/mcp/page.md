---
title: "API MCP"
description: "Compose typed API routes and standalone tools in one authenticated MCP server."
section: "Plugin Ecosystem"
---

# API MCP

`@farm.js/mcp` composes selected Farm API routes and standalone tools in one MCP server. Reuse
an endpoint's validation and middleware, or use `defineTool()` for an operation that doesn't need
its own HTTP route. Both share the same transport, tool catalog, and authorization policy.

The endpoint defaults to `/api/mcp` and implements MCP Streamable HTTP. It is a server capability,
unlike [WebMCP](/docs/plugins/webmcp), which registers tools in a supporting browser while a page is
open.

## Install and configure

```bash
pnpm add @farm.js/mcp
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  mcp: {
    authorize: async ({ request }) => {
      const session = await getSession(request);
      if (!session) return false;
      return { subject: session.user.id, scopes: session.scopes };
    },
  },
});
```

The top-level config mounts the transport and owns its global authorization policy. Farm loads the
installed `@farm.js/mcp` package only when this config is enabled. It never exposes an endpoint
unless that endpoint opts in or is explicitly selected in `mcp.tools`.

## Declare tools in config

You can keep MCP declarations in `farm.config.ts` and reference existing endpoint instances.
The endpoint still owns its validation, middleware, and handler:

```ts title="src/app/api/projects/route.ts"
import { createEndpoint } from "@farm.js/core/api";
import { requireProjectAccess, listProjects } from "../../../lib/projects";

export const GET = createEndpoint(
  "/api/projects",
  { method: "GET", middleware: [requireProjectAccess] },
  ({ context }) => listProjects(context.session.user.id),
);
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { defineTool } from "@farm.js/mcp";
import { z } from "zod";
import { GET as listProjects } from "./src/app/api/projects/route";
import { getSession } from "./src/lib/session";
import { searchProjects } from "./src/lib/projects";

export default defineConfig({
  mcp: {
    name: "project-tools",
    tools: [
      {
        endpoint: listProjects,
        name: "list_projects",
        description: "List projects visible to the current user.",
      },
      defineTool({
        name: "search_projects",
        description: "Search projects visible to the current user.",
        inputSchema: z.object({ query: z.string().trim().min(1) }),
        readOnlyHint: true,
        destructiveHint: false,
        execute: ({ query }, { authorization, signal }) =>
          searchProjects({ query, userId: authorization.subject, signal }),
      }),
    ],
    authorize: async ({ request, tools }) => {
      const session = await getSession(request);
      if (!session) return false;
      return {
        subject: session.user.id,
        tools: tools
          .filter(
            (tool) =>
              ["list_projects", "search_projects"].includes(tool.name) &&
              session.scopes.includes("projects:read"),
          )
          .map((tool) => tool.name),
      };
    },
  },
});
```

`mcp.tools` is an explicit allowlist: **only those tools** are exposed, even if other endpoints
have route-owned `mcp` metadata. Omit it to discover route-owned declarations instead. A bare
reference such as `tools: [listProjects]` preserves that endpoint's metadata or derives its tool
name. The object form overrides metadata without changing the underlying API route. An empty
configured list, duplicate endpoint selection, or a missing mounted route fails the build.

Config references require `createEndpoint("/api/...", options, handler)` with an explicit path
matching the mounted route. Farm resolves the reference by method and path, not JavaScript object
identity, because config and route modules can be loaded independently. A `createRouteFactory()`
definition can also be passed, provided its endpoint is mounted as an app route. This does not
mount new HTTP routes or expose plugin-owned routes.

For endpoints whose path is inferred from their file, use the route-owned form below instead.
Keep endpoint imports server-only; never import this config or route module into a browser client.

## Standalone tools

Import `defineTool` from `@farm.js/mcp` and put its result in `mcp.tools`, alongside endpoint
references or by itself. A standalone tool does not need `createEndpoint()`, a method, or a path.
For example, `search_projects` above is callable through `/api/mcp`, but Farm does not create an
`/api/search_projects` route. A server with only standalone tools works without any app API routes.

Each definition requires a unique `name`, an object `inputSchema`, and an `execute` function.
Use `z.object({})` for a tool with no arguments. Zod 4 works directly; other Standard Schema
validators must also expose `~standard.jsonSchema.input()` for discovery. Unsupported schemas
fail at startup/build rather than advertising an unusable tool.

Standalone arguments are the schema's object directly, with no `body` or `query` wrapper:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_projects",
    "arguments": { "query": "farm" }
  }
}
```

Farm advertises the schema's input shape and runs the original validator before `execute`,
including async refinements, defaults, and transforms. The first argument is typed as the
**validated output**, not the unparsed wire input. The second argument provides:

- `authorization`: the principal returned by `mcp.authorize`, including your custom claims.
  Public servers receive `{ subject: "anonymous" }`.
- `request`: the incoming MCP Web Request, including credentials.
- `signal`: cancellation from the request or MCP call. Pass it into cancellable work;
  cancellation cannot undo side effects that already happened.

Return JSON-serializable application data, not a `Response`, stream, or MCP protocol envelope.
Farm returns its JSON as text content and as `structuredContent: { result: data }`, matching
endpoint-backed tools. Validation and execution failures become tool errors. Only authorized
tools can reach validation or execution. Keep definitions and their provider SDKs server-only.
Use a shared database or storage backend for data read by both routes and standalone tools;
config and route modules can be loaded independently, and module-local state is not a shared store.

## Authorize individual tools

Every `authorize` call receives:

- `request`: the incoming Web Request, including its credentials.
- `server`: the resolved MCP `name`, `version`, and endpoint `path`.
- `tools`: the complete, read-only configured catalog. Each entry has its stable MCP `name`,
  `kind` (`"endpoint"` or `"standalone"`), optional title/description, and behavior hints.
  Endpoint entries also have HTTP `method` and route `path`; standalone entries do not.
  The catalog contains no handlers or validators.
- `tool`: the untrusted requested name for a `tools/call`, if present. It is omitted for
  initialization and listing. For a JSON-RPC batch, Farm calls `authorize` for every item with
  that item's tool name and rejects the entire batch before dispatch when any item is denied;
  compare it against the catalog rather than trusting it.

Return `false` to reject the entire request with HTTP 401. Otherwise return a `subject` and,
optionally, `tools`, an array of allowed **tool names**. Omit this return field to retain access to
all configured tools; return `tools: []` to allow the MCP connection but no tools. Unknown names
or malformed permission lists fail closed with a server error.

Every allowed item in a batch must resolve to the same subject, scopes, and allowed tool names
because one HTTP batch has one authenticated identity.
Authorization runs once per batch item, so keep batches bounded when the policy performs remote
or otherwise expensive session checks.

Only allowed tools appear in discovery, and guessing a hidden name does not make it callable.
Permissions are evaluated for each request and do not carry over between callers. A stable
explicit `name`, such as `list_projects`, is the identifier to use in policy rules.

`scopes` are authentication metadata; Farm does not automatically translate them into permissions.
Your policy must map them to allowed names, as above. Likewise, `readOnlyHint` and other annotations
are descriptive, not security rules. For row-level or argument-dependent checks, keep authorization
in endpoint middleware or a standalone tool's `execute` function. Standalone tools receive the
returned principal as `authorization`; endpoint-backed tools continue to authenticate through
their existing middleware using forwarded credentials. The principal is not injected into an
endpoint's context. This config does not implement an OAuth authorization server or issue tokens.

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
    mcp: {
      name: "list_projects",
      description: "List projects visible to the current user.",
      readOnlyHint: true,
    },
    query: z.object({ status: z.enum(["active", "planned"]).optional() }),
    middleware: [requireProjectAccess],
  },
  async ({ query, context }) => ({
    projects: await listProjects(context.session.user.id, query.status),
  }),
);
```

Use `mcp: true` when the generated name is sufficient. Farm derives names from the method and path,
such as `get_projects` for `GET /api/projects` and `get_projects_by_team` for
`GET /api/projects/[team]`. Use an object to set `name`, `title`, `description`, or behavior hints.
Duplicate or invalid explicit names fail the build. A path that cannot produce a valid derived name
fails with an instruction to provide one explicitly. Duplicate tool names, unsupported schemas, or
an empty tool set also fail the build instead of producing a partially working server.

Package and plugin authors use the same route-owned metadata on `createRouteFactory()` routes:

```ts
import { createRouteFactory } from "@farm.js/core/api";
import { z } from "zod";

const route = createRouteFactory();

export const projectsRoute = route.post("/api/projects", {
  mcp: {
    name: "create_project",
    description: "Create a project.",
    destructiveHint: false,
  },
  input: { body: z.object({ name: z.string().min(1) }) },
  handler: async (_request, { input }) => createProject(input.body),
});
```

Both route APIs keep the HTTP method and path next to the handler, so there is no separate
`"METHOD /api/path"` MCP map to synchronize.

An MCP call runs the endpoint validator, middleware, handler, and error mapping exactly once. It also
forwards the original request's cookies and authorization header, so the route sees the same
credentials as the MCP boundary. Tool arguments cannot replace security-sensitive headers.

Use both authorization layers:

- `mcp.authorize` protects the MCP transport and can reject requests before protocol handling.
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

| Option                 | Default       | Purpose                                                                                         |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `authorize`            | required      | Receive the tool catalog and server identity; return a subject and optional allowed tool names. |
| `tools`                | route opt-ins | Compose endpoint references and standalone `defineTool()` definitions.                          |
| `allowUnauthenticated` | `false`       | Deliberately permit a public MCP endpoint instead of `authorize`.                               |
| `path`                 | `/api/mcp`    | Canonical Farm API path for the Streamable HTTP endpoint.                                       |
| `name`                 | `farm-api`    | MCP server name returned during initialization.                                                 |
| `version`              | `1.0.0`       | Application server version returned during initialization.                                      |

Tool metadata supports `name`, `title`, `description`, `readOnlyHint`, `destructiveHint`,
`idempotentHint`, and `openWorldHint`. Annotations describe intent to the client; they do not enforce
permissions or replace confirmation for consequential actions.

## Runtime support

The MCP transport works in development and production on Farm's stable Node, Vercel, Cloudflare,
and Netlify targets. Removing the top-level `mcp` config removes the endpoint and MCP runtime from
the application bundle.

The lower-level `apiMcp()` helper remains available for advanced manual plugin composition. It has
the same options as top-level config, including mixed tool definitions and per-request permissions.
Endpoint-backed tools keep their route's validation, middleware, and execution.

```ts
import { apiMcp } from "@farm.js/mcp";

export default defineConfig({
  plugins: [apiMcp({ authorize: authorizeAgent })],
});
```

Normal applications do not need this manual form.

The runnable [`examples/api-mcp`](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp)
shows two endpoint-backed tools and a standalone search tool sharing one authorization policy.
