# Farm Preview Gateway on Vercel

This is the Vercel gateway behind `farm preview`.

This example is for Farming Labs maintainers or teams self-hosting their own gateway. Regular Farm app developers do not need to copy, deploy, or configure this app. The default `farm preview` command is backed by the hosted Farming Labs gateway.

It accepts public requests on `*.preview.farming-labs.dev`, hands them to the local `farm preview` CLI over its persistent outbound WebSocket, and returns the local app response to the public caller. The existing outbound HTTPS polling gateway remains available as a compatibility fallback.

The hosted relay uses Redis to coordinate WebSocket agents and HTTP requests across Vercel Function instances. Requests that reach the Function holding the agent socket stay on the direct in-memory path; requests that reach another instance cross the shared Redis queue.

## Deploy

```bash
cd /path/to/farm.js
vercel link
vercel --prod
```

Configure the Vercel project root directory as `examples/preview-gateway`. Deploy from the monorepo root so Vercel includes the `@farm.js/preview-tunnel` workspace package.

Attach both domains to the Vercel project:

```txt
preview.farming-labs.dev
*.preview.farming-labs.dev
```

Vercel will show the DNS records it expects. After DNS is verified, Vercel handles HTTPS certificates for the apex and wildcard preview domains.

## Required environment for production

Two shared stores keep the native and compatibility transports reliable across Vercel Function instances.

### Native WebSocket coordination

Create an Upstash for Redis resource in the relay's region and connect it to Production and Preview:

```bash
vercel integration add upstash/upstash-kv \
  --plan free \
  --name preview-relay-coordinator \
  -m primaryRegion=iad1 \
  -m autoUpgrade=false
```

The integration injects `REDIS_URL`. Without it, the WebSocket relay uses only the current Function's memory, which is suitable for local development but not multi-instance Vercel traffic.

### Compatibility polling storage

The hosted Farming Labs gateway uses Vercel Blob. Create and link it once:

```bash
vercel blob create-store farm-preview-gateway --access private --region iad1 --yes
```

When the project is linked, Vercel connects the store and injects the Blob env automatically.

If you prefer a Redis-compatible REST store for the polling fallback, the reusable gateway package also reads either set of variables:

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

Without Blob or Redis REST env vars, compatibility polling falls back to in-memory storage. That is useful for local development, but not reliable for production Vercel traffic because requests can be handled by different Function instances.

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

This gateway buffers request and response bodies. It is intended for local app sharing, OAuth callbacks, webhooks, API testing, and design review. The agent transport is a persistent WebSocket, but WebSocket upgrades and SSE streams from the local target are not forwarded yet.

Vercel closes a Function WebSocket at the Function's maximum duration. The deployed gateway uses the current 30-minute maximum; reconnect/resume remains future work for the native agent.
