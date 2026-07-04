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
