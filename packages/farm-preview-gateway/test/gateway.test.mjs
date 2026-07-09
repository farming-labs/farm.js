import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createNodePreviewGatewayHandler, MemoryPreviewGatewayStore } from "../dist/index.js";

test("proxies a public preview request through the gateway queue", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const sessionResponse = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "docs-check",
        localUrl: "http://localhost:4321",
      }),
    });
    const session = await sessionResponse.json();

    assert.equal(session.publicUrl, `${gateway.url}/__preview/docs-check`);

    const publicRequest = fetch(`${gateway.url}/__preview/docs-check/docs?hello=world`);
    const pollResponse = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    );
    const poll = await pollResponse.json();

    assert.equal(poll.requests.length, 1);
    assert.equal(poll.requests[0].method, "GET");
    assert.equal(poll.requests[0].path, "/docs?hello=world");

    await fetch(
      `${gateway.url}/api/sessions/${session.id}/responses/${poll.requests[0].id}?token=${session.token}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: 202,
          headers: {
            "content-type": "text/plain",
          },
          body: Buffer.from("preview-ok").toString("base64"),
          encoding: "base64",
        }),
      },
    );

    const response = await publicRequest;
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "preview-ok");
  } finally {
    await gateway.close();
  }
});

test("expires stale preview clients before queueing public requests", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, {
    clientHeartbeatTimeoutMs: 20,
    requestTimeoutMs: 2000,
  });

  try {
    const sessionResponse = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "stale-check",
        localUrl: "http://localhost:4321",
      }),
    });
    assert.equal(sessionResponse.status, 200);

    await delay(50);

    const startedAt = Date.now();
    const response = await fetch(`${gateway.url}/__preview/stale-check/docs`);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(response.status, 404);
    assert.match(await response.text(), /No active Farm preview/);
    assert.ok(elapsedMs < 1000, `expected stale request to fail quickly, got ${elapsedMs}ms`);
  } finally {
    await gateway.close();
  }
});

async function createGatewayServer(store, options = {}) {
  const handler = createNodePreviewGatewayHandler({
    store,
    domain: "preview.farming-labs.dev",
    requestTimeoutMs: 2000,
    pollTimeoutMs: 1000,
    pollIntervalMs: 10,
    ...options,
  });
  const server = createServer(handler);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://localhost:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
