---
title: "Convex Integration"
description: "Use Convex for live data in a Farm app: a browser provider, server-rendered queries, the convex dev runner, Better Auth on Convex, and Convex-backed rate limits and KV storage."
section: "Integrations"
---

# Convex Integration

[Convex](https://convex.dev) is a backend where queries are live: when data changes, every open
page that reads it updates. `@farm.js/convex` connects a Farm app to a Convex deployment. It wraps
the app in a Convex provider, gives server-rendered pages a Convex client for the current visitor,
starts `convex dev` with `farm dev`, and plugs Convex into Farm's auth, rate-limit, and KV storage
slots.

> **Experimental**
>
> `@farm.js/convex` is new. Its API can change in a minor release while it settles.

## Install

**Terminal**

```bash
pnpm add @farm.js/convex convex
```

Register the integration (below) and run `farm dev`. On a new app with no deployment yet, Farm
starts `convex dev`, which creates one and writes `CONVEX_URL` to `.env.local`; Farm then asks you
to restart `farm dev` to connect. In a project that depends on Vite, Convex writes
`VITE_CONVEX_URL` instead; Farm reads either name. For a free local deployment with no Convex
account, set `CONVEX_AGENT_MODE=anonymous`.

## Register it

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { convex } from "@farm.js/convex";

export default defineConfig({
  integrations: {
    convex: convex(),
  },
});
```

`convex()` does five things:

- Checks `CONVEX_URL` and `CONVEX_SITE_URL` at startup. In `farm build` and production, a missing
  URL, or a `.convex.site` URL where the `.convex.cloud` one belongs, fails with an error that
  names the fix. When `CONVEX_SITE_URL` is not set, Farm works it out from `CONVEX_URL`.
- Wraps every route in a Convex provider, so `useQuery`, `useMutation`, and `useAction` from
  `convex/react` work in client components. Only the public deployment URL reaches the browser.
- Starts `convex dev` when `farm dev` starts, and stops it when Farm stops. It never runs during
  `farm build` or in production.
- Reads `convex/convex.config.ts` and turns on the helper for each component it knows, such as
  Better Auth or Stripe. See [Services that live in Convex](#services-that-live-in-convex).
- Checks that auth and billing are not set up twice, once in Convex and once in Farm. See
  [Choose where a service lives](#choose-where-a-service-lives).

## Load data on the server

Use `preloadQuery` in an async page and pass the result to a client component. The page renders
with the data in its HTML, and the client component keeps it live with `usePreloadedQuery`.

**src/app/page.tsx**

```tsx
import { preloadQuery } from "@farm.js/convex/server";
import { api } from "../../convex/_generated/api";
import { Messages } from "../components/Messages";

export default async function HomePage() {
  const messages = await preloadQuery(api.messages.list);
  return <Messages preloaded={messages} />;
}
```

**src/components/Messages.tsx**

```tsx
"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "../../convex/_generated/api";

export function Messages({ preloaded }: { preloaded: Preloaded<typeof api.messages.list> }) {
  const messages = usePreloadedQuery(preloaded);
  return (
    <ul>
      {messages.map((message) => (
        <li key={message.id}>{message.body}</li>
      ))}
    </ul>
  );
}
```

`fetchQuery`, `fetchMutation`, and `fetchAction` from `@farm.js/convex/server` run a function once
and return its result. Use them in pages, API routes, and server actions.

| Option    | What it does                                                                   |
| --------- | ------------------------------------------------------------------------------ |
| `request` | The request to read the visitor's token from. Defaults to the current request. |
| `token`   | A token to send as-is. Skips the `token` reader configured on `convex()`.      |

Each call makes its own client, so two visitors rendering at the same time never share a token.

### Caching

A page that calls `preloadQuery` reads the current request, so Farm treats its HTML as
per-visitor: it is sent with `Cache-Control: private, no-store` and is never written to the shared
page cache. This keeps live data from being served stale. Data that is the same for everyone and
can be stale for a while belongs in a [cached query](/docs/cache-ppr) instead.

## Choose client ownership

By default Farm creates one `ConvexReactClient` per deployment URL in the browser. To wrap the app
in your own provider, pass a component reference:

**farm.config.ts**

```ts
convex({
  provider: { module: "@/components/AppConvexProvider", export: "AppConvexProvider" },
});
```

The component receives the deployment URL as `url`. Use `readConvexReactClient(url)` from
`@farm.js/convex/client` to get the shared client instead of constructing a second one. A
`provider` you pass here wins over one that an [extension](#services-that-live-in-convex) supplies.

## Services that live in Convex

Convex apps often run auth, billing, and email inside Convex as components. `convex()` reads the
components installed in `convex/convex.config.ts` and wires the ones it knows, so nothing else is
registered in Farm. With `@convex-dev/better-auth` installed, this is the whole config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { convex } from "@farm.js/convex";

export default defineConfig({
  integrations: {
    convex: convex(),
  },
});
```

`@farm.js/convex` knows these components as data, with no code or dependencies from them:

| Convex component             | What Farm adds                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `@convex-dev/better-auth`    | `/api/auth/*` on your domain, the visitor's token on the server and in the browser |
| `@convex-dev/polar`          | Billing; webhooks on your domain with `webhooks: true` (to `/polar/events`)        |
| `@convex-dev/stripe`         | Billing; webhooks on your domain with `webhooks: true` (to `/stripe/webhook`)      |
| `@useautumn/convex`          | Billing                                                                            |
| `@convex-dev/resend`         | Webhooks on your domain with `webhooks: true` (to `/resend-webhook`)               |
| `@convex-dev/workos-authkit` | Webhooks on your domain with `webhooks: true` (to `/workos/webhook`)               |

To change what Farm does for a component, list it with `component()` in `use`. An entry replaces
the detected one for the same component, `detect: false` turns detection off, and a service whose
`home` is `"farm"` is never detected:

```ts
import { component, convex } from "@farm.js/convex";

convex({ use: [component("@convex-dev/polar", { webhooks: true })] }); // Better Auth is still detected
convex({ detect: false, use: [component("@convex-dev/better-auth")] }); // only what is listed
```

### Auth with Better Auth running in Convex

When `@convex-dev/better-auth` is in `convex.config.ts`, Farm forwards `/api/auth/*` to the
component on your Convex site URL. Sign-in happens on your own domain, so session cookies are
first-party and server-rendered pages know who is signed in. On the server, Farm exchanges the
visitor's session cookie for a Convex token, so `preloadQuery` and the other server helpers run as
the signed-in user; visitors without a session cookie cost no network call. In the browser, the
live Convex connection fetches the same token from `/api/auth/convex/token`.

Do not register `@farm.js/better-auth` or set `auth: true` as well: Convex owns auth here.

On the Convex side, set Better Auth's `baseURL` to your app's URL, not the Convex site URL:

**convex/auth.ts**

```ts
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (context: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(context),
    emailAndPassword: { enabled: true },
    plugins: [convex({ authConfig })],
  });
```

Register the component's routes in `convex/http.ts`:

**convex/http.ts**

```ts
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);
export default http;
```

In the browser, use Better Auth's own client. It calls your domain:

**src/lib/auth-client.ts**

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

The live Convex connection checks the visitor's token when the page loads and when the window
regains focus. After signing in or out without a page load, call `refreshConvexAuth()`:

```ts
import { refreshConvexAuth } from "@farm.js/convex/client";

await authClient.signIn.email({ email, password });
refreshConvexAuth();
```

Because sign-in goes through your domain, OAuth providers call back to
`https://<your-app>/api/auth/callback/<provider>`. Update the callback URL in each provider's
console when you move an app from the cross-domain setup to this one, and set `SITE_URL` on the
Convex deployment with `npx convex env set SITE_URL https://<your-app>`.

The forwarder passes the path, query, method, body, and every `Set-Cookie` header through, returns
redirects to the browser instead of following them, and replaces any `x-forwarded-host` the
browser sent with the host it actually used.

### Billing with Polar running in Convex

With `@convex-dev/polar`, checkout, the customer portal, and subscription data live in Convex. The
`Polar` instance needs explicit types, because `getUserInfo` reads a query from the same file:

**convex/billing.ts**

```ts
import { Polar } from "@convex-dev/polar";
import { api, components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";

type BillingUser = { userId: string; email: string } | null;

export const me = query({
  args: {},
  handler: async (ctx): Promise<BillingUser> => {
    const identity = await ctx.auth.getUserIdentity();
    return identity ? { userId: identity.subject, email: identity.email ?? "" } : null;
  },
});

export const polar: Polar<DataModel, { pro: string }> = new Polar(components.polar, {
  products: { pro: "prod_123" },
  getUserInfo: async (ctx): Promise<{ userId: string; email: string }> => {
    const user: BillingUser = await ctx.runQuery(api.billing.me);
    if (!user) throw new Error("Sign in first");
    return user;
  },
});

export const { generateCheckoutLink, generateCustomerPortalUrl } = polar.api();
```

Add `polar.registerRoutes(http)` to `convex/http.ts`. To give Polar a webhook URL on your own
domain, turn on webhooks for the component:

```ts
convex({ use: [component("@convex-dev/polar", { webhooks: true })] });
```

Then use `https://<your-app>/api/webhooks/polar` in Polar. The body and signature headers reach
Convex unchanged, so the component verifies them as usual. If you registered the routes on a
custom path, pass it as `convexPath`. Without `webhooks`, point Polar at
`https://<deployment>.convex.site/polar/events` directly.

### Add any other Convex component

Install and use any component in `convex/` as its docs describe; Farm needs nothing for most of
them. List a component with `component()` only when Farm should do something for it, usually to
receive its webhooks on your domain:

```ts
import { component, convex } from "@farm.js/convex";

convex({
  use: [
    component("@acme/convex-sms", { routes: { "/api/webhooks/sms": "/sms/inbound" } }),
    component("@convex-dev/rate-limiter"), // warns if it is missing from convex.config.ts
  ],
});
```

| Option       | Use                                                                                    |
| ------------ | -------------------------------------------------------------------------------------- |
| `routes`     | `{ "/path/on/your/domain": "/path/on/convex" }`, or full route objects with `methods`. |
| `webhooks`   | `true` for a known component's default paths, or a path on your domain.                |
| `convexPath` | The webhook path on Convex, for a custom or unknown component.                         |
| `name`       | Shown in errors and warnings. Defaults to the package name.                            |
| `token`      | Reads the visitor's Convex token on the server. The component then counts as auth.     |
| `tokenPath`  | Same-origin path the browser fetches the visitor's Convex token from.                  |
| `provider`   | A browser provider used instead of the default one.                                    |

A `token`, `tokenPath`, or `provider` passed to `convex()` directly wins over a component's.

## Auth that lives in Farm

Auth can stay in Farm while Convex holds app data. Convex then trusts tokens signed by your app.
With Better Auth in Farm, add its JWT plugin:

**src/lib/auth.ts**

```ts
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";

export const auth = betterAuth({
  // database, secret, baseURL, providers ...
  plugins: [jwt({ jwks: { keyPairConfig: { alg: "RS256" } } })],
});
```

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { betterAuth } from "@farm.js/better-auth";
import { convex } from "@farm.js/convex";
import { auth } from "./src/lib/auth";

export default defineConfig({
  integrations: {
    auth: betterAuth({ instance: auth }),
    convex: convex({
      token: async (request) => {
        try {
          return (await auth.api.getToken({ headers: request.headers })).token;
        } catch {
          return undefined;
        }
      },
      tokenPath: "/api/auth/token",
    }),
  },
});
```

**convex/auth.config.ts**

```ts
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      type: "customJwt",
      issuer: process.env.SITE_URL,
      applicationID: process.env.SITE_URL,
      jwks: `${process.env.SITE_URL}/api/auth/jwks`,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
```

Set `SITE_URL` on the Convex deployment to your app's URL. Convex fetches the keys from your app,
so a cloud deployment cannot reach an app on `localhost`; develop against a local deployment
(`CONVEX_AGENT_MODE=anonymous`) or a tunnel. Convex functions read the user with
`ctx.auth.getUserIdentity()`, and the token's `subject` is the Better Auth user ID.

## Auth with a hosted provider

For Clerk, WorkOS, Auth0, or another provider that issues its own JWTs, configure the provider in
Convex's `auth.config.ts` as Convex's docs describe, then give `convex()` a `token` reader that
returns the visitor's token for a request. In the browser, pass the provider your auth SDK
documents for Convex, such as `ConvexProviderWithClerk`, as `convex({ provider })`:

**farm.config.ts**

```ts
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@farm.js/clerk";
import { convex } from "@farm.js/convex";

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default defineConfig({
  integrations: {
    auth: clerk(),
    convex: convex({
      token: async (request) => {
        const state = await clerkClient.authenticateRequest(request);
        return state.isAuthenticated ? state.toAuth().getToken({ template: "convex" }) : undefined;
      },
    }),
  },
});
```

## Choose where a service lives

Running a service both in Convex and in Farm gives you two sources of truth. Besides the extensions
in `use`, Farm reads the component imports in `convex/convex.config.ts` and compares them with your
Farm integrations at startup. When a service is set up on both sides, `farm dev` and `farm build`
stop with an error that names the `home` option.

| In Convex                                                      | In Farm                                     | Result   |
| -------------------------------------------------------------- | ------------------------------------------- | -------- |
| `@convex-dev/workos-authkit`                                   | `workos()`                                  | Together |
| `@convex-dev/better-auth`                                      | Any auth integration, or `auth: true`       | Conflict |
| `@convex-dev/workos-authkit`                                   | Any other auth integration, or `auth: true` | Conflict |
| `@convex-dev/polar`, `@convex-dev/stripe`, `@useautumn/convex` | `polar()`, `stripe()`, or `autumn()`        | Conflict |

WorkOS is designed to run on both sides: it signs users in through Farm while the AuthKit
component keeps them in sync in Convex. A service that lives on one side only, such as Polar as a
Convex component with no Farm Polar integration, needs nothing.

To keep both on purpose, for example while migrating, say which side owns the service:

```ts
convex({ home: { billing: "convex" } });
```

If your functions live somewhere other than `convex/`, pass `functionsDirectory`.

## Turn off the dev runner

`farm dev` starts `convex dev` for you and marks each line it prints with `convex │`. Until a
deployment is chosen in `.env.local`, Convex keeps the terminal unlabelled so it can ask its setup
questions.

```ts
convex({ dev: false });
```

Pass `dev: { args: ["--tail-logs", "disable"] }` to add arguments to `convex dev`. Turn the runner
off when you already run `npx convex dev` in another terminal.

## Rate limits and KV storage in Convex

`convexRateLimitStorage()` plugs Convex into Farm's [rate limiter](/docs/storage#atomic-rate-limit-storage),
and `convexStorage()` into [KV storage mounts](/docs/storage). Both are backed by a small Convex
component that ships in the package. Convex mutations are atomic, which is what the rate limiter's
`increment` contract needs.

Install the component and expose its functions to Farm:

**convex/convex.config.ts**

```ts
import { defineApp } from "convex/server";
import farm from "@farm.js/convex/convex.config";

const app = defineApp();
app.use(farm);

export default app;
```

**convex/farm.ts**

```ts
import { defineFarmFunctions } from "@farm.js/convex/functions";
import { components } from "./_generated/api";

export const {
  incrementRateLimit,
  readRateLimit,
  getStorageItem,
  listStorageKeys,
  setStorageItem,
  removeStorageItem,
  clearStorageItems,
} = defineFarmFunctions(components.farm);
```

These functions refuse calls that do not carry `FARM_CONVEX_SECRET`. Set the same value in your
Farm server environment and on the deployment:

```bash
npx convex env set FARM_CONVEX_SECRET "$(openssl rand -hex 32)"
```

Then use the adapters:

**src/app/api/middleware.ts**

```ts
import { convexRateLimitStorage } from "@farm.js/convex";
import { middleware } from "@farm.js/core/middleware";

export default middleware().rateLimit({
  requests: 30,
  window: "1m",
  storage: convexRateLimitStorage(),
});
```

**farm.config.ts**

```ts
import { convex, convexStorage } from "@farm.js/convex";

export default defineConfig({
  integrations: { convex: convex() },
  storage: {
    mounts: {
      notes: convexStorage({ namespace: "notes" }),
    },
  },
});
```

| Adapter option | What it does                                                                       |
| -------------- | ---------------------------------------------------------------------------------- |
| `secret`       | The shared secret. Defaults to `FARM_CONVEX_SECRET`.                               |
| `module`       | The Convex file that exports the functions. Defaults to `farm` (`convex/farm.ts`). |
| `url`          | The deployment URL. Defaults to the one `convex()` resolved.                       |
| `namespace`    | `convexStorage()` only. Keeps two mounts from sharing keys.                        |

## Environment variables

| Variable             | Where                        | Purpose                                                                              |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `CONVEX_URL`         | Farm (written by Convex CLI) | Deployment URL, ending in `.convex.cloud`. `VITE_CONVEX_URL` also works.             |
| `CONVEX_SITE_URL`    | Farm, optional               | HTTP actions URL, ending in `.convex.site`. Worked out from `CONVEX_URL` when unset. |
| `SITE_URL`           | Convex                       | Your app's URL, for Better Auth's `baseURL`.                                         |
| `FARM_CONVEX_SECRET` | Farm and Convex              | Shared secret for the rate-limit and KV functions.                                   |

## Deploy

`farm build` only builds the app. It never pushes Convex functions, so a local or CI build can't
change your production backend. Use `convex deploy` as the build command instead:

```bash
npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name CONVEX_URL
```

It pushes your functions, then builds the app against the same deployment, so the site never ships
pointing at an older backend. It needs `CONVEX_DEPLOY_KEY` in the build environment. On Vercel, set
this as the project's build command.

`convex deploy` sets `CONVEX_URL` only while the build runs. The Farm server reads it again when it
starts, so also set `CONVEX_URL` in your host's runtime environment.

## Limits

- Farm features that need a SQL database do not work in an app whose only database is Convex. That
  includes plugin [schema tables](/docs/plugins/schema-tables), the [Sync plugin](/docs/plugins/sync),
  and Farm's built-in `auth: true`.
- Server-rendered pages cannot read a [Convex Auth](https://labs.convex.dev/auth) session yet.
  Convex Auth still works in client components.
- A Convex-backed cache adapter (`cache.adapter`) is not part of this package. Farm's page and data
  cache are a better fit for Redis or your platform's cache.
