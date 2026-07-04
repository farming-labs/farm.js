---
title: "Create a Plugin"
description: "Build a plugin with definePlugin when app behavior belongs in reusable framework lifecycle hooks."
section: "Extending"
---

# Create a Plugin

Build a plugin with definePlugin when app behavior belongs in reusable framework lifecycle hooks.

## Define a plugin

**src/lib/request-id-plugin.ts**

```ts
import { definePlugin } from "@farmjs/core";
import { randomUUID } from "node:crypto";

export const requestIdPlugin = definePlugin({
  name: "request-id",
  beforeRequest(req, _res, context) {
    context.requestContext.set(req, "request.id", randomUUID(), {
      exposeToPage: true,
    });
  },
});
```

## Register it

**farm.config.ts**

```ts
import { requestIdPlugin } from "./src/lib/request-id-plugin";

export default defineFarmConfig({
  plugins: [requestIdPlugin],
});
```
