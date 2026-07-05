---
title: "Observability"
description: "Listen to Farm runtime events for server lifecycle, route matching, rendering, API routes, integrations, storage, cache, PPR, builds, plugins, and errors."
section: "Runtime"
---

# Observability

Listen to Farm runtime events for server lifecycle, route matching, rendering, API routes, integrations, storage, cache, PPR, builds, plugins, and errors.

## Subscribe to events

**farm.config.ts**

```ts
import { onFarmEvent } from "@farmjs/core/observability";

onFarmEvent((event) => {
  if (event.level === "error") {
    console.error("[farm]", event.type, event);
  }
});
```

## Event families

| Family | Examples |
| --- | --- |
| Server | server.start, server.ready, server.shutdown |
| Routing | route.discovered, route.matched, route.notFound, route.redirect |
| Rendering | render.start, render.complete, render.stream.shellReady, render.error |
| Cache | cache.hit, cache.miss, cache.set, cache.revalidateTag |
| PPR | ppr.shell.hit, ppr.shell.cached, ppr.shell.invalidated |
| Integrations | integration.ready, integration.api.call.start, integration.webhook.verified |
| Storage | storage.query.start, storage.schema.ready |
| Build | build.start, routes.generated, types.generated, manifest.generated |
