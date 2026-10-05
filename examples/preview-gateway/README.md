# Farm Preview Gateway on Vercel

This is the Vercel gateway behind `farm preview`.

This example is for Farming Labs maintainers or teams self-hosting their own gateway. Regular Farm app developers do not need to copy, deploy, or configure this app. The default `farm preview` command is backed by the hosted Farming Labs gateway.

It accepts public requests on `*.preview.farmjs.dev`, hands them to the local `farm preview` CLI over its persistent outbound WebSocket, and returns the local app response to the public caller. The existing outbound HTTPS polling gateway remains available as a compatibility fallback.

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
preview.farmjs.dev
*.preview.farmjs.dev
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
The same Redis connection enforces a shared per-client limit on managed login exchanges. A production
deployment with managed authentication enabled refuses to start without `REDIS_URL`, `KV_URL`, or
`UPSTASH_REDIS_URL` so GitHub token verification cannot be exposed without shared abuse control.

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
FARM_PREVIEW_DOMAIN=preview.farmjs.dev
FARM_PREVIEW_GATEWAY_URL=https://preview.farmjs.dev
```

### Managed developer login

#### Farm Infra mode

To use Farm Infra API keys and first-party browser device approval, configure:

```txt
FARM_INFRA_URL=https://your-infra.example.com
FARM_PREVIEW_GATEWAY_SECRET=<separate-random-secret-at-least-32-bytes>
FARM_PREVIEW_AUTH_SECRET=<gateway-signing-secret-at-least-32-bytes>
```

Set the identical `FARM_PREVIEW_GATEWAY_SECRET` in Infra. It authenticates the private
identity/activity backchannel; it is not a developer API key and must never reach the
CLI or browser. `FARM_INFRA_URL` must be an HTTPS origin (loopback HTTP works locally).
The integration never follows redirects carrying credentials.

Apply Infra's auth, API-key, and preview schema migrations **before** deploying and
enabling this gateway mode. Production auth includes a database-backed rate limiter.
Ship the compatible CLI update as well: older clients do not understand the new
`device` provider. Keep the existing Redis and Blob configuration described above.

The gateway verifies API keys/device credentials with Infra on every grant. The signed
grant contains the verified owner, preview name, and expiry. Only that short-lived grant
reaches the tunnel transport. A revoked key cannot create a new grant; existing grants
remain usable until their expiry. Missing/unavailable identity services fail closed.

Optional `observer` hooks in both gateway transports report session lifecycle and
request metadata. This example forwards them using Vercel `waitUntil`, with bounded
concurrency and timeouts; failures never break public requests. Heartbeats are throttled
to one report per session per 20 seconds. No request bodies, headers, query strings or
credentials are reported. Paths may still contain application identifiers. Reporting
is best-effort; it is not a durable audit stream. The dashboard marks old heartbeats stale.

Infra keeps the latest 200 requests per session and lists the latest 50 sessions that
expired less than seven days ago. Configure the maintenance POST described in the Infra
README to physically delete expired sessions and their request records. This gateway
does not automatically provision that scheduler.

#### Legacy GitHub mode

Leave `FARM_INFRA_URL` unset to retain the existing GitHub flow:

Create a GitHub OAuth app with Device Flow enabled. Configure its public client id and a private Farm
signing secret:

```bash
openssl rand -hex 32
vercel env add FARM_PREVIEW_GITHUB_CLIENT_ID production
vercel env add FARM_PREVIEW_AUTH_SECRET production
```

The signing secret must contain at least 32 bytes and must not be distributed to CLI users. When
both variables are present, the gateway exchanges a verified GitHub device login for an opaque Farm
account token, then issues a name-bound, expiring grant for each preview. Set
`FARM_PREVIEW_DEFAULT_TTL_MS` and `FARM_PREVIEW_MAX_TTL_MS` to override the default one-hour and
maximum 24-hour lifetimes. Set both auth variables or neither; a partial setup fails at startup.

The included Redis limiter trusts `x-forwarded-for` only when Vercel's `VERCEL=1` runtime marker is
present, because Vercel overwrites that header at the edge. If the marker or client address is
missing, managed login fails closed with a retryable `503`. A port to another hosting platform must
derive its rate-limit identity from the connection address or a proxy-authenticated header instead
of enabling trust for client-supplied forwarding headers. Keep **Automatically expose System
Environment Variables** enabled in the Vercel project so the runtime marker is available. Redis
client errors are logged server-side while callers receive the same generic `503` response.

Without Blob or Redis REST env vars, compatibility polling falls back to in-memory storage. That is useful for local development, but not reliable for production Vercel traffic because requests can be handled by different Function instances.

## CLI usage

After the gateway is deployed:

```bash
farm dev
farm preview --name stripe-webhook --expires 2h
```

The CLI prints:

```txt
Public: https://stripe-webhook.preview.farmjs.dev
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

By default, local gateway runs use the path fallback:

```txt
http://localhost:3000/__preview/local-check
```

For interactive websites, set `FARM_PREVIEW_DOMAIN=localhost` on the local gateway
as well. The public URL becomes `http://local-check.localhost:3000`, preserving
the gateway port. Each preview gets its own origin, so root-relative scripts,
styles, API calls, and links reach that preview without rewriting the app. Use a
browser that resolves `*.localhost` to loopback. The path fallback is useful for
individual HTTP requests but does not relocate an app's root-relative URLs.

When composing the Node adapters yourself, pass `domain: "localhost"` to
`createNodePreviewGatewayHandler` and `publicDomain: "localhost"` to
`createPersistentPreviewRelay`. Keep the CLI's gateway/relay endpoints on the
gateway origin, not on a preview subdomain. Target WebSocket upgrades, including
Vite HMR, remain subject to the limits below.

## Limits

This gateway buffers request and response bodies. It is intended for local app sharing, OAuth callbacks, webhooks, API testing, and design review. The agent transport is a persistent WebSocket, but WebSocket upgrades and SSE streams from the local target are not forwarded yet.

Vercel closes a Function WebSocket at the Function's maximum duration. The deployed gateway uses the current 30-minute maximum; reconnect/resume remains future work for the native agent.
