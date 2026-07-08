---
title: "Instant Preview"
description: "Expose the current local Farm app through a public URL for sharing, webhooks, OAuth callbacks, and external testing."
section: "Runtime"
---

# Instant Preview

Expose the app that is already running on your machine through a public URL.

```bash
farm dev
farm preview
```

`farm preview` does not build or deploy the app. It is an instant tunnel for the current local server, so it works well for Stripe webhooks, auth callbacks, mobile device testing, design review, and letting another person try the app without pushing a deployment.

## Usage

```bash
farm preview
farm preview --port 3000
farm preview --url http://localhost:4319
farm preview --name checkout-test
```

Farm checks the configured app port, common development ports, and any explicit `--port` or `--url` value. Once a running app is found, Farm opens a preview gateway session and keeps forwarding requests until Ctrl+C.

```txt
Creating public preview for the running app...
Local:  http://localhost:3000
Gateway: https://preview.farming-labs.dev
Opening Farm preview gateway session...
Preview URL ready.
Public: https://checkout-test.preview.farming-labs.dev
Forwarding requests until Ctrl+C.
```

## Options

| Option | Purpose |
| --- | --- |
| `--port <port>` | Expose a specific local port. |
| `--host <host>` | Expose a specific local host. Defaults to `localhost`. |
| `--url <url>` | Expose a full local URL. |
| `--gateway <url>` | Use a specific Farm Preview gateway. Defaults to `https://preview.farming-labs.dev`. |
| `--provider <provider>` | Use `farm` for the managed gateway or `local` for local tunnel fallback. |
| `--name <name>` | Request a readable preview URL name. |
| `--dry-run` | Validate detection and print the gateway or tunnel plan without opening it. |
| `--no-probe` | Skip local reachability checks when `--port` is provided. |

## Vercel Gateway

The default provider is the Farm Preview gateway. The gateway is a small Vercel app that you deploy to `preview.farming-labs.dev` and `*.preview.farming-labs.dev`.

```bash
cd examples/preview-gateway
vercel --prod
```

Attach both domains to the Vercel project:

```txt
preview.farming-labs.dev
*.preview.farming-labs.dev
```

For production, configure a shared Redis-compatible REST store so every Vercel function invocation sees the same sessions and queued requests:

```txt
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

or:

```txt
KV_REST_API_URL
KV_REST_API_TOKEN
```

Set the gateway env:

```txt
FARM_PREVIEW_DOMAIN=preview.farming-labs.dev
FARM_PREVIEW_GATEWAY_URL=https://preview.farming-labs.dev
```

The CLI sends outbound HTTPS polling requests to the gateway, so developers do not need `cloudflared`, ngrok, or another tunnel binary installed locally.

## Custom Providers

If you need to integrate a private tunnel provider, set `FARM_PREVIEW_TUNNEL_COMMAND` to a command template that prints the public HTTPS URL after opening the tunnel.

```bash
FARM_PREVIEW_TUNNEL_COMMAND='farm-preview-agent tunnel --url {url} --hostname {hostname}' farm preview
```

Available template values are `{url}`, `{port}`, `{host}`, `{name}`, and `{hostname}`.

## Security

The preview URL forwards traffic to your local app. Treat it like a temporary public deployment:

- Stop the command when the review or webhook test is done.
- Do not expose apps with local-only admin screens or secrets unless you trust the audience.
- Use short preview names for webhook and OAuth callback URLs you need to paste into providers.
