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
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
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
});
```

## Important options

| Option | Use it for |
| --- | --- |
| srcDir | Changing the app source folder from the default src. |
| integrations | Registering built-in or custom integrations. |
| storage | Providing storage clients and mounts for framework and integration code. |
| docs | Serving the built-in docs runtime and docs API. |
| md | Exposing markdown mirrors like /pricing.md. |
| deploy | Selecting a target, preset, and output directory. |
| openapi | Publishing API reference docs. |

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
docs.config.ts
docs.json
src/app/api/**/route.ts
src/app/**/middleware.ts
src/lib/integrations.ts
```

## Integrations in config

```ts
import { defineFarmConfig } from "@farmjs/core";
import { stripe } from "@farmjs/integrations/stripe";
import { supabase } from "@farmjs/integrations/supabase";

export default defineFarmConfig({
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

## Deployment config

```ts
export default defineFarmConfig({
  deploy: {
    target: "vercel",
    outputDir: ".vercel/output",
  },
});
```

`deploy.target` selects the deployment provider. Farm resolves that to the matching Nitro preset and output shape unless you override it.

## Production notes

- Keep secrets in environment variables, not committed config.
- Use `storage.client` when integrations need schema-backed persistence.
- Use `docs.entry` when the docs runtime should be mounted automatically.
- Prefer route-level exports such as `dynamic`, `revalidate`, and `ppr` when behavior belongs to one page.
- Keep `farm.config.ts` as the single control plane instead of spreading framework behavior across many root files.
