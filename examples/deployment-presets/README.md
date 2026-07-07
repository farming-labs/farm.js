# Deployment Presets Example

This example shows how one `farm.config.ts` can build deployable output for Vercel, Cloudflare Pages, and Netlify.

## Build targets

```bash
pnpm build:vercel
pnpm build:cloudflare
pnpm build:netlify
```

## Deploy targets

```bash
pnpm deploy:vercel
pnpm deploy:cloudflare
pnpm deploy:netlify
```

## Environment

| Variable | Used by |
| --- | --- |
| `FARM_DEPLOY_TARGET` | Selects `vercel`, `cloudflare`, or `netlify` before build. |
| `CLOUDFLARE_PAGES_PROJECT` | Optional project name for `farm deploy --cloudflare`. |
| `NETLIFY_SITE_ID` | Optional site id for `farm deploy --netlify`. |
