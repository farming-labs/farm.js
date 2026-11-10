import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createPreviewGatewayHandler, MemoryPreviewGatewayStore } from "../dist/index.js";

const signingSecret = "fixture-signing-secret-with-at-least-32-bytes";

// Bearer "alice" and "mallory" are two different accounts.
function fixture(options = {}) {
  const store = new MemoryPreviewGatewayStore();
  const handler = createPreviewGatewayHandler({
    store,
    pollIntervalMs: 1,
    auth: {
      signingSecret,
      deviceAuth: {
        issuer: "https://infra.example",
        clientId: "farm-preview",
        authorizeAccount: async (token) => ({ subject: token, login: token }),
      },
    },
    ...options,
  });
  const call = (path, token, body, method = "POST") =>
    handler(
      new Request(`https://preview.example${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const grant = async (account, name = "acme") => {
    const response = await call("/api/tunnel/grants", account, { name });
    return {
      status: response.status,
      body: response.status === 200 ? await response.json() : null,
    };
  };
  const createSession = async (grantToken, name = "acme") => {
    const response = await call("/api/sessions", grantToken, { name });
    return {
      status: response.status,
      body: response.status === 200 ? await response.json() : await response.text(),
    };
  };
  const stop = (session) => call(`/api/sessions/${session.id}`, session.token, undefined, "DELETE");
  return { store, handler, grant, createSession, stop };
}

test("another account cannot get a grant or session for a name that is held", async () => {
  const f = fixture({ nameReservationMs: 200 });
  const aliceGrant = await f.grant("alice");
  // Mallory asks for her grant before Alice claims, so only the claim can stop her.
  const malloryGrant = await f.grant("mallory");
  const alice = await f.createSession(aliceGrant.body.token);
  assert.equal(alice.status, 200);

  assert.equal((await f.grant("mallory")).status, 409);
  assert.equal((await f.grant("alice")).status, 200);
  // The relay asks this before a claim: another account is refused, while the
  // owner switching transports is not.
  assert.equal(await f.handler.isPreviewNameClaimed("acme", "device:mallory"), true);
  assert.equal(await f.handler.isPreviewNameClaimed("acme"), true);
  assert.equal(await f.handler.isPreviewNameClaimed("acme", "device:alice"), false);
  const taken = await f.createSession(malloryGrant.body.token);
  assert.equal(taken.status, 409);
  assert.match(taken.body, /already active/);
  assert.equal((await f.store.getSessionByName("acme")).ownerId, "device:alice");
});

test("a stopped name stays bound to its owner for the reservation window", async () => {
  const f = fixture({ nameReservationMs: 200 });
  const aliceGrant = await f.grant("alice");
  const malloryGrant = await f.grant("mallory");
  const first = await f.createSession(aliceGrant.body.token);
  assert.equal((await f.stop(first.body)).status, 200);

  // Another account cannot take the name right after the owner disconnects.
  assert.equal((await f.createSession(malloryGrant.body.token)).status, 409);
  assert.equal((await f.grant("mallory")).status, 409);
  assert.equal(await f.handler.isPreviewNameClaimed("acme", "device:mallory"), true);
  assert.equal(await f.handler.isPreviewNameClaimed("acme", "device:alice"), false);

  // The owner reconnects inside the window.
  const reconnected = await f.createSession(aliceGrant.body.token);
  assert.equal(reconnected.status, 200);
  assert.equal((await f.stop(reconnected.body)).status, 200);

  // Once the window passes, the name is free for anyone.
  await delay(260);
  assert.equal(await f.handler.isPreviewNameClaimed("acme", "device:mallory"), false);
  const mallory = await f.createSession(malloryGrant.body.token);
  assert.equal(mallory.status, 200);
  assert.equal((await f.store.getSessionByName("acme")).ownerId, "device:mallory");
});

test("a session that stopped heartbeating is not taken over by another account until the window passes", async () => {
  const f = fixture({ clientHeartbeatTimeoutMs: 40, nameReservationMs: 200 });
  const aliceGrant = await f.grant("alice");
  const malloryGrant = await f.grant("mallory");
  assert.equal((await f.createSession(aliceGrant.body.token)).status, 200);

  await delay(80);
  // Stale, so a visitor's request cleans it up; the name stays reserved.
  const visit = await f.handler(new Request("https://preview.example/__preview/acme/"));
  assert.equal(visit.status, 404);
  assert.equal((await f.createSession(malloryGrant.body.token)).status, 409);
  assert.equal((await f.createSession(aliceGrant.body.token)).status, 200);
});

test("a name the relay holds gets no polling session or grant, and the check fails closed", async () => {
  const asked = [];
  let relayAnswer = true;
  const f = fixture({
    isPreviewNameClaimed: async (name, ownerId) => {
      asked.push([name, ownerId]);
      if (relayAnswer === "throw") throw new Error("coordinator down");
      return relayAnswer;
    },
  });
  // Grants are requested before the relay claim is visible to the gateway.
  relayAnswer = false;
  const malloryGrant = await f.grant("mallory");
  relayAnswer = true;

  assert.equal((await f.grant("mallory")).status, 409);
  const refused = await f.createSession(malloryGrant.body.token);
  assert.equal(refused.status, 409);
  assert.deepEqual(asked.at(-1), ["acme", "device:mallory"]);
  // The losing claim leaves nothing behind that public traffic could reach.
  assert.equal(await f.store.getSessionByName("acme"), undefined);

  relayAnswer = "throw";
  assert.equal((await f.createSession(malloryGrant.body.token)).status, 503);
  assert.equal(await f.store.getSessionByName("acme"), undefined);
  assert.equal((await f.grant("mallory")).status, 503);

  relayAnswer = false;
  assert.equal((await f.createSession(malloryGrant.body.token)).status, 200);
});
