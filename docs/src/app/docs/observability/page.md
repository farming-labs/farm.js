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

## Configure in farm.config.ts

Use config-level observability when an app should log or forward events from startup.

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  observability: {
    logs: true,
    events: ["cache.hit", "cache.miss", "ppr.shell.cached"],
    onEvent(event) {
      if (event.type === "cache.miss") {
        console.log("Cache miss", event.key, event.reason);
      }
    },
  },
});
```

`events` is optional. Leave it out to receive every emitted event.

## Runtime subscription

Use `onFarmEvent` for tests, local debugging, or integration packages that want to register listeners without owning app config.

```ts
import { onFarmEvent } from "@farmjs/core/observability";

const unsubscribe = onFarmEvent((event) => {
  if (event.type === "integration.webhook.failed") {
    console.error(event.integration, event.reason);
  }
});

unsubscribe();
```

## Useful event types

| Area | Events |
| --- | --- |
| Cache | `cache.hit`, `cache.miss`, `cache.set`, `cache.stale`, `cache.bypass`, `cache.invalidated`, `cache.revalidatePath`, `cache.revalidateTag`, `cache.updateTag`, `cache.error` |
| PPR | `ppr.shell.hit`, `ppr.shell.miss`, `ppr.shell.cached`, `ppr.shell.bypass`, `ppr.shell.invalidated`, `ppr.suspense.holeDetected`, `ppr.refresh.start`, `ppr.refresh.complete`, `ppr.refresh.error` |
| API | `api.request.start`, `api.request.complete`, `api.validation.failed`, `api.error` |
| Integrations | `integration.registered`, `integration.config.validated`, `integration.ready`, `integration.disposed`, `integration.api.call.start`, `integration.api.call.complete`, `integration.webhook.verified`, `integration.webhook.failed` |
| Middleware | `middleware.start`, `middleware.complete`, `middleware.shortCircuit`, `middleware.error` |
| Storage | `storage.query.start`, `storage.query.complete`, `storage.query.error`, `storage.schema.ready`, `storage.schema.error` |

## Production notes

- Filter high-volume events before shipping them to a log drain.
- Attach request IDs in middleware so event streams can be correlated.
- Treat event payloads as operational metadata; do not put secrets in event fields.
- Watch `api.validation.failed`, `integration.webhook.failed`, `cache.error`, and `ppr.refresh.error` in production.
