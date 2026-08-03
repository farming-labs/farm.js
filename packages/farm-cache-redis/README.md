# @farm.js/cache-redis

Redis-backed distributed cache for Farm.js applications. It provides shared cache entries,
atomic tag invalidation, and ownership-safe regeneration leases across server instances.

## Install

```bash
pnpm add @farm.js/cache-redis ioredis
```

## Configure

```ts
import { redisCache } from "@farm.js/cache-redis";
import { defineConfig } from "@farm.js/core";
import Redis from "ioredis";

export default defineConfig({
  cache: {
    adapter: redisCache({
      client: () => new Redis(process.env.REDIS_URL!),
    }),
    namespace: process.env.FARM_CACHE_NAMESPACE || "storefront",
  },
});
```

Farm uses the shared adapter for cached queries, ISR and PPR output, and tag/path invalidation.
Application code keeps using the cache APIs from `@farm.js/core/cache`.

Use a distinct namespace for each application or deployment environment. Do not put
user-specific values in shared keys unless the key includes the user or tenant identity.

## Atomic rate limits

KV `get()` followed by `set()` is not safe for enforcing a request limit across concurrent
instances. Use the dedicated adapter, which increments and expires the counter in one Redis Lua
operation:

```ts
import { redisRateLimitStorage } from "@farm.js/cache-redis";
import { middleware } from "@farm.js/core/middleware";
import Redis from "ioredis";

const rateLimits = redisRateLimitStorage({
  client: () => new Redis(process.env.REDIS_URL!),
  prefix: "storefront-ratelimit",
});

export default middleware().rateLimit({
  requests: 100,
  window: "1m",
  storage: rateLimits,
});
```
