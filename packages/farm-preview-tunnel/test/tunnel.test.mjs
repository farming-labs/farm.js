import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as createRequest } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";

import { createPersistentPreviewRelay, startTypeScriptPreviewAgent } from "../dist/index.js";

const RELAY_TOKEN = "relay-token-for-tests";

test("localhost wildcard previews preserve their port for scripts and navigation", async () => {
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicDomain: "localhost",
  });
  const address = await relay.listen();
  const target = createServer((request, response) => {
    response.setHeader("content-type", "text/javascript");
    response.end(request.url);
  });
  await listen(target);
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,
    token: RELAY_TOKEN,
    name: "interactive",
    targetUrl: `http://127.0.0.1:${target.address().port}`,
  });
  try {
    assert.equal(agent.publicUrl, `http://interactive.localhost:${address.port}`);
    const response = await requestWithHost(
      `${address.httpUrl}/@farm/client.js`,
      new URL(agent.publicUrl).host,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body, "/@farm/client.js");
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("forwards requests over one persistent websocket and closes with the agent", async () => {
  const activity = [];
  const sessions = [];
  const target = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.statusCode = 201;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
        body: Buffer.concat(chunks).toString(),
      }),
    );
  });
  await listen(target);
  const targetAddress = target.address();

  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    observer: {
      session(event) {
        sessions.push(event);
      },
      request(event) {
        activity.push(event);
        return Promise.reject(new Error("optional reporter failed"));
      },
    },
  });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "typed-agent",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    localProbeIntervalMs: 10,
    localProbeTimeoutMs: 50,
  });

  try {
    const response = await fetch(`${agent.publicUrl}/hello?from=test`, {
      method: "POST",
      body: "farm",
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-farm-preview-transport"), "websocket");
    assert.deepEqual(await response.json(), {
      method: "POST",
      url: "/hello?from=test",
      body: "farm",
    });
    assert.equal(activity.length, 1);
    assert.equal(activity[0].path, "/hello");
    assert.equal(activity[0].status, 201);
    assert.equal(activity[0].headers, undefined);
    assert.equal(activity[0].body, undefined);
    assert.equal(sessions[0].state, "connected");

    await close(target);
    await expectInactive(agent.publicUrl);
  } finally {
    await agent.close();
    await relay.close();
    assert.equal(sessions.at(-1).state, "disconnected");
    assert.equal(sessions.at(-1).token, undefined);
    await close(target);
  }
});

test("mounts public preview paths beneath the target URL pathname", async () => {
  const target = createServer((request, response) => response.end(request.url));
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "base-path",
    targetUrl: `http://127.0.0.1:${targetAddress.port}/console`,
  });

  try {
    const nested = await fetch(`${agent.publicUrl}/dashboard?view=compact`);
    assert.equal(await nested.text(), "/console/dashboard?view=compact");

    const root = await fetch(agent.publicUrl);
    assert.equal(await root.text(), "/console/");
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("replaces client-supplied forwarding headers at the relay boundary", async () => {
  const target = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        forwarded: request.headers.forwarded,
        forwardedFor: request.headers["x-forwarded-for"],
        forwardedHost: request.headers["x-forwarded-host"],
        forwardedProto: request.headers["x-forwarded-proto"],
      }),
    );
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "forwarded-headers",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const response = await fetch(agent.publicUrl, {
      headers: {
        forwarded: "for=127.0.0.1;host=evil.example;proto=https",
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });

    assert.deepEqual(await response.json(), {
      forwardedHost: new URL(agent.publicUrl).host,
      forwardedProto: "http",
    });
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("marks every tunnelled request for the dev server and ignores a visitor's marker", async () => {
  // A raw agent, like the native one, forwards the headers the relay hands it, so the relay
  // must set the marker itself rather than rely on the agent.
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();
  const socket = new WebSocket(address.websocketUrl);
  const seen = [];
  try {
    await once(socket, "open");
    const ready = once(socket, "message");
    socket.send(JSON.stringify({ type: "register", name: "raw-agent", token: RELAY_TOKEN }));
    const { publicUrl } = JSON.parse((await ready)[0].toString());
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== "request") return;
      seen.push(message.headers["x-farm-preview"]);
      socket.send(JSON.stringify({ type: "response", id: message.id, status: 204, headers: {} }));
    });

    assert.equal((await fetch(publicUrl)).status, 204);
    assert.equal((await fetch(publicUrl, { headers: { "x-farm-preview": "" } })).status, 204);
    assert.equal(
      (await fetch(publicUrl, { headers: { "X-Farm-Preview": "trusted-local" } })).status,
      204,
    );
    assert.deepEqual(seen, ["1", "1", "1"]);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("the TypeScript agent marks requests it forwards to the local app", async () => {
  const target = createServer((request, response) => {
    response.end(String(request.headers["x-farm-preview"]));
  });
  await listen(target);
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,
    token: RELAY_TOKEN,
    name: "marked",
    targetUrl: `http://127.0.0.1:${target.address().port}`,
  });
  try {
    assert.equal(await (await fetch(agent.publicUrl)).text(), "1");
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("removes headers nominated by Connection in both proxy directions", async () => {
  const target = createServer((request, response) => {
    response.setHeader("connection", "x-response-hop");
    response.setHeader("x-response-hop", "remove-me");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ requestHop: request.headers["x-request-hop"] }));
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "connection-headers",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const response = await requestWithHost(agent.publicUrl, new URL(agent.publicUrl).host, {
      connection: "x-request-hop",
      "x-request-hop": "remove-me",
    });
    assert.equal(JSON.parse(response.body).requestHop, undefined);
    assert.equal(response.headers["x-response-hop"], undefined);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("preserves repeated cookies host-only and removes encoding after decoding a response", async () => {
  const target = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-encoding", "gzip");
    response.setHeader("content-type", "text/plain");
    response.setHeader("set-cookie", [
      "access=one; Path=/; HttpOnly",
      "refresh=two; Path=/; HttpOnly",
      // Would reach every other preview under the relay's domain.
      "theme=dark; Domain=.example.test; Path=/",
    ]);
    response.end(gzipSync(Buffer.from("decoded preview response")));
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "response-headers",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const response = await fetch(agent.publicUrl);
    assert.equal(await response.text(), "decoded preview response");
    assert.equal(response.headers.get("content-encoding"), null);
    assert.deepEqual(getSetCookies(response.headers), [
      "access=one; Path=/; HttpOnly",
      "refresh=two; Path=/; HttpOnly",
      "theme=dark; Path=/",
    ]);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("stops buffering local responses that exceed the relay limit", async () => {
  const target = createServer((_request, response) => {
    response.write("12345678");
    response.end("9");
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    maxResponseBodyBytes: 8,
  });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "bounded-response",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const response = await fetch(agent.publicUrl);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /exceeded the 8 byte limit/);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("rejects malformed and unauthenticated agent messages without crashing", async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();

  try {
    for (const message of [
      JSON.stringify({ type: "register" }),
      JSON.stringify({
        type: "response",
        id: "not-owned",
        status: 200,
        headers: {},
      }),
    ]) {
      const socket = new WebSocket(
        `${address.websocketUrl}?token=${encodeURIComponent(RELAY_TOKEN)}`,
      );
      await once(socket, "open");
      const responseMessage = once(socket, "message");
      const closed = once(socket, "close");
      socket.send(message);
      const [data] = await responseMessage;
      assert.equal(JSON.parse(data.toString()).type, "error");
      const [code] = await closed;
      assert.equal(code, 1008);
    }

    const health = await fetch(`${address.httpUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).agents, 0);
  } finally {
    await relay.close();
  }
});

test("closes the agent socket when the relay rejects registration", async () => {
  const relay = new WebSocketServer({ port: 0 });
  await once(relay, "listening");
  const address = relay.address();
  assert.ok(address && typeof address === "object");
  let resolveAgentClosed;
  const agentClosed = new Promise((resolve) => {
    resolveAgentClosed = resolve;
  });
  relay.on("connection", (socket) => {
    socket.once("message", () => {
      socket.send(JSON.stringify({ type: "error", message: "registration rejected" }));
    });
    socket.once("close", resolveAgentClosed);
  });

  try {
    await assert.rejects(
      startTypeScriptPreviewAgent({
        relayUrl: `ws://127.0.0.1:${address.port}`,
        name: "rejected-agent",
        targetUrl: "http://127.0.0.1:3000",
      }),
      /registration rejected/,
    );
    await Promise.race([
      agentClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("rejected agent socket remained open")), 500),
      ),
    ]);
    assert.equal(relay.clients.size, 0);
  } finally {
    for (const socket of relay.clients) socket.terminate();
    await new Promise((resolve) => relay.close(resolve));
  }
});

test("advertises explicit public HTTP and WebSocket endpoints", async () => {
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicBaseUrl: "https://preview.example.com/",
    publicWebSocketUrl: "wss://preview.example.com/agent",
  });
  const address = await relay.listen();
  const target = createServer((_request, response) => response.end("ok"));
  await listen(target);
  const targetAddress = target.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: `ws://127.0.0.1:${address.port}/agent`,

    token: RELAY_TOKEN,
    name: "public-address",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    assert.equal(address.websocketUrl, "wss://preview.example.com/agent");
    assert.equal(agent.publicUrl, "https://preview.example.com/preview/public-address");
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("routes wildcard preview hosts and advertises the matching public URL", async () => {
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
  });
  const address = await relay.listen();
  const target = createServer((request, response) => response.end(request.url));
  await listen(target);
  const targetAddress = target.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: `ws://127.0.0.1:${address.port}/agent`,

    token: RELAY_TOKEN,
    name: "wildcard-agent",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    assert.equal(agent.publicUrl, "https://wildcard-agent.preview.example.com");
    const response = await requestWithHost(
      `${address.httpUrl}/nested/path?from=wildcard`,
      "wildcard-agent.preview.example.com",
    );
    assert.equal(response.status, 200);
    assert.equal(response.body, "/nested/path?from=wildcard");
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("routes preview subdomains only by host, never by the path form", async () => {
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
  });
  const address = await relay.listen();
  const targets = [];
  const agents = [];
  for (const name of ["alice", "bob"]) {
    const target = createServer((request, response) => response.end(`${name}:${request.url}`));
    await listen(target);
    targets.push(target);
    agents.push(
      await startTypeScriptPreviewAgent({
        relayUrl: address.websocketUrl,
        token: RELAY_TOKEN,
        name,
        targetUrl: `http://127.0.0.1:${target.address().port}`,
      }),
    );
  }

  try {
    // A tenant origin must not reach another tenant through the path form.
    const crossTenant = await requestWithHost(
      `${address.httpUrl}/preview/bob/account`,
      "alice.preview.example.com",
    );
    assert.equal(crossTenant.body, "alice:/preview/bob/account");

    // Hostnames are case-insensitive.
    const uppercase = await requestWithHost(`${address.httpUrl}/upper`, "BOB.Preview.Example.com");
    assert.equal(uppercase.body, "bob:/upper");

    // The apex domain and loopback hosts keep the path form.
    const apex = await requestWithHost(
      `${address.httpUrl}/preview/bob/apex`,
      "preview.example.com",
    );
    assert.equal(apex.body, "bob:/apex");
    const loopback = await fetch(`${address.httpUrl}/preview/bob/loopback`);
    assert.equal(await loopback.text(), "bob:/loopback");
  } finally {
    for (const agent of agents) await agent.close();
    await relay.close();
    for (const target of targets) await close(target);
  }
});

test("aborts the local request when the public visitor disconnects", async () => {
  let markLocalStarted;
  const localStarted = new Promise((resolve) => {
    markLocalStarted = resolve;
  });
  let markLocalClosed;
  const localClosed = new Promise((resolve) => {
    markLocalClosed = resolve;
  });
  const target = createServer((_request, response) => {
    markLocalStarted();
    response.once("close", markLocalClosed);
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    requestTimeoutMs: 2_000,
  });
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,

    token: RELAY_TOKEN,
    name: "visitor-disconnect",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    requestTimeoutMs: 2_000,
  });

  const publicRequest = createRequest(agent.publicUrl);
  publicRequest.on("error", () => undefined);
  publicRequest.end();

  try {
    await localStarted;
    publicRequest.destroy();
    await Promise.race([
      localClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("local request remained active")), 500),
      ),
    ]);
  } finally {
    publicRequest.destroy();
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("falls through to an existing HTTP gateway when no native session matches", async () => {
  const fallbackRequests = [];
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicDomain: "preview.example.com",
    healthPath: "/api/tunnel/health",
    fallbackHandler(request, response) {
      fallbackRequests.push({ host: request.headers.host, url: request.url });
      response.statusCode = 202;
      response.end("polling fallback");
    },
  });
  const address = await relay.listen();

  try {
    const response = await requestWithHost(
      `${address.httpUrl}/fallback?transport=polling`,
      "missing.preview.example.com",
    );
    assert.equal(response.status, 202);
    assert.equal(response.body, "polling fallback");
    assert.deepEqual(fallbackRequests, [
      {
        host: "missing.preview.example.com",
        url: "/fallback?transport=polling",
      },
    ]);

    const health = await fetch(`${address.httpUrl}/api/tunnel/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).transport, "websocket");
  } finally {
    await relay.close();
  }
});

test("coordinates requests across separate relay instances", async () => {
  let allowed = true;
  let forwarded = 0;
  const coordinator = new MemoryRelayCoordinator();
  const relayA = createPersistentPreviewRelay({
    authorizeSession: async () => allowed,
    registrationToken: RELAY_TOKEN,
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
    coordinator,
    coordinatorSessionTtlMs: 150,
    requestTimeoutMs: 2_000,
  });
  const relayB = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
    coordinator,
    coordinatorSessionTtlMs: 150,
    requestTimeoutMs: 2_000,
  });
  const [addressA, addressB] = await Promise.all([relayA.listen(), relayB.listen()]);
  const target = createServer((request, response) => {
    forwarded++;
    response.end(`shared:${request.url}`);
  });
  await listen(target);
  const targetAddress = target.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: addressA.websocketUrl,

    token: RELAY_TOKEN,
    name: "shared-agent",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const response = await requestWithHost(
      `${addressB.httpUrl}/from/another/instance?coordinated=true`,
      "shared-agent.preview.example.com",
    );
    assert.equal(response.status, 200);
    assert.equal(response.body, "shared:/from/another/instance?coordinated=true");
    const before = forwarded;
    allowed = false;
    const denied = await requestWithHost(
      `${addressB.httpUrl}/denied`,
      "shared-agent.preview.example.com",
    );
    assert.notEqual(denied.status, 200);
    assert.equal(forwarded, before);
  } finally {
    await agent.close();
    await Promise.all([relayA.close(), relayB.close()]);
    await close(target);
  }
});

test("rejects preview paths that could replace the local target authority", async () => {
  let sensitiveRequests = 0;
  const sensitive = createServer((_request, response) => {
    sensitiveRequests += 1;
    response.end("sensitive");
  });
  const target = createServer((_request, response) => response.end("target"));
  await Promise.all([listen(sensitive), listen(target)]);
  const sensitiveAddress = sensitive.address();
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,

    token: RELAY_TOKEN,
    name: "safe-target",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const response = await fetch(`${agent.publicUrl}//127.0.0.1:${sensitiveAddress.port}/private`);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /cannot change the local target authority/i);
    assert.equal(sensitiveRequests, 0);
  } finally {
    await agent.close();
    await relay.close();
    await Promise.all([close(sensitive), close(target)]);
  }
});

test("applies the relay deadline while a request body is still uploading", async () => {
  const target = createServer((_request, response) => response.end("target"));
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    requestTimeoutMs: 50,
  });
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,

    token: RELAY_TOKEN,
    name: "upload-timeout",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  try {
    const status = await startStalledUpload(`${agent.publicUrl}/upload`);
    assert.equal(status, 504);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("cancels stalled local requests at the agent deadline", async () => {
  let localRequestClosed;
  const requestClosed = new Promise((resolve) => {
    localRequestClosed = resolve;
  });
  const target = createServer((request) => {
    request.once("close", localRequestClosed);
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    requestTimeoutMs: 1_000,
  });
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,

    token: RELAY_TOKEN,
    name: "local-timeout",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    requestTimeoutMs: 50,
  });

  try {
    const response = await fetch(`${agent.publicUrl}/stall`);
    assert.equal(response.status, 504);
    await Promise.race([
      requestClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("The stalled local request was not cancelled.")), 1_000),
      ),
    ]);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("survives an abrupt relay connection failure after startup", async () => {
  const target = createServer((_request, response) => response.end("target"));
  await listen(target);
  const targetAddress = target.address();
  const relayServer = createServer();
  const websocketServer = new WebSocketServer({ server: relayServer });
  let peer;
  websocketServer.on("connection", (socket) => {
    peer = socket;
    socket.once("message", () => {
      socket.send(
        JSON.stringify({
          type: "ready",
          sessionId: "abrupt-session",
          publicUrl: "https://preview.example.com/preview/abrupt",
        }),
      );
    });
  });
  await listen(relayServer);
  const relayAddress = relayServer.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: `ws://127.0.0.1:${relayAddress.port}`,
    name: "abrupt",
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
  });

  peer.terminate();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await agent.close();
  await closeWebSocketServer(websocketServer);
  await Promise.all([close(relayServer), close(target)]);
});

test("refuses an agent registration that does not present the relay credential", async () => {
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicDomain: "preview.example.com",
  });
  const address = await relay.listen();

  try {
    const missing = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "victim",
    });
    assert.match(missing.error.message, /rejected the agent credential/);
    assert.equal(missing.code, 1008);

    const wrong = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "victim",
      token: `${RELAY_TOKEN}x`,
    });
    assert.match(wrong.error.message, /rejected the agent credential/);
    assert.equal(wrong.code, 1008);

    // A rejected claim must leave the public hostname unrouted.
    const unrouted = await requestWithHost(`${address.httpUrl}/`, "victim.preview.example.com");
    assert.equal(unrouted.status, 404);

    const accepted = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "victim",
      token: RELAY_TOKEN,
    });
    assert.equal(accepted.ready.publicUrl, `http://victim.preview.example.com:${address.port}`);
  } finally {
    await relay.close();
  }
});

test("accepts the relay credential from the agent upgrade query", async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();

  try {
    // The shipped native agent cannot add fields to the register message, so
    // the credential has to be accepted from the relay URL as well.
    const accepted = await attemptRegistration(
      `${address.websocketUrl}?token=${encodeURIComponent(RELAY_TOKEN)}`,
      { type: "register", name: "native-style" },
    );
    assert.equal(accepted.ready.publicUrl, `${address.httpUrl}/preview/native-style`);

    const wrong = await attemptRegistration(`${address.websocketUrl}?token=nope`, {
      type: "register",
      name: "native-style-2",
    });
    assert.match(wrong.error.message, /rejected the agent credential/);
    assert.equal(wrong.code, 1008);
  } finally {
    await relay.close();
  }
});

test("refuses every registration when no relay credential is configured", async () => {
  const relay = createPersistentPreviewRelay();
  const address = await relay.listen();

  try {
    const rejected = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "unconfigured",
      token: RELAY_TOKEN,
    });
    assert.match(rejected.error.message, /no registrationToken configured/);
    assert.equal(rejected.code, 1008);

    const health = await fetch(`${address.httpUrl}/api/health`);
    assert.equal((await health.json()).agents, 0);
  } finally {
    await relay.close();
  }
});

test("binds an authorized native relay session to its absolute expiry", async (t) => {
  const ttlMs = 10_000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const seen = [];
  const coordinator = new MemoryRelayCoordinator();
  coordinator.takeRequest = () => new Promise(() => {});
  const relay = createPersistentPreviewRelay({
    coordinator,
    authorizeAgent(input) {
      seen.push(input);
      if (input.token !== "session-grant" || input.name !== "expiring") return false;
      return { expiresAt: Date.now() + ttlMs };
    },
  });
  const address = await relay.listen();
  const socket = new WebSocket(`${address.websocketUrl}?token=session-grant`);

  try {
    await once(socket, "open");
    const readyMessage = once(socket, "message");
    const closed = once(socket, "close");
    socket.send(JSON.stringify({ type: "register", name: "expiring" }));
    const [data] = await readyMessage;
    const ready = JSON.parse(data.toString());
    assert.equal(ready.type, "ready");
    assert.equal(ready.expiresAt, Date.now() + ttlMs);
    assert.deepEqual(seen, [{ token: "session-grant", name: "expiring" }]);
    assert.ok(coordinator.claimTtlMs > 0 && coordinator.claimTtlMs <= ttlMs);
    assert.ok(coordinator.touchTtlMs.length > 0);
    assert.ok(coordinator.touchTtlMs.every((ttl) => ttl > 0 && ttl <= ttlMs));

    t.mock.timers.tick(ttlMs);
    const [code, reason] = await closed;
    assert.equal(code, 1000);
    assert.equal(reason.toString(), "Preview expired");
    assert.equal(coordinator.releaseCalls, 1);
    await expectInactive(ready.publicUrl);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("rejects an invalid expiry returned by the relay authorizer", async () => {
  const relay = createPersistentPreviewRelay({
    authorizeAgent: () => ({ expiresAt: Number.NaN }),
  });
  const address = await relay.listen();
  const socket = new WebSocket(`${address.websocketUrl}?token=session-grant`);

  try {
    await once(socket, "open");
    const message = once(socket, "message");
    const closed = once(socket, "close");
    socket.send(JSON.stringify({ type: "register", name: "invalid-expiry" }));
    const [data] = await message;
    assert.match(JSON.parse(data.toString()).message, /expired or is invalid/);
    assert.equal((await closed)[0], 1008);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("keeps a name an authenticated gateway session owns out of relay claims", async () => {
  const gatewayOwnedNames = new Set(["victim"]);
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    publicDomain: "preview.example.com",
    isPreviewNameClaimed: (name) => gatewayOwnedNames.has(name),
    fallbackHandler(_request, response) {
      response.statusCode = 202;
      response.end("polling gateway session");
    },
  });
  const address = await relay.listen();

  try {
    // A relay route wins over the fallback gateway, so holding a valid relay
    // credential must still not repoint a hostname the polling gateway serves.
    const rejected = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "victim",
      token: RELAY_TOKEN,
    });
    assert.match(rejected.error.message, /already active/);
    assert.equal(rejected.code, 1008);

    const owned = await requestWithHost(`${address.httpUrl}/`, "victim.preview.example.com");
    assert.equal(owned.status, 202);
    assert.equal(owned.body, "polling gateway session");

    const accepted = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "unclaimed",
      token: RELAY_TOKEN,
    });
    assert.equal(accepted.ready.publicUrl, `http://unclaimed.preview.example.com:${address.port}`);
  } finally {
    await relay.close();
  }
});

// Token "alice-grant"/"mallory-grant" stand in for name-bound grants of two accounts.
const ownerAuthorizer = ({ token }) =>
  token === "alice-grant" || token === "mallory-grant"
    ? { ownerId: `device:${token.split("-")[0]}` }
    : false;

test("binds a relay name to its owner while held and for the reservation window", async () => {
  const relay = createPersistentPreviewRelay({
    authorizeAgent: ownerAuthorizer,
    nameReservationMs: 200,
  });
  const address = await relay.listen();

  try {
    const alice = await openRegistration(address.websocketUrl, "alice-grant", "acme");
    assert.equal(alice.payload.type, "ready");
    assert.equal(await relay.isPreviewNameClaimed("acme", "device:mallory"), true);
    assert.equal(await relay.isPreviewNameClaimed("acme"), true);
    // The owner's CLI may fall back to polling with the same grant.
    assert.equal(await relay.isPreviewNameClaimed("acme", "device:alice"), false);
    assert.match(
      (
        await attemptRegistration(address.websocketUrl, {
          type: "register",
          name: "acme",
          token: "mallory-grant",
        })
      ).error.message,
      /already active/,
    );

    // Alice's socket drops. Another account cannot take the hostname (and the
    // visitors' cookies) before she reconnects.
    alice.socket.close();
    await once(alice.socket, "close");
    await waitFor(
      async () => (await (await fetch(`${address.httpUrl}/api/health`)).json()).agents === 0,
    );
    assert.equal(await relay.isPreviewNameClaimed("acme", "device:mallory"), true);
    const refused = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "acme",
      token: "mallory-grant",
    });
    assert.match(refused.error.message, /already active/);
    assert.equal(refused.code, 1008);

    // The same owner reconnects inside the window.
    const reconnected = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "acme",
      token: "alice-grant",
    });
    assert.equal(reconnected.ready.type, "ready");

    // After the window the name is free for another account.
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.equal(await relay.isPreviewNameClaimed("acme", "device:mallory"), false);
    const mallory = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "acme",
      token: "mallory-grant",
    });
    assert.equal(mallory.ready.type, "ready");
  } finally {
    await relay.close();
  }
});

test("keeps a dropped name reserved for its owner across relay instances", async () => {
  const coordinator = new MemoryRelayCoordinator();
  coordinator.takeRequest = (_id, timeoutMs) =>
    new Promise((resolve) => setTimeout(() => resolve(undefined), Math.min(timeoutMs, 20)));
  const options = {
    authorizeAgent: ownerAuthorizer,
    coordinator,
    coordinatorSessionTtlMs: 150,
    nameReservationMs: 5_000,
  };
  const relayA = createPersistentPreviewRelay(options);
  const relayB = createPersistentPreviewRelay(options);
  const [addressA, addressB] = await Promise.all([relayA.listen(), relayB.listen()]);

  try {
    const alice = await openRegistration(addressA.websocketUrl, "alice-grant", "acme");
    assert.equal(alice.payload.type, "ready");
    assert.equal(await relayB.isPreviewNameClaimed("acme", "device:mallory"), true);
    assert.equal(await relayB.isPreviewNameClaimed("acme", "device:alice"), false);
    alice.socket.close();
    await once(alice.socket, "close");
    await waitFor(async () => !(await coordinator.findSession("acme")));

    // The other instance never saw Alice's session, but the binding is shared.
    assert.equal(await relayB.isPreviewNameClaimed("acme", "device:mallory"), true);
    assert.equal(await relayB.isPreviewNameClaimed("acme", "device:alice"), false);
    const refused = await attemptRegistration(addressB.websocketUrl, {
      type: "register",
      name: "acme",
      token: "mallory-grant",
    });
    assert.match(refused.error.message, /already active/);
    const reconnected = await attemptRegistration(addressB.websocketUrl, {
      type: "register",
      name: "acme",
      token: "alice-grant",
    });
    assert.equal(reconnected.ready.type, "ready");
  } finally {
    await Promise.all([relayA.close(), relayB.close()]);
  }
});

test("passes the owner to the other transport's check and fails closed when it errors", async () => {
  const asked = [];
  let answer = false;
  const coordinator = new MemoryRelayCoordinator();
  coordinator.takeRequest = () => new Promise(() => {});
  const relay = createPersistentPreviewRelay({
    authorizeAgent: ownerAuthorizer,
    coordinator,
    isPreviewNameClaimed(name, ownerId) {
      asked.push([name, ownerId]);
      // The relay's claim is visible before it asks, so concurrent claims on
      // the two transports cannot both win.
      assert.ok(coordinator.sessions.has(name));
      if (answer === "throw") throw new Error("gateway store down");
      return answer;
    },
  });
  const address = await relay.listen();

  try {
    answer = "throw";
    const failed = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "acme",
      token: "alice-grant",
    });
    assert.match(failed.error.message, /already active/);
    assert.deepEqual(asked, [["acme", "device:alice"]]);
    // The losing claim is released instead of blocking the name until it expires.
    assert.equal(await coordinator.findSession("acme"), undefined);

    answer = false;
    const accepted = await attemptRegistration(address.websocketUrl, {
      type: "register",
      name: "acme",
      token: "alice-grant",
    });
    assert.equal(accepted.ready.type, "ready");
  } finally {
    await relay.close();
  }
});

async function openRegistration(url, token, name) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  const nextMessage = once(socket, "message");
  socket.send(JSON.stringify({ type: "register", name, token }));
  const [data] = await nextMessage;
  return { socket, payload: JSON.parse(data.toString()) };
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the relay.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("rejects a cross-origin agent upgrade", async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();

  try {
    // WebSocket upgrades are not gated by CORS, so a drive-by page could
    // otherwise register an agent from any visitor's browser.
    await assert.rejects(
      openSocket(address.websocketUrl, { origin: "https://evil.example" }),
      /403/,
    );
    await assert.rejects(openSocket(address.websocketUrl, { origin: "null" }), /403/);

    const sameOrigin = await openSocket(address.websocketUrl, {
      origin: new URL(address.httpUrl).origin,
    });
    sameOrigin.close();
  } finally {
    await relay.close();
  }
});

function openSocket(url, headers) {
  const socket = new WebSocket(url, { headers });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function attemptRegistration(url, message) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  const nextMessage = once(socket, "message");
  const closed = once(socket, "close");
  socket.send(JSON.stringify(message));
  const [data] = await nextMessage;
  const payload = JSON.parse(data.toString());
  if (payload.type === "ready") {
    socket.close();
    await closed;
    return { ready: payload };
  }
  const [code] = await closed;
  return { error: payload, code };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

async function expectInactive(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(url);
    const status = response.status;
    await response.arrayBuffer();
    if (status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Preview route remained active after the local target stopped: ${url}`);
}

function getSetCookies(headers) {
  return headers.getSetCookie?.() || [];
}

function startStalledUpload(value) {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { "content-length": "100" },
      },
      (response) => {
        const status = response.statusCode;
        response.resume();
        response.once("end", () => {
          request.destroy();
          resolve(status);
        });
      },
    );
    request.once("error", reject);
    request.write("partial");
  });
}

function requestWithHost(value, host, headers = {}) {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function closeWebSocketServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

class MemoryRelayCoordinator {
  sessions = new Map();
  requests = new Map();
  responses = new Map();
  claimTtlMs = 0;
  touchTtlMs = [];
  releaseCalls = 0;

  async claimSession(session, ttlMs) {
    this.claimTtlMs = ttlMs;
    const existing = await this.findSession(session.name);
    if (existing) return false;
    this.sessions.set(session.name, { ...session, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async findSession(name) {
    const session = this.sessions.get(name);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(name);
      return undefined;
    }
    return { id: session.id, name: session.name };
  }

  async touchSession(session, ttlMs) {
    this.touchTtlMs.push(ttlMs);
    const existing = this.sessions.get(session.name);
    if (existing?.id !== session.id) return false;
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async releaseSession(session) {
    this.releaseCalls += 1;
    if (this.sessions.get(session.name)?.id === session.id) this.sessions.delete(session.name);
  }

  owners = new Map();

  async reserveName(name, ownerId, ttlMs) {
    this.owners.set(name, { ownerId, expiresAt: Date.now() + ttlMs });
  }

  async findNameOwner(name) {
    const owner = this.owners.get(name);
    return owner && owner.expiresAt > Date.now() ? owner.ownerId : undefined;
  }

  async publishRequest(sessionId, request) {
    pushQueue(this.requests, sessionId, request);
  }

  async takeRequest(sessionId, timeoutMs) {
    return await takeQueue(this.requests, sessionId, timeoutMs);
  }

  async publishResponse(sessionId, response) {
    pushQueue(this.responses, `${sessionId}:${response.id}`, response);
  }

  async takeResponse(sessionId, requestId, timeoutMs) {
    return await takeQueue(this.responses, `${sessionId}:${requestId}`, timeoutMs);
  }
}

function pushQueue(queues, key, value) {
  const queue = queues.get(key) || [];
  queue.push(value);
  queues.set(key, queue);
}

async function takeQueue(queues, key, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const queue = queues.get(key);
    const value = queue?.shift();
    if (value) {
      if (!queue.length) queues.delete(key);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  return undefined;
}
