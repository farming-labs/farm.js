# @farm.js/mcp

Experimental Streamable HTTP MCP servers with typed Farm API routes and standalone tools.

```ts
import { defineConfig } from "@farm.js/core/config";

export default defineConfig({
  mcp: {
    authorize: async ({ request }) =>
      request.headers.get("authorization") ? { subject: "api-user" } : false,
  },
});
```

Opt an endpoint in where it is defined:

```ts
import { createEndpoint } from "@farm.js/core/api";

export const GET = createEndpoint(
  {
    method: "GET",
    mcp: { name: "list_projects", description: "List visible projects." },
  },
  listProjects,
);
```

`mcp: true` derives a name from the route method and path. The endpoint defaults to `/api/mcp`.
Selected routes keep their normal Farm validation,
endpoint middleware, request context, error responses, and cancellation behavior.

Alternatively, compose server-only endpoint references and standalone tools in config:

```ts
import { defineTool } from "@farm.js/mcp";
import { z } from "zod";
import { GET as listProjects } from "./src/app/api/projects/route";
import { getSession } from "./src/lib/session";
import { searchProjects } from "./src/lib/projects";

export default defineConfig({
  mcp: {
    tools: [
      { endpoint: listProjects, name: "list_projects" },
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
    authorize: async ({ request, tools, server }) => {
      const session = await getSession(request);
      if (!session) return false;
      return {
        subject: session.user.id,
        tools: tools
          .filter((tool) => session.scopes.includes(`${server.name}:${tool.name}`))
          .map((tool) => tool.name),
      };
    },
  },
});
```

Config references need an explicit path, for example
`createEndpoint("/api/projects", { method: "GET" }, handler)`, matching a mounted app route.
`mcp.tools` replaces automatic discovery; omit it to keep route-owned opt-ins. Bare references
such as `tools: [listProjects]` preserve route metadata. `authorize` receives a frozen catalog
with each tool's name and kind (`endpoint` or `standalone`), plus method/path for endpoints and
the resolved server identity. Its optional returned
`tools` list controls both discovery and invocation: omitted means all configured tools; `[]`
means none. Scopes and annotations alone never grant or restrict access. Keep endpoint middleware
for direct HTTP and argument-level permissions; standalone tools use `authorization` in `execute`
for argument-level checks.

Standalone tools need no separate HTTP route and can be the only tools in a server. Their
arguments match `inputSchema` directly (for example `{ query: "farm" }`, without a `query` or
`body` wrapper). The schema must describe an object and support input JSON Schema conversion:
Zod 4 works directly, as does Standard Schema with `~standard.jsonSchema.input()`. Farm runs
the original validator before execution, including async refinements and transforms; `execute`
receives the inferred, validated output and `{ authorization, request, signal }`.

Return JSON-serializable data, not a Web `Response`, stream, or MCP protocol envelope. Farm wraps
the result as text content and `structuredContent: { result: data }`. Pass `signal` to cancellable
work; cancellation cannot undo completed side effects. Denied tools never reach execution.

`apiMcp()` remains exported for advanced manual plugin composition with the same options.
Normal applications should use the top-level `mcp` config.

See the [API MCP guide](https://farmjs.dev/docs/plugins/mcp) and the runnable
[`examples/api-mcp`](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp).
