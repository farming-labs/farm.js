# RSC Demo (Farm + React Server Components)

Demo app for Farm.js with RSC, deployed via Nitro to Vercel.

## Develop

```bash
pnpm dev
```

If you run from the Farm.js monorepo and see errors resolving `@farmjs/core`, build the workspace first: from the repo root run `pnpm build --filter @farmjs/core` (then `cd examples/rsc-demo && pnpm dev`).

**Form / server actions:** If the form on `/form` shows “__viteRscCallServer is not a function”, do a hard refresh (e.g. Cmd+Shift+R / Ctrl+Shift+R) so the client entry loads the latest bundle. After changing `@farmjs/plugin` code, rebuild the plugin (`cd packages/farmjs-plugin && pnpm run build`) and restart `pnpm dev` in this example.

## Build

```bash
pnpm build
```

This runs:

1. Vite build (client + RSC + SSR environments)
2. Nitro build (server entry for Vercel)
3. Build Output API script (`.vercel/output`)

## Deploy to Vercel

### Option A: Git push (recommended)

1. Push this app to a Git repo and connect it in the [Vercel dashboard](https://vercel.com).
2. Use **Build Command** `pnpm build`, **Install Command** `pnpm install`. Leave **Output Directory** empty (the build writes the [Build Output API v3](https://vercel.com/docs/build-output-api/v3) layout into `.vercel/output`).
3. Deploy. Vercel will run `pnpm build` and use the output from `.vercel/output`.

### Option B: CLI prebuilt

From this directory:

```bash
pnpm build
vercel deploy --prebuilt
```

For production:

```bash
pnpm run deploy:vercel:prod
```

## Preview locally

After `pnpm build`:

```bash
pnpm preview
```

Serves the Nitro server from `.output` (same as production handler).

## Deploy to Cloudflare (Pages)

1. **Build with Cloudflare preset**

   ```bash
   pnpm run build:cloudflare
   ```

   This runs `NITRO_PRESET=cloudflare_pages vite build` and produces `.output` (Nitro’s Cloudflare Pages layout).

2. **Preview locally**

   ```bash
   pnpm run preview:cloudflare
   ```

   Uses `wrangler pages dev` to run the app locally (requires `wrangler`).

3. **Deploy**

   ```bash
   pnpm run deploy:cloudflare
   ```

   Builds with the Cloudflare preset and runs `wrangler pages deploy .output/public`. Adjust `--project-name` in `package.json` to match your Cloudflare Pages project, or create the project in the [Cloudflare dashboard](https://dash.cloudflare.com/) first.

   Alternatively, connect your repo in Cloudflare Pages and set **Build command** to `pnpm run build:cloudflare` and **Build output directory** to `.output/public`.
