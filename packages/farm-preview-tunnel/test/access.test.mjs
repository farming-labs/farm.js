import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createPersistentPreviewRelay, startTypeScriptPreviewAgent } from "../dist/index.js";

test("idle WebSocket previews close when the authority fails", { timeout: 15_000 }, async () => {
  let unavailable = false;
  let disconnected;
  const closed = new Promise((resolve) => {
    disconnected = resolve;
  });
  const target = createServer((_req, res) => res.end("ok"));
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const relay = createPersistentPreviewRelay({
    registrationToken: "fixture",
    authorizeSession: async () => {
      if (unavailable) throw new Error("private detail");
      return true;
    },
    observer: {
      session: (event) => {
        if (event.state === "disconnected") disconnected();
      },
    },
  });
  const address = await relay.listen();
  const agent = await startTypeScriptPreviewAgent({
    relayUrl: address.websocketUrl,
    token: "fixture",
    name: "idle",
    targetUrl: `http://127.0.0.1:${target.address().port}`,
  });
  try {
    unavailable = true;
    await closed;
    assert.equal((await fetch(agent.publicUrl)).status, 404);
  } finally {
    await agent.close();
    await relay.close();
    await new Promise((resolve) => target.close(resolve));
  }
});

test("WebSocket revocation denies traffic and reconnects without forwarding secrets to access hooks", async () => {
  let allowed = true;
  let forwarded = 0;
  const target = createServer((_req, res) => {
    forwarded++;
    res.end("ok");
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const seen = [];
  const relay = createPersistentPreviewRelay({
    authorizeAgent: () => ({
      ownerId: "device:owner",
      project: "store",
      keyId: "key_ci",
      grantId: "grant_one",
      expiresAt: Date.now() + 60_000,
    }),
    authorizeSession: async (access) => {
      seen.push(access);
      return allowed;
    },
  });
  const address = await relay.listen();
  const options = {
    relayUrl: address.websocketUrl,
    token: "fixture",
    name: "store",
    targetUrl: `http://127.0.0.1:${target.address().port}`,
  };
  const agent = await startTypeScriptPreviewAgent(options);
  try {
    assert.equal((await fetch(agent.publicUrl)).status, 200);
    const before = forwarded;
    allowed = false;
    assert.equal((await fetch(agent.publicUrl)).status, 403);
    assert.equal(forwarded, before);
    await agent.close();
    await assert.rejects(startTypeScriptPreviewAgent(options));
    assert.ok(seen.length > 1);
    assert.equal(seen[0].grantId, "grant_one");
    assert.equal(seen[0].socket, undefined);
    assert.equal(seen[0].token, undefined);
  } finally {
    await agent.close();
    await relay.close();
    await new Promise((resolve) => target.close(resolve));
  }
});
