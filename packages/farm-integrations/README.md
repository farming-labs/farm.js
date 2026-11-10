# @farm.js/integrations

Compatibility re-exports for Farm.js applications that import integrations from
`@farm.js/integrations` or one of its subpaths. Each subpath forwards to a dedicated integration
package, so an existing import keeps resolving to the same factory, client, and types.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## New code should import the dedicated package

This package contains no integration code of its own. Every provider ships as a dedicated package,
such as `@farm.js/stripe` or `@farm.js/clerk`. Those are the packages `farm add integration`
installs, the generated starters import, and the documentation uses. Keep this package only while
an app still has the older imports, and move them over when convenient:

```ts
// Before
import { stripe } from "@farm.js/integrations/stripe";
import { stripeClient } from "@farm.js/integrations/stripe/client";

// After
import { stripe } from "@farm.js/stripe";
import { stripeClient } from "@farm.js/stripe/client";
```

The exports are the same objects, so the move is an import rename. Nothing else in
`farm.config.ts` or the application changes.

## Install

```bash
pnpm add @farm.js/integrations
```

Every dedicated package in the table below is a regular dependency and installs with it. Their
provider SDK peers do not. Install those the way each dedicated package asks, for example
`@clerk/react` for Clerk, `@sanity/client` for Sanity, and `@strapi/client` for Strapi.

## Usage

An existing configuration keeps working unchanged:

```ts
import { defineConfig } from "@farm.js/core";
import { stripe } from "@farm.js/integrations/stripe";

export default defineConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    }),
  },
});
```

## Subpath mapping

Each subpath re-exports everything from its target.

| Compatibility import                    | Import instead               |
| --------------------------------------- | ---------------------------- |
| `@farm.js/integrations/ai`              | `@farm.js/ai`                |
| `@farm.js/integrations/auth0`           | `@farm.js/auth0`             |
| `@farm.js/integrations/auth0/client`    | `@farm.js/auth0/client`      |
| `@farm.js/integrations/authjs`          | `@farm.js/authjs`            |
| `@farm.js/integrations/autumn`          | `@farm.js/autumn`            |
| `@farm.js/integrations/autumn/client`   | `@farm.js/autumn/client`     |
| `@farm.js/integrations/better-auth`     | `@farm.js/better-auth`       |
| `@farm.js/integrations/clerk`           | `@farm.js/clerk`             |
| `@farm.js/integrations/email`           | `@farm.js/email`             |
| `@farm.js/integrations/email/client`    | `@farm.js/email/client`      |
| `@farm.js/integrations/email/schedule`  | `@farm.js/email/schedule`    |
| `@farm.js/integrations/jobs`            | `@farm.js/jobs`              |
| `@farm.js/integrations/polar`           | `@farm.js/polar`             |
| `@farm.js/integrations/polar/client`    | `@farm.js/polar/client`      |
| `@farm.js/integrations/sanity`          | `@farm.js/sanity`            |
| `@farm.js/integrations/strapi`          | `@farm.js/strapi`            |
| `@farm.js/integrations/stripe`          | `@farm.js/stripe`            |
| `@farm.js/integrations/stripe/client`   | `@farm.js/stripe/client`     |
| `@farm.js/integrations/supabase`        | `@farm.js/supabase`          |
| `@farm.js/integrations/supabase/client` | `@farm.js/supabase/client`   |
| `@farm.js/integrations/unkey`           | `@farm.js/unkey`             |
| `@farm.js/integrations/utils`           | `@farm.js/integration-utils` |
| `@farm.js/integrations/workos`          | `@farm.js/workos`            |
| `@farm.js/integrations/workos/client`   | `@farm.js/workos/client`     |

`@farm.js/stripe/storage` and the `@farm.js/integration-utils` subpaths such as `/config`,
`/cookies`, and `/webhooks` have no compatibility path. Import them from the dedicated package.

## Package root

`@farm.js/integrations` itself re-exports a selected set of values, along with the main input,
instance, and client types of each package:

- `@farm.js/ai`: `aiChatRoute`, `createAIChatRoute`, `defineAIChatRoute`, `aiChatRequestBodySchema`
- `@farm.js/auth0`: `auth0`, and `auth0Client` from `/client`
- `@farm.js/authjs`: `authjs`
- `@farm.js/autumn`: `autumn`, and `autumnClient` from `/client`
- `@farm.js/better-auth`: `betterAuth`
- `@farm.js/clerk`: `clerk`
- `@farm.js/email`: `resend`, `emailSchedule` from `/schedule`, `resendClient` and `template` from
  `/client`
- `@farm.js/jobs`: `jobs`, `task`, `defineTasks`, `trigger`, `inngest`
- `@farm.js/polar`: `polar`, and `polarClient` from `/client`
- `@farm.js/stripe`: `stripe`, `stripeSchema`, `drizzleStorageAdapter`, `prismaStorageAdapter`,
  `sqliteStorageAdapter`, and `stripeClient` from `/client`
- `@farm.js/supabase`: `supabase`, and `supabaseClient`, `supabaseAuthFormFields` from `/client`
- `@farm.js/unkey`: `unkey`, `createUnkeyClient`, `UnkeyAPIError`
- `@farm.js/workos`: `workos`, and `workosClient` from `/client`

The `FarmWebhook*` types from `@farm.js/integration-utils/webhooks` are on the root too. Sanity and
Strapi are not; use their subpaths. The root combines server factories and browser clients in one
entry point, so browser code should import a client from its `/client` path instead.

## Documentation

- [Integrations](https://farmjs.dev/docs/integrations): registering adapters and the dedicated
  packages, with a page per provider.
- [Reference](https://farmjs.dev/docs/reference): the package and export index.

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
