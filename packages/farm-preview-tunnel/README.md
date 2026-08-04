# `@farm.js/preview-tunnel`

Experimental persistent preview relay and TypeScript agent for Farm.js.

Unlike the current hosted preview gateway, this package keeps requests out of remote object storage. The agent opens one outbound WebSocket to the relay, and the relay multiplexes HTTP requests and responses over that connection.

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

The agent closes automatically when the local target becomes unreachable. The relay then removes its public route.

## Rust agent

The independent `@farm.js/tunnel` N-API package implements the same protocol and can replace `startTypeScriptPreviewAgent` as an optional native fast path. The TypeScript agent remains the portable fallback and protocol reference.

## Prototype limitations

- Request and response bodies are buffered and base64-encoded in JSON.
- Authentication and reconnect/resume are not implemented yet.
- WebSocket upgrade forwarding and Vite HMR are not implemented yet.
- The relay must run on infrastructure that supports long-lived WebSockets.

See `benchmarks/preview-tunnel` for the correctness and performance harness.
