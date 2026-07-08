import assert from "node:assert/strict";
import { createServer } from "node:http";
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

async function createGatewayServer(store) {
  const handler = createNodePreviewGatewayHandler({
    store,
    domain: "preview.farming-labs.dev",
    requestTimeoutMs: 2000,
    pollTimeoutMs: 1000,
    pollIntervalMs: 10,
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
