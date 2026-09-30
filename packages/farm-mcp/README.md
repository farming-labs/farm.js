# @farm.js/mcp

Experimental Streamable HTTP MCP server generation from opted-in Farm API routes.

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

`apiMcp()` remains exported for advanced manual plugin composition, but it only mounts and protects
the transport. Tool declarations still belong on `createEndpoint()` or `createRouteFactory()`
routes. Normal applications should use the top-level `mcp` config.

See the [API MCP guide](https://farmjs.dev/docs/plugins/mcp) and the runnable
[`examples/api-mcp`](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp).
