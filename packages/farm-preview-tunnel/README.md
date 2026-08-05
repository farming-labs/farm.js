# `@farm.js/preview-tunnel`

Persistent preview relay protocol and TypeScript reference agent for Farm.js.

The agent opens one outbound WebSocket to the relay, and the relay multiplexes HTTP requests and responses over that connection. The hosted gateway uses this transport first and keeps its HTTPS polling gateway as a compatibility fallback.

```ts
import { createPersistentPreviewRelay, startTypeScriptPreviewAgent } from "@farm.js/preview-tunnel";

const relay = createPersistentPreviewRelay({ port: 4400 });
const address = await relay.listen();

const agent = await startTypeScriptPreviewAgent({
  relayUrl: address.websocketUrl,
  name: "my-preview",
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

When the relay can run on multiple server instances, provide a shared `PersistentPreviewRelayCoordinator`. Same-instance requests continue to use the direct in-memory path; the coordinator carries requests and responses only when the HTTP request lands on another instance. The hosted Vercel gateway uses Redis lists and expiring session ownership for this path.

The agent closes automatically when the local target becomes unreachable. The relay then removes its public route.

## Rust agent

The independent `@farm.js/tunnel` N-API package implements the same protocol and is the native agent used by `farm preview`. The TypeScript agent remains the portable protocol reference and fallback.

## Prototype limitations

- Request and response bodies are buffered and base64-encoded in JSON.
- Authentication and reconnect/resume are not implemented yet.
- WebSocket upgrade forwarding and Vite HMR are not implemented yet.
- The relay must run on infrastructure that supports long-lived WebSockets. Clients do not reconnect when the infrastructure's maximum connection duration is reached yet.

See `benchmarks/preview-tunnel` for the correctness and performance harness.
