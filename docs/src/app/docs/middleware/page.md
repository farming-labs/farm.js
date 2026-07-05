---
title: "Middleware"
description: "Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses."
section: "Core"
---

# Middleware

Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.

## Route middleware

Middleware can live near the routes it protects. Use it for auth, request metadata, A/B flags, rate limit checks, or headers that belong to an area of the app.

**src/app/dashboard/middleware.ts**

```ts
import { defineMiddleware } from "@farmjs/core/middleware";

export default defineMiddleware(async ({ request, next, context }) => {
  context.data.set("request.startedAt", Date.now(), { exposeToPage: true });
  return next(request);
});
```

## Config matchers

Use farm.config.ts when middleware behavior should be described globally.

**farm.config.ts**

```ts
export default defineFarmConfig({
  middleware: {
    matcher: ["/dashboard/:path*"],
  },
});
```
