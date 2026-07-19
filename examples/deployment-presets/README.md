# Deployment Presets Example

This example shows how one `farm.config.ts` can build deployable output for Vercel, Cloudflare Pages, and Netlify. Those are Farm's first-class deploy shortcuts, and the same config can pass any Nitro preset through with `deploy.preset`.

The `/reports` page and `/api/reports` handler also demonstrate file-based `runtime`, `regions`, and `maxDuration` exports. A Vercel build emits separately configured Node functions for their two policies and records every resolved route in `.farm/route-runtime-manifest.json`.

## Build targets

```bash
pnpm build:vercel
pnpm build:cloudflare
pnpm build:netlify
pnpm build:self-host
NITRO_PRESET=aws-lambda pnpm build:nitro
```

## Deploy targets

```bash
pnpm deploy:vercel
pnpm deploy:cloudflare
pnpm deploy:netlify
```

For other Nitro-supported providers, build with `NITRO_PRESET` and then use that provider's own deploy command or CI workflow.

## Self-host locally

```bash
pnpm build:self-host
HOST=0.0.0.0 PORT=3000 pnpm start:self-host
```

This runs the Nitro Node server at `.output/server/index.mjs`, which is the same entrypoint you can put behind Docker, systemd, nginx, Caddy, or a process manager.

## Environment

| Variable | Used by |
| --- | --- |
| `FARM_DEPLOY_TARGET` | Selects `vercel`, `cloudflare`, or `netlify` before build. |
| `NITRO_PRESET` | Optional Nitro preset pass-through for non-first-class targets. |
| `CLOUDFLARE_PAGES_PROJECT` | Optional project name for `farm deploy --cloudflare`. |
| `NETLIFY_SITE_ID` | Optional site id for `farm deploy --netlify`. |
