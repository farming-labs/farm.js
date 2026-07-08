# Deployment Presets Example

This example shows how one `farm.config.ts` can build deployable output for Vercel, Cloudflare Pages, and Netlify. Those are Farm's first-class deploy shortcuts, and the same config can pass any Nitro preset through with `deploy.preset`.

## Build targets

```bash
pnpm build:vercel
pnpm build:cloudflare
pnpm build:netlify
NITRO_PRESET=aws-lambda pnpm build:nitro
```

## Deploy targets

```bash
pnpm deploy:vercel
pnpm deploy:cloudflare
pnpm deploy:netlify
```

For other Nitro-supported providers, build with `NITRO_PRESET` and then use that provider's own deploy command or CI workflow.

## Environment

| Variable | Used by |
| --- | --- |
| `FARM_DEPLOY_TARGET` | Selects `vercel`, `cloudflare`, or `netlify` before build. |
| `NITRO_PRESET` | Optional Nitro preset pass-through for non-first-class targets. |
| `CLOUDFLARE_PAGES_PROJECT` | Optional project name for `farm deploy --cloudflare`. |
| `NETLIFY_SITE_ID` | Optional site id for `farm deploy --netlify`. |
