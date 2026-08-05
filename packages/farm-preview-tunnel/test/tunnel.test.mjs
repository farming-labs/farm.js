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

function closeWebSocketServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}
