---
title: "Deployment"
description: "Build deployable output with Farm's deploy config and Nitro presets, from first-class targets to custom Nitro output."
section: "Runtime"
---

# Deployment

Build deployable output with Farm's deploy config and Nitro presets. Farm owns route discovery, framework conventions, and app bundling; Nitro owns the final server output shape.

Scheduled routes are configured through framework [Cron](/docs/cron). Vercel builds receive native Build Output API cron entries, Cloudflare Worker builds receive Wrangler triggers, and other adapters can consume `.farm/cron-manifest.json`.

Dynamic pages and APIs can select their execution runtime, regions, and duration with file exports, layout defaults, programmatic routes, or route rules. See [Route Runtime](/docs/route-runtime) for precedence, provider support, and generated deployment output.

## Target-based deploy config

**farm.config.ts**

```ts
export default defineConfig({
  deploy: {
    target: "vercel",
    output: ".vercel/output",
  },
});
```

## First-class targets

| Target     | Preset           | Default output |
| ---------- | ---------------- | -------------- |
| vercel     | vercel           | .vercel/output |
| cloudflare | cloudflare-pages | .output        |
| netlify    | netlify          | .output        |
| node       | node-server      | .output        |

These targets get the most polished Farm defaults. They map `deploy.target` to a Nitro preset, output directory, and the matching `farm deploy` command when Farm has a deploy wrapper for that platform.

### Immutable fingerprinted assets on Vercel

Farm's Vercel Build Output automatically serves content-hashed files under `assets/` and `chunks/`
with `Cache-Control: public, max-age=31536000, immutable`. This covers fingerprinted JavaScript, CSS,
fonts, and images, including nested asset directories and applications with a `basePath`.

The rule intentionally excludes HTML, unhashed public files, and stable entry URLs such as
`/farm-client.js` and `/farm-client.css`. Those URLs can change between deployments and must remain
revalidatable. The immutable header route runs before Vercel's filesystem handler, so matching files
are still served directly from the CDN and never enter the Farm server function.

## Preset showcase

Use `deploy.target` when you want one config file to control the platform output. Farm maps that target to the Nitro preset, default output directory, and deploy command shape.

| Platform         | Config                 | Build command                              | Deploy command                  | Output to inspect |
| ---------------- | ---------------------- | ------------------------------------------ | ------------------------------- | ----------------- |
| Vercel           | `target: "vercel"`     | `FARM_DEPLOY_TARGET=vercel farm build`     | `farm deploy --vercel --prod`   | `.vercel/output`  |
| Cloudflare Pages | `target: "cloudflare"` | `FARM_DEPLOY_TARGET=cloudflare farm build` | `farm deploy --cloudflare`      | `.output/public`  |
| Netlify          | `target: "netlify"`    | `FARM_DEPLOY_TARGET=netlify farm build`    | `farm deploy --netlify`         | `.output`         |
| Self-hosted Node | `target: "node"`       | `FARM_DEPLOY_TARGET=node farm build`       | `node .output/server/index.mjs` | `.output`         |

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

const target = process.env.FARM_DEPLOY_TARGET ?? "vercel";

export default defineConfig({
  deploy: {
    target,
    cloudflare: {
      projectName: process.env.CLOUDFLARE_PAGES_PROJECT,
    },
    netlify: {
      site: process.env.NETLIFY_SITE_ID,
    },
  },
});
```

**package.json**

```json
{
  "scripts": {
    "build": "farm build",
    "build:vercel": "FARM_DEPLOY_TARGET=vercel farm build",
    "build:cloudflare": "FARM_DEPLOY_TARGET=cloudflare farm build",
    "build:netlify": "FARM_DEPLOY_TARGET=netlify farm build",
    "build:self-host": "FARM_DEPLOY_TARGET=node farm build",
    "start:self-host": "node .output/server/index.mjs",
    "deploy:vercel": "farm deploy --vercel --prod",
    "deploy:cloudflare": "farm deploy --cloudflare",
    "deploy:netlify": "farm deploy --netlify"
  }
}
```

The same shape lives in `examples/deployment-presets` so the preset behavior can be tested from a real app.

## Chunk error recovery

Farm installs client-side chunk recovery automatically in the generated browser runtime. When the browser fails to load a JavaScript or CSS chunk after a deployment, Farm reloads the current page once so the app can pick up the newest asset manifest.

This is meant for stale deploy assets, where a user has an older HTML page open while the server now points at newer chunks. Farm stores a short session guard per page before reloading, so repeated chunk failures do not trap the user in a reload loop. Ordinary runtime errors are left alone and should still be handled with route `error.tsx`, programmatic `error` components, monitoring, and tests.

## Rolling deployment safety

Farm embeds a deployment ID in each HTML document and sends it with SPA data, RSC navigation, and server action requests. The server also stores the ID in an HttpOnly, `SameSite=Lax` cookie so a progressively enhanced form action carries the same protection before JavaScript loads.

During a rolling deployment, an open page can belong to release A while its next request reaches release B. Farm handles that mismatch according to whether replay is safe:

| Request                                      | Mismatch behavior                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| SPA page data, RSC navigation, or HTML fetch | Emit `farm:deployment-mismatch` and perform a full document navigation.        |
| JavaScript server action                     | Return `409 FARM_DEPLOYMENT_MISMATCH`; never retry the mutation automatically. |
| Form server action without JavaScript        | Return the same non-cacheable `409` response using the deployment cookie.      |

Mutation requests are rejected before their action body is decoded or the handler runs. This prevents a stale action from being replayed against a new release and accidentally creating duplicate writes. The user can refresh and deliberately submit again.

Farm resolves the ID from explicit config, `FARM_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_SHA`, or `CF_PAGES_COMMIT_SHA`. Otherwise, production uses `generateBuildId` and development uses `"development"`.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploymentId: process.env.RELEASE_ID,
});
```

Use a commit SHA or CI release ID shared by every server instance in one deployment. A random value created independently when each process starts will make healthy instances reject one another's requests.

Applications can observe recovery and report it without replacing Farm's default behavior:

```ts
window.addEventListener("farm:deployment-mismatch", (event) => {
  const error = (event as CustomEvent).detail;
  reportError(error.code, {
    clientDeploymentId: error.clientDeploymentId,
    serverDeploymentId: error.serverDeploymentId,
  });
});
```

The deployment ID is a consistency marker, not a secret or an authorization boundary. Continue to authenticate and authorize every server action.

## Self-host a Farm app

Use `target: "node"` when you want to run the app on your own server, VPS, container, or platform that expects a long-running Node process. Farm builds the app with Nitro's Node server preset.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: {
    target: "node",
    output: ".output",
  },
});
```

**package.json**

```json
{
  "scripts": {
    "build": "farm build",
    "start": "node .output/server/index.mjs"
  }
}
```

Build once, then run the generated server:

```bash
pnpm build
HOST=0.0.0.0 PORT=3000 pnpm start
```

`farm start` is equivalent for the `node` target and adds `--port`/`--host` flags plus clear errors when the configured target has no local server.

For Docker, copy the app, install production dependencies, run `farm build`, expose the selected port, and start `node .output/server/index.mjs`. For a VPS, run the same start command behind nginx, Caddy, systemd, or a process manager such as PM2. Environment variables should be provided by the host at runtime, not committed into the bundle.

## Nitro preset pass-through

Farm can also build for any Nitro preset that Nitro can resolve. Use `deploy.preset` when the target is not one of Farm's first-class shortcuts, or pass `--preset` from the CLI for a one-off build.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: {
    preset: process.env.NITRO_PRESET || "node-server",
    output: ".output",
  },
});
```

**Terminal**

```bash
NITRO_PRESET=aws-lambda farm build
# Or, in an app that does not also set deploy.target:
farm build --preset deno-deploy
farm build --preset my-company-preset
```

For built-in Nitro presets, the generated output follows Nitro's provider shape. For custom presets, Farm passes the preset name through to Nitro, so the preset must be installed or otherwise resolvable by Nitro in the project.

## Nitro coverage

Nitro's official deploy docs list these runtime and provider families. Farm's first-class deploy commands cover the common Vercel, Cloudflare Pages, and Netlify path, while `deploy.preset` / `farm build --preset` lets advanced apps target the rest.

| Family                               | Nitro supports                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtimes                             | Node.js, Bun, Deno                                                                                                                                                                                        |
| Zero-config providers in Nitro CI/CD | AWS Amplify, Azure, Cloudflare, Firebase App Hosting, Netlify, StormKit, Vercel, Zeabur                                                                                                                   |
| Other Nitro provider docs            | Alwaysdata, AWS Lambda, Cleavr, Deno Deploy, DigitalOcean, EdgeOne Pages, Firebase, Flightcontrol, Genezio, GitHub Pages, GitLab Pages, Heroku, IIS, Koyeb, Platform.sh, Render.com, Zephyr Cloud, Zerops |

Common preset names include `node-server`, `bun`, `deno-server`, `deno-deploy`, `aws-lambda`, `aws-amplify`, `azure-swa`, `cloudflare-pages`, `cloudflare-module`, `firebase-app-hosting`, `github-pages`, `gitlab-pages`, `netlify`, `netlify-edge`, `vercel`, `zeabur`, and `zerops`. Nitro can add or rename presets over time, so check Nitro's deploy docs when targeting a provider directly.

## Build

**Terminal**

```bash
pnpm build
FARM_DEPLOY_TARGET=vercel farm build
farm build --preset aws-lambda
farm deploy --cloudflare
```

## Compact config

Farm reads deployment settings from `farm.config.ts`, so a minimal project does not need `vercel.json`, `wrangler.toml`, or Netlify config just to choose an output target.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: {
    target: "vercel",
  },
});
```

When `target` is `vercel`, Farm uses the Vercel Nitro preset and writes Build Output API output to `.vercel/output`. Other targets default to `.farm/.output` unless you override `output` or `outputDir`. When `preset` is set directly, Farm passes that value through to Nitro.

## Override output

Use `output` for the compact form or `outputDir` when you want the explicit option name.

```ts
export default defineConfig({
  deploy: {
    target: "netlify",
    output: ".output",
  },
});
```

Both options belong inside `deploy`. A top-level `output: "standalone"`, `"static"`, or `"export"`
does not select Farm rendering behavior. Choose a deployment target here, then configure static
pages with `dynamic = "force-static"` or `routeRules` as described in
[Server Rendering](/docs/server-rendering).

## Platform deploys

| Command                                | What it expects                                         |
| -------------------------------------- | ------------------------------------------------------- |
| `FARM_DEPLOY_TARGET=vercel farm build` | Builds `.vercel/output` for Vercel prebuilt deploys.    |
| `FARM_DEPLOY_TARGET=node farm build`   | Builds `.output/server/index.mjs` for self-hosted Node. |
| `farm build --preset <nitro-preset>`   | Builds with any Nitro preset that Nitro can resolve.    |
| `farm deploy --vercel`                 | Uses `vercel deploy --prebuilt`.                        |
| `farm deploy --cloudflare`             | Deploys the Cloudflare Pages output with Wrangler.      |
| `farm deploy --netlify`                | Deploys the Netlify output with Netlify CLI.            |
| `farm deploy --plan`                   | Prints the resolved build and deploy operations only.   |

For other Nitro presets, use the host's documented deploy command or CI workflow after `farm build` writes the Nitro output.

Use `farm deploy --plan` before a release when you want to verify the selected target, preset, runtime, output directory, and exact build and provider commands. Planning is read-only: it does not run the build, require a provider login, inspect existing output, or deploy anything.

## Environment variables

Keep environment variables in the platform's environment manager or local `.env` files. Farm config can reference `process.env`, and integrations should validate required provider keys during setup.

```ts
export default defineConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
    }),
  },
});
```

## Production checklist

- Run `farm build` before `farm deploy`.
- For self-hosting, run `node .output/server/index.mjs` behind your process manager or container runtime.
- Confirm the selected target or preset matches `deploy.target`, `deploy.preset`, or the CLI/env override.
- For non-first-class platforms, confirm the Nitro preset name and provider deploy command from Nitro's docs.
- Check generated output exists at the resolved output directory.
- Run provider-specific login commands such as `vercel login`, `wrangler login`, or `netlify login` before deploying.
- Keep provider secrets out of client bundles and UI registry components.
