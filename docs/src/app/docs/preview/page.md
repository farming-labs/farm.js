---
title: "Instant Preview"
description: "Expose a running local Farm app through a public URL for sharing, webhook testing, OAuth callbacks, mobile QA, and browser automation."
section: "Runtime"
---

# Instant Preview

Expose the Farm app that is already running on your machine through a temporary public URL.

```bash
farm dev --port 3000
farm preview --port 3000
```

`farm preview` is not a deployment command. It does not run `farm build`, upload output, or create a production release. It opens an outbound connection from the CLI to the Farm Preview gateway and forwards public traffic back to your local dev server.

Use it when an external system needs to reach the app you are actively developing:

- Stripe, Clerk, Better Auth, Supabase, Unkey, or custom webhooks.
- OAuth redirect and callback URLs.
- Mobile device testing on a real phone.
- Sharing a local branch with a teammate.
- Browser automation that needs a public HTTPS origin.
- Demoing an integration before it is deployed.

## Quick Start

Start the app first:

```bash
farm dev --port 4324
```

Open a preview in another terminal:

```bash
farm preview --port 4324 --name checkout-test --expires 2h
```

Previews use a Farm.js Infrastructure API key. Without one, the first preview opens
[app.farmjs.dev](https://app.farmjs.dev): sign in or create an account (email and password, or
GitHub) and confirm the code. The CLI then asks whether to create an API key for this machine;
answer yes and it saves the key. If your account already has projects, it offers them, and the
one you pick is saved to the app's `.env` as `FARMJS_PROJECT_ID`:

```txt
Creating public preview for the running app...
Local:  http://localhost:4324
Confirm this code in Farm.js Infrastructure: W7KDQ2PL
Open: https://app.farmjs.dev/device?user_code=W7KDQ2PL
After approving this device, return here.
Create an API key for this machine? (Y/n) y
Signed in to Farm Preview as your Farm.js Infrastructure account.
Use one of your Farm.js Infrastructure projects for this app?
  1) Storefront (Acme)
Project number, or Enter to skip: 1
Saved FARMJS_PROJECT_ID for Storefront to .env.
Relay: wss://preview.farmjs.dev/agent
Opening native Farm preview tunnel...
Preview URL ready.
Public: https://checkout-test.preview.farmjs.dev
Expires: Sep 30, 2026, 3:45 PM
Forwarding requests through the native tunnel until Ctrl+C.
```

Later previews reuse the saved API key and don't ask again. Pass `--login`, or run
`farm login`, to get a new one. In an interactive terminal,
omitting `--expires` prompts for a duration and defaults to one hour. In CI and other
non-interactive terminals, the hosted default is used.

### Farm.js Infrastructure authentication and dashboard

`farm preview` needs one credential, a Farm.js Infrastructure API key:

- If `FARMJS_API_KEY` is set, in your shell, your CI secrets, or the app's `.env` files, it is
  used and there is no sign-in.
- Otherwise `farm login`, or the first `farm preview`, signs you in at app.farmjs.dev and asks
  whether to create an API key for this machine. Yes saves it in a file only your user can read;
  no creates nothing. It then offers your existing projects; the one you pick goes into the
  app's `.env` as `FARMJS_PROJECT_ID`. Apps that already set it aren't asked.
- `farm logout` forgets that saved key on this machine. The key itself stays valid until you
  revoke it in Farm.js Infrastructure.

1. With a Farm.js Infrastructure API key in `FARMJS_API_KEY`, the same key analytics uses,
   the CLI signs in with it and never opens a browser. It reads the key from your shell or
   your CI secrets, and from the app's `.env` files the way `farm dev` does. Set
   `FARMJS_API_URL` too if Infrastructure isn't at `https://app.farmjs.dev`: the key is
   only sent to a gateway that signs in through that Infrastructure.
2. Without a key or saved login, the CLI opens Farm.js Infrastructure, displays a code, and waits
   for you to confirm the matching code and explicitly authorize your terminal.
3. Return to the CLI. Choose the preview duration when prompted, or pass `--expires`.
4. Once the tunnel is ready, the CLI prints its public URL and a dashboard link.

CI never waits for browser approval: set `FARMJS_API_KEY`, otherwise the command fails
with instructions. For CI, create a key restricted to the preview's project, with an
expiry, rather than an account-wide key. `FARM_PREVIEW_TOKEN` is deprecated: it still works
and prints a warning, and `FARMJS_API_KEY` replaces it. Device approval only exists to create the
key: the CLI trades the approved sign-in for an API key and keeps nothing else.
The gateway verifies that credential or API key whenever it issues a new, name-scoped
grant. A grant cannot outlive the verified account session or API key expiry. API keys
may be restricted to one project slug: pass the matching `--project` when starting a preview.
With the matching Infra access-control gateway, revoking a key also blocks existing
preview traffic. **Stop preview** in the detail page revokes that grant across reconnects
without stopping your local app; start a new `farm preview` to get another grant.
Both transports check access before forwarding. WebSocket relays also check idle connections
every five seconds; authority requests have a five-second timeout and fail closed.
Work already executed locally cannot be undone. Older gateways without the access hook
only enforce key revocation on new grants, so deploy the matching Infra migrations and
access endpoint before updating the gateway. Revoking a device account session prevents
new grants; stop existing previews separately.

The Previews dashboard shows account-owned connections, expiry, and the latest 200
request metadata records per preview. It refreshes every five seconds and marks missing
heartbeats as **Stale**, not live. Paths, methods, statuses, durations, and times are
recorded; query strings, headers, and bodies are excluded. Paths may still contain app
identifiers or embedded credentials; never put secrets in URL paths. This is best-effort activity reporting, not an audit log
or your application's stdout/stderr. Your app still runs on your computer or CI runner.

### Projects and preview details

One API key can create multiple previews across multiple projects. The key authenticates
your account; it does not define a project. Each run has its own preview ID, detail URL,
expiry, and request history. Use a different `--name` for simultaneously running previews.

```bash
farm preview --project storefront --name checkout-review --expires 2h
farm preview --project storefront --name payment-review --expires 1h
farm preview --project docs --name docs-review --expires 1h
```

The managed CLI defaults the project to a normalized `package.json` name under `--root`
(or the directory name when no package name exists). Set `--project` or
`FARM_PREVIEW_PROJECT` to a stable lowercase slug to group runs from different checkouts.
Projects are scoped to your account. Older clients are grouped by their preview name.

Filter projects on `/dashboard/previews`, then open a preview to inspect its transport,
credential ID (never the key itself), request paths, response statuses, and timings.
Search requests or filter error responses without collecting payloads. The CLI's
dashboard link opens that preview directly. Activity is retained until seven days
after preview expiry; it is best-effort metadata, not a complete request archive.

This requires matching CLI, gateway, and Infra releases plus database/environment setup.

During the relay rollout, the CLI warns and falls back to compatibility gateway polling if the hosted endpoint cannot accept the native WebSocket connection. An explicitly configured `FARM_PREVIEW_RELAY_URL` is tried first as well.

If a managed native relay disconnects before the printed expiry, the same CLI process reuses its
session-scoped grant and continues through compatibility polling. This preserves the preview until
its absolute expiry instead of turning a relay invocation limit into a shortened user session.

Open the public URL from another browser, device, webhook provider, or test runner:

```txt
https://checkout-test.preview.farmjs.dev
```

Keep both terminals running while you test. Stop the preview with `Ctrl+C`.

## Expiry and Automatic Shutdown

Every hosted preview has an absolute expiry enforced by the gateway and relay. Set it explicitly
with minutes, hours, or days:

```bash
farm preview --expires 30m
farm preview --expires 2h
farm preview --expires 1d
```

The hosted service may cap the requested duration. The CLI prints the authoritative expiry returned
by the service. Heartbeats do not extend it. After expiration, browser visitors see a friendly
Farm preview-expired page.

The preview lifecycle is tied to the local app. When `farm dev` stops or the configured local target becomes unreachable, the native tunnel closes its hosted relay session and `farm preview` exits. The compatibility path closes its gateway session the same way.

The public URL is invalidated as soon as the session closes. Browser navigation receives an expired
preview page; API-style requests receive `404`. You do not need to run a separate command to stop or
clean up the tunnel.

Cancellation also applies to individual requests. If a visitor closes the connection while a slow or streaming local response is still running, the gateway tells the preview agent to abort that localhost request.

## Commands

```bash
farm preview
farm preview --port 3000
farm preview --host 127.0.0.1 --port 3000
farm preview --url http://localhost:4319
farm preview --name stripe-webhook
farm preview --project storefront --name checkout-review
farm preview --expires 2h
farm preview --login
farm preview --dry-run
```

### Account commands

```bash
farm login
farm whoami
farm logout
```

`farm login` signs in and saves an API key without starting a preview. `farm whoami` prints
the gateway, how it signs people in, and which credential `farm preview` would send:
`FARMJS_API_KEY` (shown by its first characters, never the whole key), the deprecated
`FARM_PREVIEW_TOKEN`, or the saved key. It also says when `FARMJS_API_KEY` is set but not
used, and exits with code 1 when `farm preview` would need a browser sign-in, so scripts can
check first.

`farm logout` deletes the saved key from this machine. It doesn't revoke it; revoke keys in the
Farm.js Infrastructure dashboard.

All three read the app's `.env` files the way `farm preview` does, and accept `--gateway` and
`--root`.

When no target is passed, Farm tries to detect a running app from the current project config and common development ports. Pass `--port` or `--url` when the app is running somewhere specific.

The pathname in `--url` is a mount point. For example, `--url
http://localhost:4319/console` forwards the public preview root to `/console/` and a public
`/settings` request to `/console/settings` without allowing the public path to escape that mount.

## Options

| Option                  | Purpose                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `--port <port>`         | Expose a specific local port.                                                       |
| `--host <host>`         | Expose a specific local host. Defaults to `localhost`.                              |
| `--url <url>`           | Expose a full local URL.                                                            |
| `--name <name>`         | Request a readable preview URL name.                                                |
| `--project <slug>`      | Group managed previews under an account-owned dashboard project.                    |
| `--expires <duration>`  | Keep the URL live for a duration such as `30m`, `2h`, or `1d`.                      |
| `--login`               | Sign in again instead of reusing the saved Farm Preview account.                    |
| `--dry-run`             | Validate target detection and print the preview plan without opening a session.     |
| `--no-probe`            | Skip the local reachability check when `--port` is provided.                        |
| `--gateway <url>`       | Advanced: use a different Farm Preview gateway.                                     |
| `--provider <provider>` | Advanced: use `farm` for the hosted gateway or `local` for a custom local provider. |

## Readable URLs

Use `--name` when the URL needs to be pasted into a provider dashboard.

```bash
farm preview --port 4324 --name stripe-webhook
```

Farm normalizes the name into a safe subdomain:

```txt
https://stripe-webhook.preview.farmjs.dev
```

Names are best treated as temporary handles. Stop and restart the command when you want to rotate the session.

A name belongs to the account that claimed it. While your preview runs, and for five minutes after it
stops or disconnects, another account gets an "already active" error for that name, so a restart or
dropped connection can reconnect before anyone else takes the URL. You can always reclaim your own name.

## Request Logging

Every remote request is visible in the preview terminal:

```txt
GET /api-demo-client -> 200 1139ms
GET /@farm/client.js -> 200 1790ms
GET /src/app/api-demo-client/page.tsx?import -> 200 1074ms
GET /api/hello?name=something -> 200 621ms
POST /api/auth/login -> 200 580ms
POST /api/users -> 200 1014ms
```

The local `farm dev` terminal also logs the same app-level work:

```txt
[FARM] [PAGE] [GET] /api-demo-client - 200 (21ms)
[FARM] [API] [GET] /api/hello?name=something - 200 (5ms)
[FARM] [API] [POST] /api/auth/login - 200 (5ms)
```

Use the preview terminal to confirm traffic is reaching the tunnel, and use the dev terminal to confirm Farm handled the route, API handler, middleware, or page render.

## Interaction Model

The hosted preview forwards HTTP requests from the public URL to your local app. Browser interaction works after the client runtime hydrates.

In development, Vite serves many separate modules before hydration completes. Over a public tunnel that can make the first page load feel slower than localhost. Farm queues button clicks that happen before hydration and replays them after React attaches, so an early click on a client component does not silently disappear.

After hydration, normal client-side handlers run in the browser and API calls go through the preview URL:

```tsx
"use client";

import { apiClient } from "../lib/api";

export default function Demo() {
  return (
    <button
      onClick={async () => {
        const result = await apiClient.hello.get({
          query: { name: "preview" },
        });
        console.log(result.data);
      }}
    >
      Fetch
    </button>
  );
}
```

That click is visible as `GET /api/hello?name=preview` in both the preview and dev terminals.

## Webhook Testing

Run the local app:

```bash
farm dev --port 4324
```

Open a named preview:

```bash
farm preview --port 4324 --name stripe-local
```

Use the public route in the provider dashboard:

```txt
https://stripe-local.preview.farmjs.dev/api/stripe/webhook
```

When the provider sends an event, the preview terminal shows the public request and the dev terminal shows the Farm API route. This is the fastest way to test integration routes before deploying them.

## OAuth and Auth Callbacks

For auth providers that require a public redirect URL, use a named preview URL and paste the callback path:

```txt
https://auth-check.preview.farmjs.dev/api/auth/callback
```

Keep the preview running for the whole login test. If you restart with a different name, update the provider callback URL too.

## Hosted Gateway

The default gateway is operated by Farming Labs:

```txt
https://preview.farmjs.dev
```

Regular Farm apps do not need Vercel, DNS, Redis, ngrok, `cloudflared`, or a separately installed tunnel binary. The CLI loads `@farm.js/tunnel`, tries to open one outbound WebSocket to the gateway, and forwards requests through its native Rust transport. Compatibility gateway polling keeps previews available while the hosted relay is being rolled out.

The hosted gateway owns:

- TLS for `*.preview.farmjs.dev`.
- Developer identity, name authorization, and absolute session expiry.
- Short-lived, single-preview tunnel grants. A shared relay secret is never sent to developers.
- Request and response relay over the persistent WebSocket or compatibility polling path.
- Stale session cleanup.

The local CLI owns:

- Local target detection.
- Farm.js Infrastructure sign-in and the saved API key.
- Native tunnel lifecycle and local reachability checks.
- Forwarding requests to `localhost`.
- Request and response logging.
- Closing the preview when the local app exits.

Preview transports currently buffer bodies while carrying them through the relay. Public request and local response bodies are limited to 5 MiB by default; an oversized request receives `413`, while an oversized local response receives `502`. Self-hosted gateway and relay operators can configure those limits.

## Self-Hosting a Gateway

Most app developers should use the hosted gateway. Self-host only when you are operating a private preview domain or maintaining Farming Labs infrastructure.

The gateway example lives in `examples/preview-gateway`.

```bash
cd examples/preview-gateway
pnpm install
vercel deploy
```

The Vercel example can use Vercel Blob as the session store. Configure a private Blob store for the Vercel project, then set the public domain:

```bash
vercel blob create-store farm-preview-gateway --access private --region iad1 --yes
vercel env add FARM_PREVIEW_DOMAIN production
```

For managed login, generate two secrets and keep them only on the server:

```bash
openssl rand -hex 32
vercel env add FARM_PREVIEW_AUTH_SECRET production
vercel env add FARM_PREVIEW_GATEWAY_SECRET production
```

`FARM_PREVIEW_AUTH_SECRET` signs the short-lived tunnel grants. `FARM_PREVIEW_GATEWAY_SECRET`
lets the gateway check API keys with Farm.js Infrastructure at app.farmjs.dev; set the same value
there. Neither ever reaches a developer machine. `FARM_PREVIEW_DEFAULT_TTL_MS` and
`FARM_PREVIEW_MAX_TTL_MS` optionally control the default and maximum hosted durations. See the
gateway example README for the deployment order and activity cleanup contract.

For a private domain such as `preview.example.com`, configure:

- `preview.example.com` for the gateway root.
- `*.preview.example.com` as a wildcard domain.
- `FARM_PREVIEW_DOMAIN=preview.example.com`.

Then point the CLI at it:

```bash
farm preview --gateway https://preview.example.com --name checkout-test
```

## Custom Tunnel Providers

If you need to integrate a private tunnel provider, set `FARM_PREVIEW_TUNNEL_COMMAND` to a command template that prints the public HTTPS URL after opening the tunnel.

```bash
FARM_PREVIEW_TUNNEL_COMMAND='farm-preview-agent tunnel --url {url} --hostname {hostname}' farm preview
```

Available template values are `{url}`, `{port}`, `{host}`, `{name}`, and `{hostname}`.

With `--provider local` (cloudflared, localtunnel, or this template), `{url}`, `{port}`, and
`{host}` point at a loopback proxy that `farm preview` starts in front of your app, not at the app
itself. The proxy marks each request as preview traffic, so the protections below apply to these
tunnels too, and passes WebSocket upgrades such as Vite HMR through. Point the tunnel at the
values it is given rather than at the app's own port, or the protections are skipped.

Use this path only when the hosted Farm gateway is not appropriate for your environment.

## Environment Variables

| Variable                        | Purpose                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `FARM_PREVIEW_GATEWAY_URL`      | Override the hosted gateway URL.                                                                                |
| `FARM_PREVIEW_RELAY_URL`        | Override the persistent WebSocket relay URL.                                                                    |
| `FARM_PREVIEW_DOMAIN`           | Override the preview domain used for generated hostnames.                                                       |
| `FARM_PREVIEW_NAME`             | Provide a default readable preview name.                                                                        |
| `FARM_PREVIEW_PROJECT`          | Stable dashboard project slug; overridden by `--project`.                                                       |
| `FARM_PREVIEW_PROVIDER`         | Select `farm` or `local`.                                                                                       |
| `FARM_PREVIEW_TUNNEL_COMMAND`   | Command template for a custom local tunnel provider.                                                            |
| `FARMJS_API_KEY`                | Farm.js Infrastructure API key. Signs previews in without a browser on a gateway that uses that Infrastructure. |
| `FARMJS_API_URL`                | Farm.js Infrastructure's address, if it isn't `https://app.farmjs.dev`.                                         |
| `FARM_PREVIEW_TOKEN`            | Deprecated. Use `FARMJS_API_KEY`. Still accepted, with a warning.                                               |
| `FARM_PREVIEW_CREDENTIALS_PATH` | Override the local managed-preview credential file.                                                             |

## Troubleshooting

| Symptom                                                               | Check                                                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `No active Farm preview is running`                                   | The CLI session stopped, expired, or the local app exited. Restart `farm preview`.                                                      |
| `The local Farm preview did not respond before the gateway timed out` | Confirm `farm dev` is still running and the local route is not hanging.                                                                 |
| Public page loads, but clicks feel delayed                            | Wait for the first hydration pass. Dev-mode Vite modules are forwarded through the tunnel. Early button clicks are queued and replayed. |
| No traffic appears in the preview terminal                            | The browser may still be loading modules, the URL may be stale, or the request may be blocked before reaching the gateway.              |
| Traffic appears in preview terminal but not `farm dev`                | The local target may be wrong. Re-run with `--port` or `--url`.                                                                         |
| HMR websocket errors appear in the browser console                    | The hosted preview currently forwards HTTP traffic. Vite HMR websocket forwarding is not part of the hosted gateway yet.                |
| Webhook provider receives a non-2xx response                          | Check the local dev terminal for the actual Farm API route error.                                                                       |

## Security

The preview URL forwards public internet traffic to your local app. Treat it like a temporary public deployment:

- Stop the command when testing is finished.
- The CLI saves only the API key, in a file created with user-only permissions. Use `--login`
  or `farm login` to replace it, and `farm logout` to remove it.
- Tunnel grants are bound to one normalized preview name and one absolute expiry. Current polling
  control requests send session credentials in the `Authorization` header. The native agent is
  configured with one relay URL, so its name-bound grant is carried only on the outbound `/agent`
  WebSocket URL; it is never added to the public preview URL. Pre-auth compatibility gateways may
  still require their random session token in control-request query strings. Gateway operators
  should redact `/agent` and legacy control-request query strings from access logs.
- Do not expose admin-only routes, local dashboards, or secret-bearing pages unless you trust the audience.
- Keep hardcoded secrets out of source files. A preview serves your app's modules the way the dev
  server does, so code under the source directory can be read as transformed JavaScript.
- Don't treat the dev server's file serving as an access boundary. Farm narrows it for preview
  traffic, described below, but the preview is still a development server.
- Do not paste a preview URL into untrusted systems.
- Rotate preview names after sharing sensitive routes.
- Keep provider secrets in environment variables, not client code.
- Remember that anyone with the URL can send requests while the session is active.

### What the preview serves from your machine

The preview relay, the polling gateway client, and the local-provider proxy mark every tunnelled
request with an `x-farm-preview` header and overwrite any value a visitor sends. For marked requests, the
dev server serves your pages, API routes, and actions as usual, plus what the browser needs to run
the app: Vite's client, Farm's client entry, public files, dependencies under `node_modules`, and
modules and assets inside the source directory (and layer source directories). It answers `403` for:

- Files outside the source directory, such as `farm.config.ts`, `package.json`, local databases,
  and scripts, and any workspace file reached through `/@fs/`, unless browser code already imports
  that exact URL.
- `?raw`, `?inline`, and `?url` requests unless app code imports that exact URL.
- Non-asset files inside the source directory, such as `.json`, `.sqlite`, or `.yaml` files
  requested directly.
- DevTools (`/__farm/devtools*`) and Vite's open-in-editor endpoint.

Independently of preview, the dev server never serves `.farm/` (the auth database, build caches,
and the server bundle) or a custom `distDir`. Farm adds them to Vite's `server.fs.deny` and keeps
Vite's default entries, or appends them to your own `server.fs.deny` list.

## Production Deployments

Use `farm preview` for temporary access to a running local app. Use `farm build` and the deployment guide for production releases.

```bash
farm build
```

Preview is for the branch you are holding in your editor. Deployment is for the version you want to keep online.
