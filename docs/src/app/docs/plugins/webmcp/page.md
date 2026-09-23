---
title: "WebMCP Plugin"
description: "Expose a small, explicit, typed browser tool surface to AI agents with the experimental WebMCP API."
section: "Plugin Ecosystem"
---

# WebMCP Plugin

`@farm.js/webmcp` connects explicitly registered application tools to the browser's experimental
WebMCP API. It uses Farm's client lifecycle to register tools with `document.modelContext`, refresh
them across navigation, and unregister them during route cleanup, HMR, or page close.

WebMCP lets an agent ask the page to perform a named action, such as searching the visible catalog
or adding an item to a cart. It is a browser API, not a network MCP server, so an agent discovers
the tools only while the site is open in a supporting browser.

WebMCP is currently a [Community Group draft](https://webmachinelearning.github.io/webmcp/), not a
W3C Standard. Its API and browser support can still change.

## Install and configure

```bash
pnpm add @farm.js/webmcp
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { webmcp } from "@farm.js/webmcp";

export default defineConfig({
  plugins: [webmcp()],
});
```

The plugin starts the browser adapter. It does not scan routes, server functions, actions, or
queries. No application capability is exposed until client code calls `registerWebMCPTool()`.

## Define one tool

```ts title="src/features/products/search-tool.ts"
import { defineWebMCPTool } from "@farm.js/webmcp/client";

export const searchProducts = defineWebMCPTool({
  name: "search_products",
  title: "Search products",
  description: "Search products currently available in this store.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ query }: { query: string }, { signal }) {
    const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, { signal });
    if (!response.ok) throw new Error(`Product search failed with ${response.status}`);
    return response.json();
  },
});
```

The description and JSON Schema tell the agent when and how to call the tool. `execute` runs in the
page and receives the browser's cancellation signal. Results must be JSON-safe values.

## Own tools with the route

Register a tool only while it is useful. In React, the cleanup returned by
`registerWebMCPTool()` fits directly into an effect:

```tsx title="src/features/products/product-tools.tsx"
"use client";

import { registerWebMCPTool } from "@farm.js/webmcp/client";
import { useEffect } from "react";
import { searchProducts } from "./search-tool";

export function ProductTools() {
  useEffect(() => registerWebMCPTool(searchProducts), []);
  return null;
}
```

Mount `<ProductTools />` in the route that owns product search. Farm unregisters the native tool
when the component unmounts. If two route transitions briefly register the same name, the newest
definition wins; removing it restores the previous live definition.

The API itself is renderer-neutral. Vue, Svelte, Solid, and Preact applications can call the same
registration function from their own mount and disposal lifecycle.

## Add runtime validation and type inference

`inputSchema` is agent-facing metadata. Add `validate` when the application also needs runtime
validation before its handler runs:

```ts
import { defineWebMCPTool } from "@farm.js/webmcp/client";
import { z } from "zod";

const input = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
});

export const addToCart = defineWebMCPTool({
  name: "add_to_cart",
  description: "Add a product and quantity to the signed-in user's cart.",
  inputSchema: z.toJSONSchema(input),
  validate: input,
  async execute({ productId, quantity }, { signal }) {
    const response = await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, quantity }),
      signal,
    });
    if (!response.ok) throw new Error(`Cart update failed with ${response.status}`);
    return response.json();
  },
});
```

Farm infers the `execute` input from Zod and other Standard Schema validators. It also supports
schema objects with `safeParse`, `safeParseAsync`, `parse`, or `parseAsync`. WebMCP sends
`inputSchema`, not the validator, to the browser agent. Use your validator's JSON Schema exporter
when it has one, as Zod does above. Otherwise provide the JSON Schema explicitly.

## Authorization stays on the server

WebMCP input validation is not authentication or authorization. A browser tool is reachable from
the browser, just like a form or client-side API call. The API route, action, or query it calls must
still check the current session and permissions on every request.

```ts title="src/app/api/cart/route.ts"
export async function POST(request: Request) {
  const session = await requireSession(request);
  const input = await validateCartInput(request);
  await assertCanEditCart(session.user.id, input.cartId);
  return Response.json(await updateCart(input));
}
```

The plugin intentionally keeps tools same-origin and does not expose WebMCP's experimental
`exposedTo` option. Be especially careful with secrets, untrusted content in descriptions, and
tools that can spend money, publish content, or delete data.

## Annotations

Annotations help a browser agent understand the risk of an operation:

| Annotation             | Use it when                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `readOnlyHint`         | The tool reads data without changing application or external state. |
| `untrustedContentHint` | The result can contain user-supplied or third-party content.        |
| `consequentialHint`    | The action is significant or difficult to reverse.                  |

These are hints for the browser and agent. They do not enforce permissions or replace a user
confirmation flow in the application.

## Plugin options

```ts
webmcp({
  unsupported: "warn",
  debug: true,
});
```

Adding `webmcp()` to `plugins` enables the browser adapter. Remove it from the array to disable it.

| Option        | Default                             | Purpose                                                        |
| ------------- | ----------------------------------- | -------------------------------------------------------------- |
| `unsupported` | `"warn"` in dev, `"ignore"` in prod | Warn, ignore, or report an unavailable browser API.            |
| `debug`       | `true` in dev, `false` in prod      | Expose `window.__FARM_WEBMCP__` and log tool execution errors. |

In debug mode, inspect current metadata with:

```js
window.__FARM_WEBMCP__?.getTools();
```

## Browser testing

Use the current Chrome WebMCP origin trial or local testing flag described in the
[Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp). Unsupported browsers
continue running the application normally; only the agent tool surface is inactive. A deployed
page also needs the secure context required by the browser API. Localhost is accepted for local
testing.

The runnable [`examples/webmcp-demo`](https://github.com/farming-labs/farm.js/tree/main/examples/webmcp-demo)
registers read and mutation tools, validates inputs with Zod, updates visible UI state, and removes
its tools with the route lifecycle.
