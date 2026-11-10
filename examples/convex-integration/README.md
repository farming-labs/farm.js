# Convex integration example

A small Farm app on [Convex](https://convex.dev) that uses every part of `@farm.js/convex`:

- `convex()` wraps the app in a Convex provider and starts `convex dev` with `farm dev`.
- The home page preloads messages on the server with `preloadQuery`, then keeps them live.
- Better Auth runs inside Convex. `convex()` finds it in `convex/convex.config.ts` and forwards
  `/api/auth/*` to it, so sign-in is same-site and `/account` knows the user during server
  rendering.
- `/api/notes` stores values through `convexStorage()`, and `/api/*` is rate limited with
  `convexRateLimitStorage()`.

## Run it

```bash
pnpm install
pnpm dev
```

The first `farm dev` starts `convex dev`, which creates a deployment and writes it to
`.env.local`; restart `farm dev` when Farm says the deployment is ready. For a free local one with
no account, set `CONVEX_AGENT_MODE=anonymous` for that first run.

Then set the server secrets on the deployment:

```bash
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set FARM_CONVEX_SECRET "<same value as FARM_CONVEX_SECRET in .env.local>"
```
