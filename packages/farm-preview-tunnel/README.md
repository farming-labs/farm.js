# `@farm.js/preview-tunnel`

Persistent preview relay protocol and TypeScript reference agent for Farm.js.

The agent opens one outbound WebSocket to the relay, and the relay multiplexes HTTP requests and responses over that connection. The hosted gateway uses this transport first and keeps its HTTPS polling gateway as a compatibility fallback.

```ts
import { createPersistentPreviewRelay, startTypeScriptPreviewAgent } from "@farm.js/preview-tunnel";

const registrationToken = process.env.FARM_PREVIEW_RELAY_TOKEN;
if (!registrationToken) throw new Error("FARM_PREVIEW_RELAY_TOKEN is required");

const relay = createPersistentPreviewRelay({
  port: 4400,
  registrationToken,
});
const address = await relay.listen();

const agent = await startTypeScriptPreviewAgent({
  relayUrl: address.websocketUrl,
  name: "my-preview",
  token: registrationToken,
  targetUrl: "http://127.0.0.1:3000",
});

console.log(agent.publicUrl);
```

When the relay binds to all interfaces behind a public reverse proxy, configure the
externally reachable HTTP and WebSocket URLs independently:

```ts
const relay = createPersistentPreviewRelay({
  host: "0.0.0.0",
  port: 4400,
  publicBaseUrl: "https://preview.example.com",
  publicDomain: "preview.example.com",
  publicWebSocketUrl: "wss://preview.example.com/agent",
});
```

Public relays should authorize each agent before allowing it to claim a preview name. The callback can validate a short-lived, name-bound grant and return its absolute expiry; the relay closes that agent route when the grant expires:

```ts
const relay = createPersistentPreviewRelay({
  authorizeAgent: async ({ token, name }) => {
    const grant = await verifyGrant(token, name);
    return grant ? { expiresAt: grant.expiresAt } : false;
  },
});
```

`registrationToken` is intended for simple self-hosted deployments that use one shared secret. The
agent must pass that secret through its `token` option. Managed deployments should instead mint a
short-lived grant, validate it in `authorizeAgent`, and pass that grant through the same agent option.

When the relay can run on multiple server instances, provide a shared `PersistentPreviewRelayCoordinator`. Same-instance requests continue to use the direct in-memory path; the coordinator carries requests and responses only when the HTTP request lands on another instance. The hosted Vercel gateway uses Redis lists and expiring session ownership for this path.

The agent closes automatically when the local target becomes unreachable. The relay then removes its public route.

Local response bodies are limited to 5 MiB by default because the current protocol buffers and base64-encodes them. Configure `maxResponseBodyBytes` on the relay to change the limit; the relay advertises that limit to compatible agents and also enforces it when accepting responses. The TypeScript agent can set a smaller `maxResponseBodyBytes`, but cannot exceed the relay's limit.

The relay sends a per-request cancellation message when a public visitor disconnects or the relay deadline expires. Compatible agents abort the matching localhost request, so abandoned streaming and slow responses do not continue running in the app.

## Rust agent

The independent `@farm.js/tunnel` N-API package implements the same protocol and is the native agent used by `farm preview`. The TypeScript agent remains the portable protocol reference and fallback.

## Prototype limitations

- Request and response bodies are buffered and base64-encoded in JSON within their configured size limits.
- Agents do not reconnect or resume an interrupted WebSocket session yet. The Farm CLI falls back to the HTTPS polling transport when a managed native relay disconnects before the preview expires.
- WebSocket upgrade forwarding and Vite HMR are not implemented yet.
- The relay must run on infrastructure that supports WebSockets. The TypeScript reference agent does not reconnect when the infrastructure's maximum connection duration is reached.

See `benchmarks/preview-tunnel` for the correctness and performance harness.
