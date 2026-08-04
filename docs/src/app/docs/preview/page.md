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
farm preview --port 4324 --name checkout-test
```

Farm prints the local target, hosted gateway, and public URL:

```txt
Creating public preview for the running app...
Local:  http://localhost:4324
Gateway: https://preview.farming-labs.dev
Opening Farm preview gateway session...
Preview URL ready.
Public: https://checkout-test.preview.farming-labs.dev
Forwarding requests until Ctrl+C. Remote traffic will be logged below.
```

Open the public URL from another browser, device, webhook provider, or test runner:

```txt
https://checkout-test.preview.farming-labs.dev
```

Keep both terminals running while you test. Stop the preview with `Ctrl+C`.

## Automatic Shutdown

The preview lifecycle is tied to the local app. When `farm dev` stops or the configured local target becomes unreachable, `farm preview` automatically closes the hosted gateway session and exits:

```txt
Local preview target http://localhost:4324 is no longer reachable. Closing preview session.
```

The public URL is invalidated as soon as the session closes, so later requests return `404`. You do not need to run a separate command to stop or clean up the tunnel.

## Commands

```bash
farm preview
farm preview --port 3000
farm preview --host 127.0.0.1 --port 3000
farm preview --url http://localhost:4319
farm preview --name stripe-webhook
farm preview --dry-run
```

When no target is passed, Farm tries to detect a running app from the current project config and common development ports. Pass `--port` or `--url` when the app is running somewhere specific.

## Options

| Option                  | Purpose                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `--port <port>`         | Expose a specific local port.                                                       |
| `--host <host>`         | Expose a specific local host. Defaults to `localhost`.                              |
| `--url <url>`           | Expose a full local URL.                                                            |
| `--name <name>`         | Request a readable preview URL name.                                                |
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
https://stripe-webhook.preview.farming-labs.dev
```

Names are best treated as temporary handles. Stop and restart the command when you want to rotate the session.

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

import { api } from "../lib/api-client";

export default function Demo() {
  return (
    <button
      onClick={async () => {
        const result = await api.hello.get({
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
https://stripe-local.preview.farming-labs.dev/api/stripe/webhook
```

When the provider sends an event, the preview terminal shows the public request and the dev terminal shows the Farm API route. This is the fastest way to test integration routes before deploying them.

## OAuth and Auth Callbacks

For auth providers that require a public redirect URL, use a named preview URL and paste the callback path:

```txt
https://auth-check.preview.farming-labs.dev/api/auth/callback
```

Keep the preview running for the whole login test. If you restart with a different name, update the provider callback URL too.

## Hosted Gateway

The default gateway is operated by Farming Labs:

```txt
https://preview.farming-labs.dev
```

Regular Farm apps do not need Vercel, DNS, Redis, ngrok, `cloudflared`, or a local tunnel binary. The CLI opens outbound HTTPS requests to the gateway, polls for queued public requests, forwards them to the local app, and uploads the response.

The hosted gateway owns:

- TLS for `*.preview.farming-labs.dev`.
- Session creation and expiry.
- Public request queueing.
- Response relay.
- Stale session cleanup.

The local CLI owns:

- Local target detection.
- Local reachability checks.
- Forwarding requests to `localhost`.
- Request and response logging.
- Closing the preview when the local app exits.

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

Use this path only when the hosted Farm gateway is not appropriate for your environment.

## Environment Variables

| Variable                      | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `FARM_PREVIEW_GATEWAY_URL`    | Override the hosted gateway URL.                          |
| `FARM_PREVIEW_DOMAIN`         | Override the preview domain used for generated hostnames. |
| `FARM_PREVIEW_NAME`           | Provide a default readable preview name.                  |
| `FARM_PREVIEW_PROVIDER`       | Select `farm` or `local`.                                 |
| `FARM_PREVIEW_TUNNEL_COMMAND` | Command template for a custom local tunnel provider.      |

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
- Do not expose admin-only routes, local dashboards, or secret-bearing pages unless you trust the audience.
- Do not paste a preview URL into untrusted systems.
- Rotate preview names after sharing sensitive routes.
- Keep provider secrets in environment variables, not client code.
- Remember that anyone with the URL can send requests while the session is active.

## Production Deployments

Use `farm preview` for temporary access to a running local app. Use `farm build` and the deployment guide for production releases.

```bash
farm build
```

Preview is for the branch you are holding in your editor. Deployment is for the version you want to keep online.
