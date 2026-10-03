# @farm.js/preview-gateway

Farm.js preview gateway for Vercel-hosted instant preview URLs

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

```bash
npm install @farm.js/preview-gateway
```

See the [Farm.js repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.

The gateway limits public request bodies and local preview response bodies to 5 MiB by default. Use `maxBodyBytes` and `maxResponseBodyBytes` when creating the handler to set lower or higher limits. Oversized local responses are rejected at upload and the waiting public request receives a `502` response instead of being left pending.

Public disconnects are propagated through the request queue. The polling agent aborts the matching localhost fetch instead of leaving abandoned app work running until its timeout.

Managed deployments can configure `auth` with a GitHub OAuth client id and a signing secret. The gateway then exposes the CLI login exchange, issues account-bound tunnel grants scoped to one preview name and absolute expiry, and requires a grant before creating a session:

```ts
const githubClientId = process.env.FARM_PREVIEW_GITHUB_CLIENT_ID;
const signingSecret = process.env.FARM_PREVIEW_AUTH_SECRET;
if (!githubClientId || !signingSecret) {
  throw new Error("Farm Preview managed auth is not configured");
}

const handler = createPreviewGatewayHandler({
  auth: {
    githubClientId,
    signingSecret,
  },
});
```

Keep the signing secret server-only and at least 32 bytes long. GitHub access tokens are used only to resolve the account identity during exchange and are not included in Farm credentials.
Managed public gateways should also provide `rateLimitExchange`. The hook runs before the request body
is read or the provider API is called, and rejected requests receive `429` with `Retry-After`. Use a
shared store for multi-instance deployments; the hosted Vercel example uses an atomic Redis window.
If that shared limiter is unavailable, the exchange fails closed with a retryable `503` response and
does not contact the provider API.

Managed grants and explicitly requested durations are absolute expiries. An unauthenticated session
created without `expiresInMs` instead uses `sessionTtlMs` as an idle lease and extends it only when the
local polling agent proves it is still online.

Current gateways advertise bearer-header authentication for polling session controls. The Farm CLI
uses query-string session tokens only after it positively identifies a pre-auth compatibility gateway.
