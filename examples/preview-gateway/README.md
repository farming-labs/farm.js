# Farm Preview Gateway on Vercel

This is the Vercel gateway behind `farm preview`.

This example is for Farming Labs maintainers or teams self-hosting their own gateway. Regular Farm app developers do not need to copy, deploy, or configure this app. The default `farm preview` command is backed by the hosted Farming Labs gateway.

It accepts public requests on `*.preview.farming-labs.dev`, hands them to the local `farm preview` CLI over outbound HTTPS polling, and returns the local app response to the public caller. No `cloudflared`, ngrok, or local tunnel binary is required on the developer machine.

## Deploy

```bash
cd examples/preview-gateway
vercel --prod
```

Attach both domains to the Vercel project:

```txt
preview.farming-labs.dev
*.preview.farming-labs.dev
```

Vercel will show the DNS records it expects. After DNS is verified, Vercel handles HTTPS certificates for the apex and wildcard preview domains.

## Required environment for production

Use a shared store so all Vercel function invocations see the same sessions and queued requests.

The hosted Farming Labs gateway uses Vercel Blob. Create and link it once:

```bash
vercel blob create-store farm-preview-gateway --access private --region iad1 --yes
```

When the project is linked, Vercel connects the store and injects the Blob env automatically.

If you prefer a Redis-compatible REST store, the reusable gateway package also reads either set of variables:


```txt
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

or:

```txt
KV_REST_API_URL
KV_REST_API_TOKEN
```

Set:

```txt
FARM_PREVIEW_DOMAIN=preview.farming-labs.dev
FARM_PREVIEW_GATEWAY_URL=https://preview.farming-labs.dev
```

Without Blob or Redis REST env vars, the gateway falls back to in-memory storage. That is useful for local development, but not reliable for production Vercel traffic because requests can be handled by different function instances.

## CLI usage

After the gateway is deployed:

```bash
farm dev
farm preview --name stripe-webhook
```

The CLI prints:

```txt
Public: https://stripe-webhook.preview.farming-labs.dev
```

## Local gateway development

Run the gateway locally:

```bash
cd examples/preview-gateway
FARM_PREVIEW_GATEWAY_URL=http://localhost:3000 vercel dev
```

Then point the CLI at it:

```bash
farm preview --gateway http://localhost:3000 --name local-check
```

For local gateway runs, the public URL uses the path fallback:

```txt
http://localhost:3000/__preview/local-check
```

## Limits

This gateway buffers request and response bodies. It is intended for local app sharing, OAuth callbacks, webhooks, API testing, and design review. It is not a streaming WebSocket/SSE tunnel.
