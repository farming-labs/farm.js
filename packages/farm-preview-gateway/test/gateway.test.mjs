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

test("rejects claiming a preview name that is actively in use", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const first = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4321" }),
    });
    assert.equal(first.status, 200);
    const firstSession = await first.json();

    const second = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:9999" }),
    });
    assert.equal(second.status, 409);
    assert.match(await second.text(), /already active/);

    // The original session still owns its name.
    const session = await store.getSessionByName("demo");
    assert.equal(session.id, firstSession.id);
  } finally {
    await gateway.close();
  }
});

test("keeps a taken-over name routable after the stale session is deleted", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, {
    clientHeartbeatTimeoutMs: 20,
    requestTimeoutMs: 2000,
  });

  try {
    const first = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4321" }),
    });
    assert.equal(first.status, 200);
    const stale = await first.json();

    // Let the first session miss its heartbeat window, then take the name over.
    await delay(50);
    const second = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4322" }),
    });
    assert.equal(second.status, 200);
    const takeover = await second.json();

    // Deleting the stale session must not unroute the takeover session.
    const deletion = await fetch(`${gateway.url}/api/sessions/${stale.id}?token=${stale.token}`, {
      method: "DELETE",
    });
    assert.equal(deletion.status, 200);

    const session = await store.getSessionByName("demo");
    assert.ok(session, "expected the takeover session to still own the name");
    assert.equal(session.id, takeover.id);

    // Public traffic still reaches the takeover session's queue.
    const publicRequest = fetch(`${gateway.url}/__preview/demo/health`);
    const poll = await fetch(
      `${gateway.url}/api/sessions/${takeover.id}/requests?token=${takeover.token}&wait=1000`,
    ).then((response) => response.json());
    assert.equal(poll.requests.length, 1);
    assert.equal(poll.requests[0].path, "/health");

    await fetch(
      `${gateway.url}/api/sessions/${takeover.id}/responses/${poll.requests[0].id}?token=${takeover.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("takeover-ok").toString("base64"),
          encoding: "base64",
        }),
      },
    );
    const response = await publicRequest;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "takeover-ok");
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
