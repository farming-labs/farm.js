---
title: "Plugin Ecosystem"
description: "Use server plugins to extend config, request handling, routing, rendering, bundling, HMR, and lifecycle hooks."
section: "Extending"
---

# Plugin Ecosystem

Use server plugins to extend config, request handling, routing, rendering, bundling, HMR, and lifecycle hooks.

## Use plugins

**farm.config.ts**

```ts
import { createCompressionPlugin, createLoggerPlugin } from "@farmjs/core/plugin/server";

export default defineFarmConfig({
  plugins: [
    createLoggerPlugin({}),
    createCompressionPlugin({}),
  ],
});
```

## Built-in plugins

- Logger for request and lifecycle logging.
- Compression for production response encoding.
- Redirects, rewrites, and headers from farm.config.ts.
- Env helpers for loading and exposing configuration.

## Lifecycle surface

Plugins can observe config resolution, route discovery, route matching, render start and completion, API handlers, bundle steps, Nitro build, HMR updates, errors, and shutdown.
