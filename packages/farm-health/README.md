# `@farm.js/health`

Dependency-aware liveness, readiness, and startup probes for Farm.js applications.

```ts
import { defineConfig } from "@farm.js/core";
import { health } from "@farm.js/health";

export default defineConfig({
  plugins: [
    health({
      checks: {
        database: () => database.execute("select 1"),
        cache: {
          check: () => redis.ping(),
          required: false,
          timeout: "500ms",
        },
      },
    }),
  ],
});
```

The plugin serves `/health/live`, `/health/ready`, and `/health/startup`, respects Farm's
`basePath`, runs checks concurrently with bounded timeouts, and never returns provider errors or
stack traces. Required failures return `503`; optional failures return `200` with a `degraded`
status. Exact runtime endpoints keep the checks off ordinary requests and preserve static pages.

See the [Farm Health documentation](https://farmjs.dev/docs/plugins/health) for probe semantics,
startup checks, Kubernetes configuration, safe details, and platform limits.
