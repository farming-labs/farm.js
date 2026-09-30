# @farm.js/mcp

Experimental Streamable HTTP MCP server generation from an explicit allowlist of Farm API routes.

```ts
import { apiMcp } from "@farm.js/mcp";
import { defineConfig } from "@farm.js/core/config";

export default defineConfig({
  plugins: [
    apiMcp({
      tools: {
        "GET /api/projects": { name: "list_projects" },
        "POST /api/projects": { name: "create_project" },
      },
      authorize: async ({ request }) =>
        request.headers.get("authorization") ? { subject: "api-user" } : false,
    }),
  ],
});
```

The endpoint defaults to `/api/mcp`. Selected routes keep their normal Farm validation,
endpoint middleware, request context, error responses, and cancellation behavior.

See the [API MCP guide](https://farmjs.dev/docs/plugins/mcp) and the runnable
[`examples/api-mcp`](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp).
