---
name: farmjs
description: Use when building, debugging, documenting, or integrating Farm.js apps and packages. Covers Farm.js routing, config, internationalization, typed API clients, framework Cron, integrations such as Stripe/auth/email/jobs, storage, deployment, plugins, examples, and verification commands.
metadata:
  short-description: Build and debug Farm.js apps and integrations
---

# Farm.js

Farm.js is a React meta-framework in active development. Prefer local repository sources over memory:

- Docs: `README.md`, `docs/src/app/docs/**`
- Core package: `packages/farm/src/**`
- Integration package: `packages/farm-integrations/src/**`
- Examples: `examples/**`

Use `rg` first when locating files. Read the closest example before adding new code.

## Default Workflow

1. Identify the app/package:
   - App config: `farm.config.ts`
   - Pages/layouts: `src/app/**`
   - Integration setup: `src/lib/integrations.ts`
   - Typed client export: `src/lib/api.ts`
   - Generated project types: `src/farm.d.ts`
2. Match existing patterns in the nearest example.
3. For provider integrations, verify both static types and production build.
4. If touching Stripe/Prisma examples, ensure `prisma generate` runs immediately before `tsc` or `farm build`.
5. Run focused checks first, then broad checks.

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
import { Link, integrationClients } from "@farm.js/core/client";
```

Use `"use client"` when a component uses React hooks, browser APIs, or client-only integration calls.

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

- `srcDir`: app source directory; omit it to use the default `src`
- `experimental.serverComponents`: enables server component behavior
- `integrations`: provider integrations object
- `storage.mounts`: named storage instances
- `i18n`: locale routes, detection signals, typed ICU catalogs, formatting, and RTL
- `cron`: named portable UTC schedules mapped to GET API routes
- `plugins`: Farm plugins
- `redirects()`, `headers()`, `rewrites()`: route behavior
- `vite`: underlying Vite config
- `suppressLintOnLink`: relax generated route typing for `Link href`

## Routing Spec

- `src/app/page.tsx` maps to `/`
- `src/app/about/page.tsx` maps to `/about`
- `src/app/users/[id]/page.tsx` maps to `/users/:id`
- `src/app/docs/[...slug]/page.tsx` maps to catch-all docs paths
- Farm writes typed `Link href` declarations into `src/farm.d.ts`
- Typed `href` supports query strings and hashes, for example `/users/123?tab=profile`

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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

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

## Typed API Client Spec

For app API routes, use `createAPIClient` from `@farm.js/core/client`.

For integration APIs, prefer `integrationClients<AppIntegrations>()`:

```ts
import { integrationClients } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = integrationClients<AppIntegrations>();
```

Client calls resolve to result objects instead of throwing for HTTP errors:

```ts
const result = await apiClient.billing.products();

if (result.error) {
  console.error(result.error.message);
} else {
  console.log(result.data);
}
```

Provider helpers may expose friendly methods like `apiClient.billing.products()`. Generic integration route APIs may be method-nested, such as `apiClient.auth.login.post({ body })`. Check the generated usage in the closest example.

## Integration Spec

Define app integrations in `src/lib/integrations.ts`, then attach them in `farm.config.ts`.

```ts
export const appIntegrations = {
  billing: stripe(...),
  auth: farmBetterAuth(...),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

Available integration families in this repo include:

- Auth: Auth0, AuthJS, Better Auth, Clerk, Supabase, WorkOS
- Billing/payments: Stripe, Polar, Autumn
- Email: Resend
- Jobs: local jobs, trigger, Inngest

When building a new integration, use core primitives from `@farm.js/core`:

- `defineIntegration`
- `integrationRoute`
- `FarmIntegrationAPI`
- `FarmIntegrationHandlerContext`
- `FarmIntegrationLogEvent`

Follow existing provider code in `packages/farm-integrations/src/<provider>`.

Integration routes can validate body and query input with Zod-compatible schemas:

```ts
import { z } from "zod";
import { defineIntegration, integrationRoute } from "@farm.js/core";

export const localDemo = defineIntegration({
  category: "custom",
  type: "local-demo",
  instance: {},
  routes: [
    integrationRoute.post("/api/local-demo/message", {
      input: {
        body: z.object({
          message: z.string().min(1),
        }),
        query: z.object({
          count: z.coerce.number().int().positive().optional(),
        }),
      },
      handler(_request, context) {
        return Response.json({
          message: context.input.body?.message,
          count: context.input.query?.count,
        });
      },
    }),
  ],
});
```

Use the CLI to scaffold an app integration registry and provider component:

```bash
farm add integration --list
farm add integration stripe
farm add integration supabase --key auth
farm add integration resend --file src/lib/integrations.ts
```

The command creates or updates `src/lib/integrations.ts`, adds a provider component under
`src/lib/integrations/`, wires `farm.config.ts` when it can do so safely, and adds
`@farm.js/integrations` to `package.json`.

## Stripe Integration Spec

Simple checkout example: `examples/stripe-integration`.

Server setup:

```ts
import Stripe from "stripe";
import type { FarmIntegrationLogEvent } from "@farm.js/core";
import { stripe, type StripeWebhookEvent } from "@farm.js/integrations/stripe";
import { stripeCatalog } from "./stripe-catalog.ts";

const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const appIntegrations = {
  billing: stripe({
    products: stripeCatalog,
    instance: stripeInstance,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    log(event: FarmIntegrationLogEvent) {
      console.log("[stripe-example]", event.phase, event.route?.path || "none");
    },
    async onWebhook(event: StripeWebhookEvent) {
      console.log("[stripe-example:webhook]", event.type, event.id);
    },
  }),
} as const;
```

Catalog shape:

```ts
import type { StripeIntegrationProduct } from "@farm.js/integrations/stripe/client";

export const stripeCatalog: StripeIntegrationProduct[] = [
  {
    id: "pro-yearly",
    mode: "subscription",
    interval: "year",
    quantity: 1,
    priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  },
  {
    id: "supporter-pack",
    mode: "payment",
    quantity: 1,
    priceId: process.env.STRIPE_SUPPORTER_PACK_PRICE_ID,
  },
];
```

Client checkout:

```ts
const products = await apiClient.billing.products();

const checkout = await apiClient.billing.checkout({
  body: {
    productId: "pro-yearly",
    customerEmail: "demo@farmjs.dev",
    successPath: "/success",
    cancelPath: "/cancel",
  },
});

if (checkout.data?.redirectTo) {
  window.location.assign(checkout.data.redirectTo);
}
```

Routes registered by the Stripe integration:

```text
/billing/products
/billing/checkout
/billing/session
/billing/portal
/billing/webhook
```

Full billing examples add status, features, limits, usage, current charges, invoices, trials, seats, and storage:

```text
examples/stripe-integrations/sqlite
examples/stripe-integrations/prisma
examples/stripe-integrations/prisma-org
examples/stripe-integrations/drizzle
```

Full billing setup uses:

```ts
billing: {
  resolveOwner,
  plans,
  products,
  storage, // or hooks
  hooks,
}
```

Storage adapters:

```ts
import {
  sqliteStorageAdapter,
  prismaStorageAdapter,
  drizzleStorageAdapter,
} from "@farm.js/integrations/stripe";
```

Stripe environment:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL` or provider-specific base URL
- Product price ids such as `STRIPE_PRO_YEARLY_PRICE_ID`

With dummy Stripe keys, route registration and local error handling can be tested, but hosted Checkout/webhooks require real Stripe test credentials.

## Auth Integration Notes

Read the matching example before editing:

- `examples/auth0-integration`
- `examples/authjs-integration`
- `examples/farm-auth`
- `examples/clerk-integration`
- `examples/supabase-integration`
- `examples/workos-integration`

Auth integrations usually provide both server route registration and client API helpers. Keep env validation in server-only setup files. Avoid importing server SDKs into `"use client"` files.

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

## Verification Commands

Focused package checks:

```bash
pnpm --filter @farm.js/core test
pnpm --filter @farm.js/integrations type-check
pnpm --filter @farm.js/integrations build
pnpm build
pnpm lint
```

Example checks:

```bash
pnpm --dir examples/stripe-integration type-check
pnpm --dir examples/stripe-integration build
pnpm --dir examples/stripe-integrations/sqlite type-check
pnpm --dir examples/stripe-integrations/sqlite build
```

Prisma examples should generate Prisma client before typecheck/build:

```bash
pnpm --dir examples/stripe-integrations/prisma exec prisma generate
pnpm --dir examples/stripe-integrations/prisma build

pnpm --dir examples/stripe-integrations/prisma-org exec prisma generate
pnpm --dir examples/stripe-integrations/prisma-org build
```

Smoke a Stripe example locally:

```bash
APP_BASE_URL=http://localhost:3010 \
STRIPE_SECRET_KEY=sk_test_dummy \
STRIPE_WEBHOOK_SECRET=whsec_dummy \
pnpm --dir examples/stripe-integration exec farm dev --port 3010

curl -i http://localhost:3010/
curl -i http://localhost:3010/billing/products
```

Expected with dummy keys: homepage returns `200`; `/billing/products` reaches Stripe and returns an invalid-key error.

## Common Pitfalls

- Import `Link` and integration clients from `@farm.js/core/client` unless the local example uses the root export.
- Do not put server SDKs or secrets in `"use client"` modules.
- Keep `AppIntegrations` exported from integration setup so `integrationClients<AppIntegrations>()` can infer types.
- For Supabase/custom route APIs, method calls may be nested, for example `.login.post(...)`, not `.login(...)`.
- Cron is not a durable workflow engine; protect production routes with `CRON_SECRET` and design handlers for repeated or overlapping delivery.
- In monorepos with pnpm and Prisma, generated clients can be stale or shared; run `prisma generate` immediately before builds.
- Run `pnpm format` before `pnpm lint` if `oxfmt --check` fails.
- Existing lint warnings may be present; treat nonzero exit codes as failures.
