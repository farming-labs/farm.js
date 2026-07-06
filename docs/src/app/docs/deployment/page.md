---
title: "Deployment"
description: "Build deployable output for Vercel, Cloudflare Pages, Netlify, or Node with Farm's deploy config and Nitro presets."
section: "Runtime"
---

# Deployment

Build deployable output for Vercel, Cloudflare Pages, Netlify, or Node with Farm's deploy config and Nitro presets.

## Target-based deploy config

**farm.config.ts**

```ts
export default defineFarmConfig({
  deploy: {
    target: "vercel",
    output: ".vercel/output",
  },
});
```

## Targets

| Target | Preset | Default output |
| --- | --- | --- |
| vercel | vercel | .vercel/output |
| cloudflare | cloudflare-pages | .output |
| netlify | netlify | .output |
| node | node-server | .output |

## Build

**Terminal**

```bash
pnpm build
farm build --target vercel
farm deploy --cloudflare
```

## Compact config

Farm reads deployment settings from `farm.config.ts`, so a minimal project does not need `vercel.json`, `wrangler.toml`, or Netlify config just to choose an output target.

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  deploy: {
    target: "vercel",
  },
});
```

When `target` is `vercel`, Farm uses the Vercel Nitro preset and writes Build Output API output to `.vercel/output`. Other targets default to `.farm/.output` unless you override `output` or `outputDir`.

## Override output

Use `output` for the compact form or `outputDir` when you want the explicit option name.

```ts
export default defineFarmConfig({
  deploy: {
    target: "netlify",
    output: ".output",
  },
});
```

## Platform deploys

| Command | What it expects |
| --- | --- |
| `farm build --target vercel` | Builds `.vercel/output` for Vercel prebuilt deploys. |
| `farm deploy --vercel` | Uses `vercel deploy --prebuilt`. |
| `farm deploy --cloudflare` | Deploys the Cloudflare Pages output with Wrangler. |
| `farm deploy --netlify` | Deploys the Netlify output with Netlify CLI. |

## Environment variables

Keep environment variables in the platform's environment manager or local `.env` files. Farm config can reference `process.env`, and integrations should validate required provider keys during setup.

```ts
export default defineFarmConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
    }),
  },
});
```

## Production checklist

- Run `farm build` before `farm deploy`.
- Confirm the selected target matches `deploy.target` or the CLI flag.
- Check generated output exists at the resolved output directory.
- Run provider-specific login commands such as `vercel login`, `wrangler login`, or `netlify login` before deploying.
- Keep provider secrets out of client bundles and UI registry components.
