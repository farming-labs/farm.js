# RSC Demo (Farm + React Server Components)

Demo app for Farm.js with RSC, deployed via Nitro to Vercel.

## RSC package compatibility

Farm pins React's framework-level RSC APIs to one tested combination:

```text
react                        19.2.8
react-dom                    19.2.8
react-server-dom-webpack     19.2.8
@vitejs/plugin-rsc           0.5.32
```

The RSC plugin stops startup with an actionable error when an application resolves a missing or
different version. This prevents React, its Flight renderer/decoder and the Vite integration from
silently drifting apart.

RSC rendering does not enable Server Actions by itself. This demo opts in because `/form` exercises
the action protocol:

```ts
experimental: {
  serverActions: true,
}
```

Keep Server Actions disabled when an RSC application does not need client-callable React actions.

## Experimental optimized boundary

The `/static-content` route renders ordinary JSX while Farm automatically selects safe host-only
subtrees for native rendering. Farm includes the
[Strata](https://github.com/farming-labs/strata) native runtime and handles its server packaging. The
experiment is explicitly enabled in `vite.config.ts`:

```ts
experimental: {
  optimizedBoundary: true,
}
```

Application components do not import an optimization component:

```tsx
export default function Article() {
  return (
    <article>
      <h1>Representation-aware content</h1>
      <p>Farm analyzes this existing server-rendered JSX automatically.</p>
    </article>
  );
}
```

No app-level Strata installation, boundary import, or manual renderer call is required. After the
flag is enabled, Farm handles conservative eligibility checks, dependency validation, server-only
enforcement, native externalization and production packaging. Unsupported or unsafe trees retain
normal React rendering. React owns each selected boundary and the surrounding application. It does
not reconcile nodes inside an optimized boundary, so Farm excludes Client Components, event
handlers, refs, effects and independently updating state. The current runtime uses a native Node
binding; edge and Cloudflare worker targets need a future Wasm or JavaScript fallback before enabling
this experiment.

## Develop

```bash
pnpm dev
```

If you run from the Farm.js monorepo and see errors resolving `@farm.js/core`, build the workspace first: from the repo root run `pnpm build --filter @farm.js/core` (then `cd examples/rsc-demo && pnpm dev`).

**Form / server actions:** If the form on `/form` shows “__viteRscCallServer is not a function”, do a hard refresh (e.g. Cmd+Shift+R / Ctrl+Shift+R) so the client entry loads the latest bundle. After changing `@farm.js/plugin` code, rebuild the plugin (`cd packages/farmjs-plugin && pnpm run build`) and restart `pnpm dev` in this example.

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
