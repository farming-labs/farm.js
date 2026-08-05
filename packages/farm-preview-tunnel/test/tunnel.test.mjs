import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as createRequest } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";

import { createPersistentPreviewRelay, startTypeScriptPreviewAgent } from "../dist/index.js";

test("forwards requests over one persistent websocket and closes with the agent", async () => {
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

  const relay = createPersistentPreviewRelay();
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,
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

    await close(target);
    await expectInactive(agent.publicUrl);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("preserves repeated cookies and removes encoding after decoding a response", async () => {
  const target = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-encoding", "gzip");
    response.setHeader("content-type", "text/plain");
    response.setHeader("set-cookie", [
      "access=one; Path=/; HttpOnly",
      "refresh=two; Path=/; HttpOnly",
    ]);
    response.end(gzipSync(Buffer.from("decoded preview response")));
  });
  await listen(target);
  const targetAddress = target.address();
  const relay = createPersistentPreviewRelay();
  const relayAddress = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,
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
    ]);
  } finally {
    await agent.close();
    await relay.close();
    await close(target);
  }
});

test("rejects malformed and unauthenticated agent messages without crashing", async () => {
  const relay = createPersistentPreviewRelay();
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
      const socket = new WebSocket(address.websocketUrl);
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

test("advertises explicit public HTTP and WebSocket endpoints", async () => {
  const relay = createPersistentPreviewRelay({
    publicBaseUrl: "https://preview.example.com/",
    publicWebSocketUrl: "wss://preview.example.com/agent",
  });
  const address = await relay.listen();
  const target = createServer((_request, response) => response.end("ok"));
  await listen(target);
  const targetAddress = target.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: `ws://127.0.0.1:${address.port}/agent`,
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
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
  });
  const address = await relay.listen();
  const target = createServer((request, response) => response.end(request.url));
  await listen(target);
  const targetAddress = target.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: `ws://127.0.0.1:${address.port}/agent`,
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

test("falls through to an existing HTTP gateway when no native session matches", async () => {
  const fallbackRequests = [];
  const relay = createPersistentPreviewRelay({
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
  const coordinator = new MemoryRelayCoordinator();
  const relayA = createPersistentPreviewRelay({
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
    coordinator,
    coordinatorSessionTtlMs: 150,
    requestTimeoutMs: 2_000,
  });
  const relayB = createPersistentPreviewRelay({
    publicBaseUrl: "https://preview.example.com",
    publicDomain: "preview.example.com",
    coordinator,
    coordinatorSessionTtlMs: 150,
    requestTimeoutMs: 2_000,
  });
  const [addressA, addressB] = await Promise.all([relayA.listen(), relayB.listen()]);
  const target = createServer((request, response) => response.end(`shared:${request.url}`));
  await listen(target);
  const targetAddress = target.address();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: addressA.websocketUrl,
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
  const relay = createPersistentPreviewRelay();
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,
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
  const relay = createPersistentPreviewRelay({ requestTimeoutMs: 50 });
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,
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
  const relay = createPersistentPreviewRelay({ requestTimeoutMs: 1_000 });
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,
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

function requestWithHost(value, host) {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: { host },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString(),
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

  async claimSession(session, ttlMs) {
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
    const existing = this.sessions.get(session.name);
    if (existing?.id !== session.id) return false;
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async releaseSession(session) {
    if (this.sessions.get(session.name)?.id === session.id) this.sessions.delete(session.name);
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
