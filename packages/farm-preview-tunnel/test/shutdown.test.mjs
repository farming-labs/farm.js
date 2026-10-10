import assert from "node:assert/strict";
import { once } from "node:events";
import { Agent, createServer, request as createRequest } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { createPersistentPreviewRelay, startTypeScriptPreviewAgent } from "../dist/index.js";

const RELAY_TOKEN = "relay-token-for-tests";
// Without these fixes each case below waits for its peer, Node's keep-alive
// timeout, or ws's 30s close timeout, so a bounded test fails instead of hanging.
const SHUTDOWN_TEST = { timeout: 5_000 };

test("closes with no connections and tolerates repeated close", SHUTDOWN_TEST, async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  await relay.listen();
  await Promise.all([relay.close(), relay.close()]);
  await relay.close();
  assert.equal(relay.server.listening, false);
});

test("closes a relay that never listened or failed to listen", SHUTDOWN_TEST, async () => {
  await createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN }).close();

  const occupied = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const { port } = await occupied.listen();
  const conflicting = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN, port });
  try {
    await assert.rejects(conflicting.listen(), { code: "EADDRINUSE" });
    await conflicting.close();
  } finally {
    await occupied.close();
  }
});

test("releases an accepted socket that never sent a request", SHUTDOWN_TEST, async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();
  const accepted = once(relay.server, "connection");
  const peer = connect(address.port, address.host);
  try {
    await Promise.all([once(peer, "connect"), accepted]);
    await Promise.all([relay.close(), once(peer, "close")]);
  } finally {
    peer.destroy();
  }
});

test("releases a socket whose request headers never completed", SHUTDOWN_TEST, async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();
  const accepted = once(relay.server, "connection");
  const peer = connect(address.port, address.host);
  try {
    await Promise.all([once(peer, "connect"), accepted]);
    const [socket] = await accepted;
    const received = once(socket, "data");
    peer.write("GET /api/health HTTP/1.1\r\nHost: localhost\r\n");
    await received;
    await Promise.all([relay.close(), once(peer, "close")]);
  } finally {
    peer.destroy();
  }
});

test("releases an idle keep-alive socket after a completed request", SHUTDOWN_TEST, async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();
  const agent = new Agent({ keepAlive: true });
  try {
    const response = await sendRequest(address, "/api/health", agent);
    assert.equal(response.status, 200);
    assert.equal(response.connection, "keep-alive");
    await relay.close();
  } finally {
    agent.destroy();
  }
});

test("lets an active request finish and then closes its connection", SHUTDOWN_TEST, async () => {
  let entered;
  const handlerEntered = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const relay = createPersistentPreviewRelay({
    registrationToken: RELAY_TOKEN,
    async fallbackHandler(_request, response) {
      entered();
      await released;
      response.end("finished during shutdown");
    },
  });
  const address = await relay.listen();
  const agent = new Agent({ keepAlive: true });
  try {
    const responded = sendRequest(address, "/app", agent);
    await handlerEntered;
    const closing = relay.close();
    release();
    // Shutdown must not reset the socket that still owns an active response.
    const response = await responded;
    assert.equal(response.status, 200);
    assert.equal(response.body, "finished during shutdown");
    assert.equal(response.connection, "close");
    await closing;
  } finally {
    agent.destroy();
  }
});

test("answers a forwarded request still waiting on the agent with 503", SHUTDOWN_TEST, async () => {
  const relay = createPersistentPreviewRelay({
    publicDomain: "localhost",
    registrationToken: RELAY_TOKEN,
  });
  const address = await relay.listen();
  const socket = new WebSocket(address.websocketUrl);
  try {
    await once(socket, "open");
    const ready = once(socket, "message");
    socket.send(JSON.stringify({ type: "register", name: "pending", token: RELAY_TOKEN }));
    await ready;
    // Never answer the forwarded request.
    const forwarded = once(socket, "message");
    const responded = sendRequest(address, "/", undefined, "pending.localhost");
    await forwarded;
    const closed = once(socket, "close");
    await relay.close();
    const response = await responded;
    assert.equal(response.status, 503);
    assert.equal(response.body, "Persistent preview relay is shutting down.");
    const [code] = await closed;
    assert.equal(code, 1001);
  } finally {
    socket.terminate();
  }
});

test("closes an upgraded agent socket that never registered", SHUTDOWN_TEST, async () => {
  const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
  const address = await relay.listen();
  const socket = new WebSocket(address.websocketUrl);
  try {
    await once(socket, "open");
    const closed = once(socket, "close");
    await relay.close();
    const [code, reason] = await closed;
    assert.equal(code, 1001);
    assert.equal(reason.toString(), "Relay shutting down");
  } finally {
    socket.terminate();
  }
});

test(
  "terminates a registered agent that never answers the close frame",
  SHUTDOWN_TEST,
  async () => {
    const relay = createPersistentPreviewRelay({ registrationToken: RELAY_TOKEN });
    const address = await relay.listen();
    const socket = new WebSocket(address.websocketUrl);
    try {
      await once(socket, "open");
      const ready = once(socket, "message");
      socket.send(JSON.stringify({ type: "register", name: "unresponsive", token: RELAY_TOKEN }));
      await ready;
      const closed = once(socket, "close");
      // Stop reading so the relay's close frame is never acknowledged.
      socket._socket.pause();
      await relay.close();
      socket._socket.resume();
      await closed;
      assert.equal(relay.server.listening, false);
    } finally {
      socket.terminate();
    }
  },
);

test("stops an agent whose relay never answers the close frame", SHUTDOWN_TEST, async () => {
  const target = createServer((_request, response) => response.end("target"));
  await listen(target);
  const relayServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(relayServer, "listening");
  let peer;
  relayServer.on("connection", (socket) => {
    peer = socket;
    socket.once("message", () => {
      socket.send(
        JSON.stringify({
          type: "ready",
          sessionId: "unresponsive-relay",
          publicUrl: "https://preview.example.com/preview/unresponsive",
        }),
      );
      // Stop reading so the agent's close frame is never acknowledged.
      socket._socket.pause();
    });
  });
  try {
    const agent = await startTypeScriptPreviewAgent({
      relayUrl: `ws://127.0.0.1:${relayServer.address().port}`,
      name: "unresponsive-relay",
      targetUrl: `http://127.0.0.1:${target.address().port}`,
    });
    const peerClosed = once(peer, "close");
    await agent.close();
    peer._socket.resume();
    await peerClosed;
  } finally {
    for (const socket of relayServer.clients) socket.terminate();
    await new Promise((resolve) => relayServer.close(() => resolve()));
    await new Promise((resolve) => target.close(() => resolve()));
  }
});

function sendRequest(address, path, agent, host = "localhost") {
  return new Promise((resolve, reject) => {
    createRequest(
      { host: address.host, port: address.port, path, agent, headers: { host } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body, connection: response.headers.connection }),
        );
      },
    )
      .on("error", reject)
      .end();
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
