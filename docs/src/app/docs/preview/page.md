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

Farm checks the configured app port, common development ports, and any explicit `--port` or `--url` value. Once a running app is found, Farm opens a public tunnel and keeps the process alive until Ctrl+C.

```txt
Creating public preview for the running app...
Local:  http://localhost:3000
Opening public tunnel...
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
| `--name <name>` | Request a readable preview name when the tunnel provider supports it. |
| `--dry-run` | Validate detection and print the tunnel command without opening it. |
| `--no-probe` | Skip local reachability checks when `--port` is provided. |

## Managed Preview

Farm can be wired to a managed preview service without changing the user-facing command. Set `FARM_PREVIEW_TUNNEL_COMMAND` to a command template that prints the public HTTPS URL after opening the tunnel.

```bash
FARM_PREVIEW_TUNNEL_COMMAND='farm-preview-agent tunnel --url {url} --hostname {hostname}' farm preview
```

Available template values are `{url}`, `{port}`, `{host}`, `{name}`, and `{hostname}`. This is how a hosted Farm Labs preview service can return URLs such as `https://checkout-test.preview.farming-labs.dev` while the app owner still runs only `farm preview`.

## Fallbacks

When no managed command is configured, Farm auto-selects an available local tunnel tool. It prefers installed system tunnel clients and can fall back to npm-based tunneling when `npx` is available. Provider details stay out of the normal workflow; the command still remains `farm preview`.

## Security

The preview URL forwards traffic to your local app. Treat it like a temporary public deployment:

- Stop the command when the review or webhook test is done.
- Do not expose apps with local-only admin screens or secrets unless you trust the audience.
- Use short preview names for webhook and OAuth callback URLs you need to paste into providers.
