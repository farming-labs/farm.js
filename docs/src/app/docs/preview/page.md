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

`farm preview` does not build or deploy the app. It connects the current local server to the hosted Farm Preview gateway, so it works well for Stripe webhooks, auth callbacks, mobile device testing, design review, and letting another person try the app without pushing a deployment.

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
| `--name <name>` | Request a readable preview URL name. |
| `--dry-run` | Validate detection and print the preview plan without opening it. |
| `--no-probe` | Skip local reachability checks when `--port` is provided. |
| `--gateway <url>` | Advanced: use a different Farm Preview gateway. |
| `--provider <provider>` | Advanced: use `farm` for the hosted gateway or `local` for a custom local provider. |

## Hosted Gateway

The default gateway is operated by Farming Labs at `https://preview.farming-labs.dev`. App developers do not need a Vercel account, DNS changes, Redis setup, `cloudflared`, ngrok, or another tunnel binary.

```bash
farm preview --name stripe-webhook
```

That returns a URL like:

```txt
https://stripe-webhook.preview.farming-labs.dev
```

The hosted gateway owns the wildcard domain, TLS, Vercel deployment, session store, and request relay. The local CLI only opens outbound HTTPS requests to that gateway and forwards traffic to the local app.

The gateway source lives in `examples/preview-gateway` for Farming Labs maintainers or anyone self-hosting their own gateway. Regular Farm apps do not need to copy or deploy it.

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
