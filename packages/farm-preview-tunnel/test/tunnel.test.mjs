import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

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
  });
}

async function expectInactive(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(url);
    if (response.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Preview route remained active after the local target stopped: ${url}`);
}
