---
name: farmjs
description: Build, debug, migrate, document, test, and deploy Farm.js applications and integrations. Use for Farm.js config, file routing, React/Preact/Solid/Vue/Svelte renderers, typed APIs and server queries, auth, storage, jobs, docs, themes, i18n, plugins, previews, observability, migrations, and deployment targets.
---

# Farm.js

Farm.js is a full-stack application framework in active development. Treat the checked-out repository as the source of truth; do not infer current APIs from an older beta or another framework:

- Docs: `README.md`, `docs/src/app/docs/**`
- Core package: `packages/farm/src/**`
- CLI: `packages/cli/src/**`
- Integration package: `packages/farm-integrations/src/**`
- Examples: `examples/**`
- Current version: read `packages/farm/package.json` and keep all `@farm.js/*` packages aligned

Use `rg` first when locating files. Read the closest example before adding new code.

## Default Workflow

1. Inspect `package.json`, the lockfile, `farm.config.ts`, and `src/app`:
   - App config: `farm.config.ts`
   - Pages/layouts: `src/app/**`
   - Integration setup: `src/lib/integrations.ts`
   - Typed client export: `src/lib/api.ts`
   - Generated project types: `src/farm.d.ts`
2. Identify the selected renderer and deployment target before generating component code.
3. Preserve the app's package manager, source layout, config, renderer, and deployment contract.
4. Match existing patterns in the nearest current example.
5. For provider integrations, verify both static types and the target-specific production build.
6. If touching Prisma, run `prisma generate` immediately before `tsc` or `farm build`.
7. Use `farm doctor` or `farm explain <path>` instead of guessing resolved runtime behavior.

## App Structure

Farm.js uses an app directory:

```text
src/app/
  layout.tsx          # Root or nested layout
  page.tsx            # Route page
  loading.tsx         # Optional loading boundary
  error.tsx           # Optional error boundary
  users/[id]/page.tsx # Dynamic route
```

Core imports:

```ts
import type { PageProps, LayoutProps } from "@farm.js/core";
import { Link, createIntegrations } from "@farm.js/core/client";
```

Use `"use client"` when a component uses React hooks, browser APIs, or client-only integration calls.

## Create, Upgrade, and Renderers

Follow the current beta channel for beta apps and use `pnpm create`, not `pnpm add`:

```bash
pnpm create @farm.js/app@beta my-app --template basic --typescript
pnpm create @farm.js/app@beta my-app --template basic --renderer vue --typescript
pnpm create @farm.js/app@beta --list-templates
```

React is the default renderer. The Basic and Better Auth starters support `react`, `preact`,
`solid`, `vue`, and `svelte`; other integration starters may remain React-specific. Select a
non-default renderer through its adapter in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({ renderer: vue() });
```

React and Preact routes use `.tsx`/`.jsx`, Solid uses `.tsx`/`.jsx`, Vue uses `.vue`, and Svelte
uses `.svelte`. Do not mix renderer component formats in one route tree. Use renderer-native client
bindings from `@farm.js/solid/bindings`, `@farm.js/vue/bindings`, or
`@farm.js/svelte/bindings`; keep APIs, middleware, secrets, storage, and deployment renderer-neutral.

Upgrade every published Farm package together:

```bash
farm upgrade --beta
farm upgrade --latest
farm upgrade --beta --dry-run
```

Preserve local `workspace:`, `file:`, `link:`, `portal:`, and `catalog:` dependencies.

## Config Spec

Farm apps use `defineConfig`. The older `defineFarmConfig` name remains available as a deprecated exact alias:

```ts
import { defineConfig } from "@farm.js/core";
import { appIntegrations } from "./src/lib/integrations.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: appIntegrations,
});
```

Common config fields:

- `extends`: compose local or package layers with project-first overrides
- `srcDir`: app source directory; omit it to use the default `src`
- `renderer`: React by default or a Preact, Solid, Vue, or Svelte adapter
- `api`: typed browser API origin and base path
- `experimental.serverComponents`: enables server component behavior
- `integrations`: provider integrations object
- `auth`: built-in email/password auth and sessions
- `theme`: light, dark, and system behavior
- `storage.mounts`: named storage instances
- `migrations`: one-shot schema and provider commands
- `i18n`: locale routes, detection signals, typed ICU catalogs, formatting, and RTL
- `cron`: named portable UTC schedules mapped to GET API routes
- `docs`, `md`, `mdx`: docs runtime, markdown mirrors, and MDX components
- `deploy`: first-class target, Nitro preset, and output
- `routeRules`: rendering, cache, redirects, CORS, and headers by route pattern
- `security`: application CSP policy
- `serverActions`: trusted origins and action body limits
- `images`, `performance`: image policy and preload budgets
- `openapi`: generated API reference
- `plugins`: Farm plugins
- `redirects()`, `headers()`, `rewrites()`: route behavior
- `vite`: underlying Vite config
- `suppressLintOnLink`: relax generated route typing for `Link href`

Read `docs/src/app/docs/configuration/page.md` before adding an unfamiliar option.

## Routing Spec

- `src/app/page.tsx` maps to `/`
- `src/app/about/page.tsx` maps to `/about`
- `src/app/users/[id]/page.tsx` maps to `/users/:id`
- `src/app/docs/[...slug]/page.tsx` maps to catch-all docs paths
- `[[...slug]]` is optional catch-all; route groups do not appear in URLs
- Named slots and intercepted routes are supported
- Farm writes typed `Link href` declarations into `src/farm.d.ts`
- Typed `href` supports query strings and hashes, for example `/users/123?tab=profile`
- File boundaries include `loading`, `error`, and `not-found`
- Route exports or route rules select dynamic, static, ISR, PPR, runtime, and cache behavior

Page shape:

```tsx
import type { PageProps } from "@farm.js/core";

export default function UserPage({ params, searchParams }: PageProps) {
  return <div>User: {params?.id}</div>;
}
```

Layout shape:

```tsx
import type { LayoutProps } from "@farm.js/core";

export default function RootLayout({ children }: LayoutProps) {
  return <main>{children}</main>;
}
```

Farm.js owns the `<html>`, `<head>`, and `<body>` document shell. Root layouts return application
UI or a fragment; metadata exports and framework configuration control the managed document.

## Internationalization Spec

Configure i18n directly in `farm.config.ts`; do not add a second i18n config file:

```ts
export default defineConfig({
  i18n: {
    locales: ["en", "fr", "ar"],
    defaultLocale: "en",
    fallbackLocale: "en",
    routing: "prefix-except-default",
    strict: true,
  },
});
```

Put nested JSON catalogs at `src/messages/<locale>.json`. Farm writes their declarations into
`src/farm.d.ts`, so message keys and ICU variables are checked by TypeScript.

Server modules import from `@farm.js/core/i18n/server`:

```ts
import { getLocale, t } from "@farm.js/core/i18n/server";

const locale = getLocale();
const label = t("cart.items", { count: 3 });
```

Client components import from `@farm.js/core/i18n/client`:

```tsx
"use client";

import { useLocale, useTranslations } from "@farm.js/core/i18n/client";

const { locale, locales, setLocale } = useLocale();
const t = useTranslations();
```

Explicit locale URLs win over the locale cookie and weighted `Accept-Language`. Farm preserves the
active locale in `Link`, redirects, middleware matching, page-data navigation, cache keys, metadata
image URLs, and generated `lang`, `dir`, and `hreflang` markup. API routes stay available at their
normal `/api/**` paths and can call the same server APIs. Read
`docs/src/app/docs/internationalization/page.md` and `examples/i18n` before changing this feature.

## Typed APIs and Server Data

API routes live under `src/app/api/**/route.ts`. Prefer `createEndpoint` from
`@farm.js/core/api` when input validation and generated caller types matter; plain HTTP method
exports remain supported. Endpoint input accepts Zod or standard-schema validators for body, query,
and headers. Farm also supports typed HTTP `QUERY`, multipart uploads, and streamed JSON results.

Use `createAPIClient` from `@farm.js/core/client` for app routes. Calls such as
`api.products.get(...)` resolve to `{ data, error }` results for HTTP failures and support caching,
invalidation, retries, callbacks, optimistic updates, `useMutation`, and `useFetcher`.

For integration APIs, use `createIntegrations<AppIntegrations>()` and preserve the configured
namespace:

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

Use `createServerFn` for typed mutations/actions and `createServerQuery` for typed reads,
deduplication, prefetch, stale-while-revalidate, focus/reconnect refresh, and structured invalidation.
Browser server query/action references require Farm's documented server-function transform. Without
it, keep the handler server-only and expose an API route instead.

Parse route and search values with `loadRouteParams`, `loadSearchParams`, and the parsers in
`@farm.js/core/query/server`. React client URL state uses `useQueryState` or `useQueryStates` from
`@farm.js/core/query/client`. Preserve repeated values with `asArrayOf`.

## Integration Spec

Define integrations in a server-only module and attach the registry in `farm.config.ts`:

```ts
import { stripe } from "@farm.js/stripe";

export const appIntegrations = {
  billing: stripe({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

The object key is the application namespace, so `billing` becomes `api.billing`. An integration
may contribute routes/endpoints, typed callers, middleware, React providers, database schemas,
validated config, plugins, setup/ready/dispose hooks, and runtime logs. Prefer `integrationRoute.*`
or `endpoint.*` when the integration owns handlers and should generate caller types. An explicit
`api` field describes callers only; it does not mount HTTP routes.

## Provider Integrations and Auth

New apps import dedicated adapter packages such as `@farm.js/stripe`, `@farm.js/clerk`,
`@farm.js/resend`, or `@farm.js/jobs`. The older `@farm.js/integrations/*` paths are
compatibility re-exports, not the preferred authoring surface.

Use the CLI to keep package versions and wiring aligned:

```bash
farm add integration --list
farm add integration stripe
farm add integration stripe --ui
farm add integration jobs-trigger
```

Current integration families include AI, Stripe, Autumn, Polar, Resend, Trigger.dev, Inngest,
Unkey, Cloudflare agents, Eve, Auth0, Auth.js, Better Auth, Clerk, Supabase, WorkOS, custom
integrations, UI registries, and ORM-backed data.

Provider adapters support two ownership modes: pass credentials so the adapter constructs its
default SDK, or pass an app-owned vendor client through `instance`. Keep the vendor instance in a
server-only module. Export the integration registry type so `createIntegrations` can infer callers.

For ordinary email/password auth, install `@farm.js/auth` and use top-level `auth: true`. Read
sessions through `auth.session()` or `auth.user()` from `@farm.js/auth/server`, and run
`farm auth migrate` before production traffic. Use an explicit auth integration when the app must
own Better Auth plugins/adapters or a provider-specific SDK. Never configure top-level `auth` and
`integrations.auth` together.

Custom integrations use `defineIntegration`, `integrationRoute` or `endpoint`, schema-validated
config, lifecycle hooks, middleware, providers, database schemas, and typed caller contracts. Read
`docs/src/app/docs/integrations/custom/page.md` and the closest dedicated provider guide before
implementing one.

## Storage Spec

Storage helpers live under `@farm.js/core/storage`:

```ts
import { getStorage, sqliteStorage, redisStorage } from "@farm.js/core/storage";

const sqlite = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});

export default defineConfig({
  storage: {
    mounts: {
      app: sqlite,
    },
  },
});

const appStore = getStorage("app");
await appStore.setItem("settings", { theme: "light" });
```

Known helpers include memory, local, sqlite, postgres, mysql, redis, mongodb, s3, upstash, vercelKV, pglite, and libsql.

## Cron Spec

Framework Cron maps portable five-field UTC schedules to ordinary GET API routes. Keep timing in `farm.config.ts` and business logic in the route:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  cron: {
    dailyCleanup: {
      schedule: "0 2 * * *",
      path: "/api/maintenance/cleanup",
    },
  },
});
```

```ts
import { cronRoute } from "@farm.js/core/cron";

export const GET = cronRoute(async () => {
  await deleteExpiredSessions();
  return Response.json({ ok: true });
});
```

Use `farm cron list`, `farm cron run dailyCleanup`, or the opt-in local scheduler `farm dev --cron`. `cronRoute()` verifies `CRON_SECRET` when configured and fails closed in production when it is missing.

Builds always emit `.farm/cron-manifest.json`. Vercel compiles entries to Build Output API crons, Cloudflare Workers using `cloudflare-module` get Wrangler triggers, and Node/Bun/Deno targets use Nitro scheduling. Treat delivery as at least once: make handlers idempotent and use uniqueness keys or distributed locks where overlap matters. Use the Jobs integration for durable retries, steps, queues, status, or long-running work. The older `defineCron()` API is compatibility-only; new apps use config plus a route.

## Plugin Spec

Use `definePlugin` for custom behavior:

```ts
import { definePlugin } from "@farm.js/core";

export const plugin = definePlugin({
  name: "request-context-demo",
  beforeRequest(req, _res, context) {
    context.req.set("demo.path", req.url, {
      exposeToPage: true,
    });
  },
});
```

Built-in server plugins are imported from `@farm.js/core/plugin/server`, including logger and compression helpers. Plugins run in order; use `enforce: "pre"` or `enforce: "post"` when order matters.

## Content, Runtime, and Deployment

- Configure fonts through Farm so local or remote assets are self-hosted and hashed.
- Configure `theme` for no-flash light/dark/system rendering and typed client/server access.
- Use Farm image helpers plus the `images` allowlist and format policy for optimization.
- Use `docs` for human docs, shared search, markdown, `llms.txt`, sitemap, robots, and agent APIs.
- Use `md`/`mdx` for page mirrors and content routes; use `openapi` for API references.
- Use `after()` only for short post-response work and a jobs integration for durable work.
- Configure OpenTelemetry and Farm runtime events for correlated traces.

`farm preview` exposes an already-running local app; it does not build or deploy. Bind remote
sandbox development servers with `farm dev --host 0.0.0.0 --port <port>`. For deployment,
prefer `deploy.target` for first-class targets and `deploy.preset` only for Nitro pass-through. A
preset overrides a target. Use `farm deploy --plan` before shipping and run the exact target build.

Current diagnostic and migration commands include:

```bash
farm doctor
farm doctor --offline
farm doctor --fix
farm explain /products/42
farm generate --check
farm migrate inspect
farm migrate next --write
farm migrate tanstack --write
farm telemetry status
```

## Verification Commands

For an application, use its declared package manager and scripts:

```bash
pnpm farm generate --check
pnpm typecheck
pnpm build
```

Run the target-specific build when deployment behavior matters. For framework work, start focused
and then broaden:

```bash
pnpm --filter @farm.js/core test
pnpm --filter @farm.js/cli test
pnpm build
pnpm lint
```

Use the nearest current example's scripts instead of remembered example paths. If Prisma is involved,
run its client generation immediately before type checking or building.

## Common Pitfalls

- Import `Link`, `createAPIClient`, and `createIntegrations` from current documented client entries.
- Do not put server SDKs or secrets in `"use client"` modules.
- Keep `AppIntegrations` exported so `createIntegrations<AppIntegrations>()` can infer types.
- For Supabase/custom route APIs, method calls may be nested, for example `.login.post(...)`, not `.login(...)`.
- Do not mix renderer component formats, top-level auth with `integrations.auth`, or mismatched Farm package versions.
- Do not import server query handlers into the browser without the server-function transform.
- Do not use compatibility `@farm.js/integrations/*` imports for new code when a dedicated adapter exists.
- Cron is not a durable workflow engine; protect production routes with `CRON_SECRET` and design handlers for repeated or overlapping delivery.
- In monorepos with pnpm and Prisma, generated clients can be stale or shared; run `prisma generate` immediately before builds.
- Run `pnpm format` before `pnpm lint` if `oxfmt --check` fails.
- Existing lint warnings may be present; treat nonzero exit codes as failures.
