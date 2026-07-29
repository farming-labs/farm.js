---
title: "Configuration"
description: "Use farm.config.ts as the single project control plane for source paths, integrations, docs, storage, deployment, and framework behavior."
section: "Start"
---

# Configuration

Use farm.config.ts as the single project control plane for source paths, integrations, docs, storage, deployment, and framework behavior.

## Define config

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
  docs: {
    entry: "/docs",
  },
  md: {
    expose: ["/", "/pricing"],
    cache: 60,
  },
  mdx: {
    components: "./src/markdown-components.tsx",
  },
});
```

`defineConfig` is the canonical Farm helper. `defineFarmConfig` remains available as a deprecated exact alias for existing applications.

### Docs config

Configure the docs runtime directly in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  docs: {
    entry: "/docs",
    metadata: {
      description: "Product guides and API reference.",
    },
    nav: {
      title: "Acme Docs",
    },
    search: {
      provider: "simple",
      enabled: true,
    },
    pageActions: {
      copyMarkdown: {
        enabled: true,
      },
    },
    llmsTxt: true,
    sitemap: true,
    robots: true,
  },
});
```

This single property enables human-readable pages, markdown mirrors, search metadata, and
agent-readable docs routes. A separate `docs.config.*` or `docs.json` file is optional and intended
only for large serializable configurations; inline values always take priority. See
[Docs Engine](/docs/docs-engine) for content layout, generated routes, and API overrides.

The same `search` option configures the search provider and the docs interface. When it is enabled,
Farm mounts the shared Omni React search from `@farming-labs/theme`. The sidebar control and
`Cmd+K` on macOS or `Ctrl+K` elsewhere open the same search interface used by the other Farming Labs
framework adapters. Set `search: false` or `search.enabled: false` to remove the control, client
mount, and shortcut together.

## Important options

| Option        | Use it for                                                                        |
| ------------- | --------------------------------------------------------------------------------- |
| extends       | Composing local or package Farm layers with project-first overrides.              |
| srcDir        | Changing the app source folder from the default src.                              |
| integrations  | Registering built-in or custom integrations.                                      |
| storage       | Providing storage clients and mounts for framework and integration code.          |
| migrations    | Running one-shot schema/provider commands with `farm migrate`.                    |
| cron          | Mapping portable UTC schedules to ordinary GET API routes.                        |
| i18n          | Configuring locale routes, detection, message catalogs, typing, and direction.    |
| docs          | Serving the built-in docs runtime and docs API.                                   |
| md            | Exposing markdown mirrors like /pricing.md.                                       |
| mdx           | Rendering `page.md` and `page.mdx` app routes, plus MDX components.               |
| deploy        | Selecting a target, preset, and output directory.                                 |
| deploymentId  | Detecting stale browser requests during rolling deployments.                      |
| routeRules    | Applying rendering, cache, redirect, CORS, and header behavior to route patterns. |
| serverActions | Restricting trusted action origins and request body size.                         |
| images        | Configuring responsive widths, remote allowlists, formats, and optimizer limits.  |
| openapi       | Publishing API reference docs.                                                    |

## Images

Farm optimizes local and allowlisted remote images through the same runtime on development and production deployments.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.example.com",
        pathname: "/catalog/**",
      },
    ],
    qualities: [75, 90],
    formats: ["image/avif", "image/webp"],
    maximumResponseBody: "10mb",
  },
});
```

Remote sources are denied by default. See [Images](/docs/images) for static imports, responsive layouts, provider selection, caching, and security behavior.

## Layers

Use `extends` to compose ordinary Farm-shaped directories and packages. Entries apply from left to right, and project files and configuration have final priority.

```ts
export default defineConfig({
  extends: ["@company/farm-base", "./layers/commerce"],
});
```

A layer may contain an optional plain `farm.config.ts` plus its own `src/app`, components, middleware, APIs, and programmatic routes. It does not use a separate layer registration function. See [Layers](/docs/layers) for package structure, merge rules, aliases, generated types, and override behavior.

## Server action security

Server actions are same-origin application RPC endpoints. Farm rejects cross-origin action requests by default and limits the encoded request body to 1 MB.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
    serverActions: true,
  },

  serverActions: {
    allowedOrigins: [],
    bodySizeLimit: "1mb",
  },
});
```

`allowedOrigins` adds trusted origins when a reverse proxy or multi-origin deployment makes the browser origin differ from the server request origin. Entries can be exact origins, hosts, or leftmost-subdomain wildcards:

```ts
serverActions: {
  allowedOrigins: [
    "https://app.example.com",
    "proxy.internal:8443",
    "https://*.preview.example.com",
  ],
}
```

Do not use `allowedOrigins` as a replacement for CORS or as a public API allowlist. Browser action requests must provide a matching `Origin` or `Referer`; Farm accepts `Sec-Fetch-Site: same-origin` when both are unavailable. Explicitly configured origins can cross a trusted proxy boundary.

`bodySizeLimit` accepts bytes or strings such as `"500kb"`, `"2mb"`, and `"2MiB"`. Farm checks `Content-Length` when present and also counts streamed bytes, so chunked requests cannot bypass the limit.

Rejected requests use generic, non-cacheable responses: `403` for origin failures, `413` for oversized bodies, and `415` for unsupported content types. Detailed parsing or execution errors stay in server logs.

## Next-style route exports

Farm route modules can expose compact rendering options directly on the page when the behavior belongs to that route.

**src/app/blog/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 60;

export default async function BlogPage() {
  return <main>...</main>;
}
```

## Route rules

Use `routeRules` when behavior belongs to a URL pattern instead of one page file. Rules are normalized into Farm redirects/headers and passed to Nitro route rules for production adapters.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  routeRules: {
    "/": { prerender: true },
    "/blog/**": { swr: 3600 },
    "/admin/**": { render: "dynamic" },
    "/api/**": { cors: true },
    "/assets/**": {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
    "/old": { redirect: "/new" },
  },
});
```

`render: "static"` maps to prerendering. `render: "dynamic"` forces a dynamic response. `swr` and `isr` accept `true` or a TTL in seconds. `cors: true` applies permissive API CORS headers; pass an object when you need a specific origin, methods, or headers.

Rules can also provide `runtime`, `regions`, and `maxDuration` defaults. File pages, API routes, and layouts can override them with named exports. See [Route Runtime](/docs/route-runtime) for inheritance and deployment behavior.

Prefer route-level exports when one page owns the behavior. Prefer `routeRules` for broad groups, deployment-facing cache policy, API CORS, static asset headers, and legacy redirects.

## Minimal project layout

Farm keeps the base project small:

```txt
farm.config.ts
src/
  app/
    page.tsx
```

Add optional files only when the app needs them:

```txt
docs.config.ts              # Optional split for a large docs configuration
docs.json                   # Optional serializable docs configuration
src/app/api/**/route.ts
src/app/**/middleware.ts
src/lib/integrations.ts
```

## Cron in config

Cron entries keep timing policy in `farm.config.ts` while application work stays in an ordinary API route.

```ts
export default defineConfig({
  cron: {
    dailyCleanup: {
      schedule: "0 2 * * *",
      path: "/api/maintenance/cleanup",
    },
  },
});
```

See [Cron](/docs/cron) for route protection, local commands, UTC syntax, deployment behavior, and reliability boundaries.

## Integrations in config

```ts
import { defineConfig } from "@farm.js/core";
import { stripe } from "@farm.js/integrations/stripe";
import { supabase } from "@farm.js/integrations/supabase";

export default defineConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
    }),
    auth: supabase({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    }),
  },
});
```

The keys become typed namespaces. `billing` becomes `api.billing`, and `auth` becomes `api.auth`.

## One-shot migrations

Use `migrations.commands` when the app needs a predictable command before build or deploy. This keeps schema setup close to the storage and integration config without turning the framework into a migration engine.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  migrations: {
    commands: [
      "pnpm drizzle-kit migrate",
      {
        name: "integration schema",
        command: "farm generate --orm sqlite --output ./farm-integrations.sql",
        env: {
          FARM_SCHEMA: "integrations",
        },
      },
    ],
  },
});
```

Run them with:

```bash
farm migrate
```

Each command runs from the project root unless it sets `cwd`. Commands run in order and the CLI stops on the first failure.

## Deployment config

```ts
export default defineConfig({
  deploy: {
    target: "vercel",
    outputDir: ".vercel/output",
  },
});
```

`deploy.target` selects the deployment provider. Farm resolves that to the matching Nitro preset and output shape unless you override it.

### Deployment identity

Farm assigns one deployment ID to the server and browser output so requests from an older open page can be detected safely.

```ts
export default defineConfig({
  deploymentId: process.env.RELEASE_ID,
});
```

When `deploymentId` is omitted, Farm checks `FARM_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_SHA`, and `CF_PAGES_COMMIT_SHA`, then calls `generateBuildId` for production builds. Development uses `"development"`.

For a custom build ID, return one stable value for every instance of the same release:

```ts
export default defineConfig({
  generateBuildId: async () => process.env.GIT_SHA || `build-${Date.now()}`,
});
```

Prefer a CI release or commit identifier when a deployment runs on multiple servers. See [Deployment](/docs/deployment#rolling-deployment-safety) for mismatch behavior.

## Production notes

- Keep secrets in environment variables, not committed config.
- Use `storage.client` when integrations need schema-backed persistence.
- Use `migrations.commands` for schema setup that should be explicit in CI.
- Use `docs.entry` when the docs runtime should be mounted automatically.
- Prefer route-level exports such as `dynamic`, `revalidate`, and `ppr` when behavior belongs to one page.
- Prefer `routeRules` for broad URL patterns and platform-level cache/header behavior.
- Keep `serverActions.allowedOrigins` empty unless the deployment has a known proxy-origin mismatch.
- Give every rolling release one stable `deploymentId`; do not generate a different value per server instance.
- Treat every server action as a public endpoint and authorize the current user inside the action or middleware.
- Keep `farm.config.ts` as the single control plane instead of spreading framework behavior across many root files.
