---
title: "Configuration"
description: "Use farm.config.ts as the single project control plane for source paths, integrations, docs, KV storage, database clients, deployment, and framework behavior."
section: "Start"
---

# Configuration

Use farm.config.ts as the single project control plane for source paths, integrations, docs, KV storage, database clients, deployment, and framework behavior.

## Define config

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
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
  theme: {
    default: "system",
  },
});
```

`srcDir` defaults to `"src"`. Set it only when the application source lives somewhere else.

`defineConfig` is the canonical Farm helper. `defineFarmConfig` remains available as a deprecated exact alias for existing applications.

## TypeScript

Farm transpiles TypeScript through the selected renderer and Vite. It reads the project's normal
`tsconfig.json`, but `farm build` does not run a separate project type check. Keep type checking as
an explicit script so the same command runs locally and in CI:

```json title="package.json"
{
  "scripts": {
    "type-check": "tsc --noEmit"
  }
}
```

A top-level `typescript.tsconfigPath` or `typescript.ignoreBuildErrors` setting has no effect in
Farm. Configure compiler behavior in `tsconfig.json`; point an explicit `tsc -p` command at a
different file when needed.

## Renderer

React remains the default renderer, so existing applications and configurations do not need to
change. Select another renderer when you want to author the UI with that library while keeping
FARMJS routing and server features. See [Renderers](/docs/renderers) for the feature matrix and
dedicated [React](/docs/renderers/react), [Preact](/docs/renderers/preact),
[Solid](/docs/renderers/solid), [Vue](/docs/renderers/vue), and
[Svelte](/docs/renderers/svelte) guides.

### Preact

Install Preact and its FARMJS renderer adapter:

```bash
pnpm add @farm.js/preact@beta preact
```

```ts
import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
});
```

Preact routes use `.tsx` or `.jsx`. The adapter configures Preact JSX, Prefresh, React compatibility
aliases, server rendering and streaming, and browser hydration. See the
[Preact Renderer](/docs/renderers/preact) guide for typed server calls and compatibility boundaries.

Create a ready-to-run Preact application from the CLI:

```bash
pnpm create @farm.js/app@beta my-preact-app --template basic --renderer preact --typescript
```

### Svelte

Install the Svelte adapter and runtime:

```bash
pnpm add @farm.js/svelte@beta svelte
```

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
```

Routes can then use Svelte 5 components directly:

```text
src/app/layout.svelte
src/app/page.svelte
src/app/products/[id]/page.svelte
```

See [Svelte Renderer](/docs/renderers/svelte) for module route exports, layout snippets, hydration,
typed server calls, and current compatibility boundaries.

Create a ready-to-run Svelte application from the CLI:

```bash
pnpm create @farm.js/app@beta my-svelte-app --template basic --renderer svelte --typescript
```

### Vue

Install Vue and its FARMJS renderer adapter:

```bash
pnpm add @farm.js/vue@beta vue
```

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue(),
});
```

Routes can then use Vue Single-File Components directly:

```text
src/app/layout.vue
src/app/page.vue
src/app/products/[id]/page.vue
```

FARMJS compiles the SFCs with Vue's Vite plugin, renders them with `createSSRApp` and
`renderToString`, and hydrates interactive routes in the browser. Layout children are exposed through
Vue's default `<slot />`. See the [Vue server-rendering guide](https://vuejs.org/guide/scaling-up/ssr)
for Vue-specific SSR constraints.

See [Vue Renderer](/docs/renderers/vue) for SFC route exports, hydration, typed server calls, and
current compatibility boundaries.

Create a ready-to-run Vue application from the CLI:

```bash
pnpm create @farm.js/app@beta my-vue-app --template basic --renderer vue --typescript
```

### Solid

Install the Solid adapter and runtime:

```bash
pnpm add @farm.js/solid@beta solid-js
```

```ts
import { defineConfig } from "@farm.js/core";
import { solid } from "@farm.js/solid";

export default defineConfig({
  renderer: solid(),
});
```

The renderer controls component compilation, server rendering, and browser hydration. FARMJS continues
to own routing, layouts, API routes, middleware, data access, observability, and deployment, so those
server features use the same APIs with every renderer. UI code uses the selected library's native
primitives—for example, Solid signals instead of React hooks.

See [Solid Renderer](/docs/renderers/solid) for route conventions, client boundaries, typed server
calls, and current compatibility boundaries.

Create a ready-to-run Solid application directly from the CLI:

```bash
pnpm create @farm.js/app@beta my-solid-app --template basic --renderer solid --typescript
```

Omitting `renderer` selects React. The renderer option is currently available for the Basic starter;
integration starters continue to use React while their UI packages are migrated individually.

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
| renderer      | Selecting React (default) or an adapter such as Preact, Svelte, Vue, or Solid.    |
| api           | Configuring the public root used by Farm's typed browser API client.              |
| integrations  | Registering built-in or custom integrations.                                      |
| auth          | Enabling Farm's built-in email/password auth, sessions, helpers, and hooks.       |
| theme         | Enabling light, dark, and system modes with client and server APIs.               |
| storage       | Configuring KV drivers/mounts and, in the current beta, an integration DB client. |
| migrations    | Running one-shot schema/provider commands with `farm migrate`.                    |
| cron          | Mapping portable UTC schedules to ordinary GET API routes.                        |
| i18n          | Configuring locale routes, detection, message catalogs, typing, and direction.    |
| docs          | Serving the built-in docs runtime and docs API.                                   |
| md            | Restricting or disabling automatic markdown mirrors like /pricing.md.             |
| mdx           | Rendering `page.md` and `page.mdx` app routes, plus MDX components.               |
| telemetry     | Controlling automatic production-site reporting to Farm's usage dashboard.        |
| deploy        | Selecting a target, preset, and output directory.                                 |
| deploymentId  | Detecting stale browser requests during rolling deployments.                      |
| trailingSlash | Choosing the canonical URL shape for application page routes and links.           |
| routeRules    | Applying rendering, cache, redirect, CORS, and header behavior to route patterns. |
| security      | Applying an app-wide CSP with an enforcing or report-only response header.        |
| serverActions | Restricting trusted action origins and request body size.                         |
| images        | Configuring responsive widths, remote allowlists, formats, and optimizer limits.  |
| performance   | Budgeting image and font preload hints without changing the rendered resources.   |
| experimental  | Auditing or enabling opt-in rendering experiments such as isolated hydration.     |
| openapi       | Publishing API reference docs.                                                    |

## Trailing slashes

Application page URLs omit a trailing slash by default. Set `trailingSlash: true` to generate
framework links with a slash and redirect matching page requests to that canonical URL in both
development and production:

```ts title="farm.config.ts"
export default defineConfig({
  trailingSlash: true,
});
```

The redirect uses status 308 and preserves the query string. The root URL remains `/`, and API,
integration, image, and metadata routes keep their own URL contracts. A `<Link trailingSlash={false}>`
or `<Link trailingSlash>` prop overrides the app default for that link.

## API client base URL

Farm's typed API client uses the current origin and `/api` by default. Configure `api` when the
browser should call a different origin or path:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  api: {
    baseURL: ({ mode }) =>
      process.env.GITHUH_API_URL ?? (mode === "development" ? "http://127.0.0.1:8080" : undefined),
    basePath: "/api",
  },
});
```

An origin-only `baseURL`, such as `https://api.example.com`, is joined with `basePath`. If
`baseURL` already contains a path, such as `https://api.example.com/v1`, that path is the API root
and `basePath` is ignored. Both fields accept a string or a sync/async resolver receiving
`{ root, mode, env }`. Farm resolves the function during configuration and only embeds the resulting
public URL in the browser bundle.

A root-relative API root is also mounted by Farm in development and production. For example,
`api: { basePath: "/v2/api" }` makes a route declared at `app/api/users/route.ts` available at
`/v2/api/users`. Farm treats an absolute `baseURL` as external and does not remount the current
application's API routes for it.

The option configures `createAPIClient()` automatically. An explicit per-client `baseURL` still
takes precedence.

## Isolated client hydration

React applications can keep using `"use client"` without enabling React Server Components. By
default, Farm preserves its compatible route-wide hydration behavior. The isolated hydration
experiment lets an otherwise server-rendered page or layout ship and hydrate eligible client leaves
instead of the complete route module:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    isolatedClientHydration: "enabled",
  },
});
```

The option has three modes:

| Mode        | Behavior                                                                     |
| ----------- | ---------------------------------------------------------------------------- |
| `"off"`     | Keeps route-wide hydration. This is the default.                             |
| `"analyze"` | Reports eligible boundaries without changing emitted code or runtime work.   |
| `"enabled"` | Hydrates safe client leaves independently and keeps unsupported routes safe. |

An eligible boundary is a local, statically analyzable `"use client"` module with a default or
named capitalized component export and serializable props. Farm preserves its server-rendered HTML,
emits the client component as a separate browser chunk, and hydrates that leaf as its own React
root. Package boundaries, re-export graphs, ambiguous exports, and routes that still require
route-wide hydration retain the existing behavior. If runtime props cannot be serialized, Farm
preserves the SSR output and leaves that boundary inert instead of executing unsafe client code.

This flag does not enable RSC, change the meaning of `"use client"`, or make Server Components part
of the wire format. Treat `"enabled"` as an experimental performance option and measure the route's
client JavaScript and interaction cost before adopting it broadly.

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

## Preload budgets

Farm keeps one image preload—the explicitly high-priority hint first—and two font preloads by
default. Lower-priority hints above those budgets are removed from buffered HTML and `Link` response
headers, while the actual image and font elements remain unchanged and load normally. Route scripts,
stylesheets, and module preloads are not removed.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  performance: {
    preload: {
      mode: "enforce",
      maxImages: 1,
      maxFonts: 2,
    },
  },
});
```

Farm prints one actionable warning when a route exceeds a budget. Use `mode: "warn"` to audit an
existing application without removing any hints. Mark the likely LCP image with `preload` (or
`fetchPriority="high"`) and set `preload: false` on font declarations that are not needed above the
fold.

## Layers

Use `extends` to compose ordinary Farm-shaped directories and packages. Entries apply from left to right, and project files and configuration have final priority.

```ts
export default defineConfig({
  extends: ["@company/farm-base", "./layers/commerce"],
});
```

A layer may contain an optional plain `farm.config.ts` plus its own `src/app`, components, middleware, APIs, and programmatic routes. It does not use a separate layer registration function. See [Layers](/docs/layers) for package structure, merge rules, aliases, generated types, and override behavior.

## Content Security Policy

Configure an app-wide Content Security Policy under `security.csp`. Farm applies it to pages, API responses, and pre-rendered output through the same response-header pipeline in development and production.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  security: {
    csp: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https:", "wss:"],
      },
    },
  },
});
```

Directive names may use camelCase or kebab-case. Farm rejects duplicate normalized names, newlines, and directive values containing semicolons so configuration cannot accidentally create a second policy directive.

Use report-only mode while auditing an existing application:

```ts
security: {
  csp: {
    reportOnly: true,
    directives: {
      defaultSrc: ["'self'"],
      reportTo: ["csp-endpoint"],
    },
  },
}
```

You can also pass an already serialized policy as `csp: "default-src 'self'; object-src 'none'"`. The longer `contentSecurityPolicy` config name is intentionally unsupported; use `csp`.

Farm currently emits small inline hydration and route-state bootstraps, so the compatible example allows inline scripts and styles. A stricter policy must supply correct hashes or renderer-generated nonces for every trusted inline bootstrap. Start with `reportOnly`, inspect violations, and enforce only after the deployed HTML and every third-party integration satisfy the policy.

## Server HTTP policy

Farm applies one request-body limit to API routes, integrations, workflow HTTP triggers, and uploads handled by those surfaces. The default is 10 MB.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  server: {
    bodySizeLimit: "10mb",
    trustProxy: false,
    headersTimeout: "60s",
    requestTimeout: "5m",
    keepAliveTimeout: "5s",
    gracefulShutdownTimeout: "30s",
    health: {
      livenessPath: "/_farm/health/live",
      readinessPath: "/_farm/health/ready",
    },
  },
});
```

Farm checks `Content-Length` when present and also counts the received bytes, so chunked requests cannot bypass `bodySizeLimit`. Oversized requests receive `413 Payload Too Large` before the route or integration handler runs. Server Actions keep their separate, tighter `serverActions.bodySizeLimit` setting.

`trustProxy` defaults to `false`. Enable it only when the app is behind a trusted reverse proxy that removes client-supplied forwarding headers and writes its own `X-Forwarded-For` value. A directly exposed Farm server must leave it disabled so a client cannot spoof the address used by rate limits, logs, or access policy.

Workflow runner secrets are accepted only through `Authorization: Bearer <secret>` or `X-Farm-Workflow-Secret`. Farm does not accept secrets in query strings because URLs are commonly retained in logs, browser history, and referrer data.

The long-running Node adapter applies `headersTimeout`, `requestTimeout`, and `keepAliveTimeout` to its HTTP server. `headersTimeout` limits how long a client can occupy a connection while sending headers, and `requestTimeout` limits receipt of the complete request. These are transport timeouts, not limits on route-handler or database execution. Durations accept milliseconds or strings such as `"15s"`, `"2m"`, and `"1h"`.

On `SIGTERM` or `SIGINT`, Node output immediately fails readiness, stops accepting connections, drains active responses and streams through Nitro, and then runs Farm integration and plugin cleanup. `gracefulShutdownTimeout` is the maximum drain period before remaining connections are forced closed. The process starts plugin and integration runtime state before it begins listening, so a successful readiness response means startup completed.

Farm exposes two non-cacheable production health handlers by default:

- `GET /_farm/health/live` reports whether the process is alive. It stays successful while the process drains.
- `GET /_farm/health/ready` reports whether the instance should receive traffic. It returns `503` before startup completes and after shutdown begins.

Customize both paths through `server.health`, or set `health: false` when an adapter supplies its own probes. Long-running Node output guarantees the shutdown sequence. Request-driven serverless and edge environments may not expose a reliable process shutdown event, so cleanup there remains platform-specific and must not be required for data correctness.

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

Farm's `redirects()`, `rewrites()`, and `headers()` config functions use the same source pattern
syntax. `:name` captures one path segment, while `:name*` and plain `*` capture the remaining
characters. Redirect and rewrite destinations can reuse named captures or use numbered captures
such as `$1`. All other source characters are matched literally.

```ts
export default defineConfig({
  async redirects() {
    return [{ source: "/old/:path*", destination: "/new/:path*", permanent: true }];
  },
});
```

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
import { stripe } from "@farm.js/stripe";
import { supabase } from "@farm.js/supabase";

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

Use `migrations.commands` when the app needs a predictable command before build or deploy. This keeps schema setup close to the database and integration config without turning the framework into a migration engine.

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

## Production-site telemetry

Farm production server runtimes automatically detect their public HTTPS origin from incoming
requests and report it to Farm's production-sites dashboard. No URL configuration is required. To
disable this product telemetry for a deployment:

```ts title="farm.config.ts"
export default defineConfig({
  telemetry: false,
});
```

Farm schedules a small check-in after the first non-health production request and never waits for it
before returning the application response. Only the detected origin, Farm version, renderer, and
deployment target are sent. See [Product telemetry](/docs/telemetry) for validation, privacy,
retention, preview-environment, opt-out, and static-export details.

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
- Use `storage.driver` and `storage.mounts` for KV data read through `getStorage()`.
- Use a raw object at `storage.client` only when schema-backed integrations need a database client; see [Database and ORM Clients](/docs/integrations/orm-storage).
- Use `migrations.commands` for schema setup that should be explicit in CI.
- Use `docs.entry` when the docs runtime should be mounted automatically.
- Prefer route-level exports such as `dynamic`, `revalidate`, and `ppr` when behavior belongs to one page.
- Prefer `routeRules` for broad URL patterns and platform-level cache/header behavior.
- Keep `serverActions.allowedOrigins` empty unless the deployment has a known proxy-origin mismatch.
- Give every rolling release one stable `deploymentId`; do not generate a different value per server instance.
- Treat every server action as a public endpoint and authorize the current user inside the action or middleware.
- Keep `farm.config.ts` as the single control plane instead of spreading framework behavior across many root files.
