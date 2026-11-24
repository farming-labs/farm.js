# @farm.js/webmcp

Explicit, typed browser tools for Farm applications using the experimental WebMCP API.

This package is experimental. WebMCP is a Community Group draft, not a W3C Standard.

## Install

```bash
pnpm add @farm.js/webmcp
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { webmcp } from "@farm.js/webmcp";

export default defineConfig({
  plugins: [webmcp()],
});
```

Define tools in client code and register them only while they are relevant:

```ts
import { defineWebMCPTool, registerWebMCPTool } from "@farm.js/webmcp/client";

const searchProducts = defineWebMCPTool({
  name: "search_products",
  description: "Search products currently available in this store.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ query }: { query: string }, { signal }) {
    const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, { signal });
    return response.json();
  },
});

const unregister = registerWebMCPTool(searchProducts);
// Call unregister() when this tool is no longer valid for the current page.
```

Pass a Zod, Valibot, ArkType, or other Standard Schema validator through `validate` when the input
must also be checked at runtime. Keep `inputSchema` because that JSON Schema is what the browser
agent sees.

## Analytics

When the app's server is linked to Farm Infra analytics (`FARMJS_API_KEY`), the page reports each
tool call to its own server after the call settles: the tool name, whether it succeeded, its
duration, the page's path, and the call's arguments and result (left out above 8 KB). The server
redacts secret-looking keys and sends it to Farm Infra under the page's route. Reporting never
delays or changes a tool's result. Without a linked server the page stops after the first 404.

Reports come from visitors' browsers and aren't authenticated, like any page analytics. Turn them
off with `webmcp({ analytics: false })`.

## Security boundary

The plugin never scans or exposes Farm server functions. Each tool is an explicit browser-side
registration. JSON Schema and `validate` protect the handler's input shape, but they are not
authorization. Any API, query, or action called by a tool must still verify the server session and
permissions exactly like a normal browser request.

Tools stay same-origin by default. The plugin intentionally does not expose the draft `exposedTo`
option in its first version.
