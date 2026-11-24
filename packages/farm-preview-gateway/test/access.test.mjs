import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewGatewayHandler, MemoryPreviewGatewayStore } from "../dist/index.js";

const signingSecret = "fixture-signing-secret-with-at-least-32-bytes";
function fixture(authorizeSession, identity = {}) {
  const store = new MemoryPreviewGatewayStore();
  const handler = createPreviewGatewayHandler({
    store,
    authorizeSession,
    pollIntervalMs: 1,
    auth: {
      signingSecret,
      deviceAuth: {
        issuer: "https://infra.example",
        clientId: "farm-preview",
        authorizeAccount: async () => ({
          subject: "owner",
          login: "Owner",
          keyId: "key_ci",
          ...identity,
        }),
      },
    },
  });
  const call = (path, token, body, method = "POST") =>
    handler(
      new Request(`https://preview.example${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { store, handler, call };
}

test("project-scoped credentials cannot request another project, and grants cap expiry", async () => {
  const expiresAt = Date.now() + 90_000;
  const f = fixture(undefined, { project: "store", expiresAt });
  assert.equal(
    (await f.call("/api/tunnel/grants", "key", { name: "docs", project: "docs" })).status,
    403,
  );
  const grant = await f.call("/api/tunnel/grants", "key", { name: "docs", project: "store" });
  assert.equal(grant.status, 200);
  assert.equal((await grant.json()).expiresAt, expiresAt);
});

test("revocation blocks polling traffic, queued delivery, and grant replay; cleanup stays available", async () => {
  let allowed = true;
  const seen = [];
  const f = fixture(async (access) => {
    seen.push(access);
    return allowed;
  });
  const grant = await (await f.call("/api/tunnel/grants", "key", { name: "store" })).json();
  const session = await (await f.call("/api/sessions", grant.token, { name: "store" })).json();
  assert.ok(seen[0].grantId);
  assert.equal(seen[0].ownerId, "device:owner");
  assert.equal(seen[0].token, undefined);
  const poll = f.call(
    `/api/sessions/${session.id}/requests?wait=1000`,
    session.token,
    undefined,
    "GET",
  );
  allowed = false;
  await f.store.enqueueRequest(
    session.id,
    { id: "queued", method: "GET", path: "/", headers: {}, createdAt: Date.now() },
    60_000,
  );
  // The CLI learns why its preview ended.
  const denied = await poll;
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /no longer authorized/);
  // The session is released: its address answers like a preview that isn't running.
  const visitor = await f.handler(new Request(session.publicUrl));
  assert.equal(visitor.status, 404);
  assert.match(await visitor.text(), /No active Farm preview is running for "store"/);
  assert.equal(await f.store.getSessionByName("store"), undefined);
  const heartbeat = await f.call(`/api/sessions/${session.id}/heartbeat`, session.token, {});
  assert.equal(heartbeat.status, 401);
  assert.match(await heartbeat.text(), /ended/);
  // The CLI's cleanup on exit still succeeds.
  assert.equal(
    (await f.call(`/api/sessions/${session.id}`, session.token, undefined, "DELETE")).status,
    200,
  );
  assert.equal((await f.call("/api/sessions", grant.token, { name: "store" })).status, 403);
});

test("a stopped preview frees its name for its owner's next preview, not for anyone else", async () => {
  const revoked = new Set();
  const f = fixture(async (access) => !revoked.has(access.grantId));
  const first = await (await f.call("/api/tunnel/grants", "key", { name: "store" })).json();
  const session = await (await f.call("/api/sessions", first.token, { name: "store" })).json();
  revoked.add((await f.store.getSessionById(session.id)).grantId);
  // The first visitor after the stop releases the session.
  assert.equal((await f.handler(new Request(session.publicUrl))).status, 404);

  // Another account can't take a name that was just in use.
  const stranger = createPreviewGatewayHandler({
    store: f.store,
    authorizeSession: async () => true,
    pollIntervalMs: 1,
    auth: {
      signingSecret,
      deviceAuth: {
        issuer: "https://infra.example",
        clientId: "farm-preview",
        authorizeAccount: async () => ({ subject: "someone-else", login: "Other" }),
      },
    },
  });
  const theirs = (path, token, body) =>
    stranger(
      new Request(`https://preview.example${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const strangerGrant = await theirs("/api/tunnel/grants", "key", { name: "store" });
  assert.equal(strangerGrant.status, 409);

  // The owner starts again right away under the same name, with a new grant.
  const second = await (await f.call("/api/tunnel/grants", "key", { name: "store" })).json();
  const restarted = await f.call("/api/sessions", second.token, { name: "store" });
  assert.equal(restarted.status, 200);
  assert.equal((await restarted.json()).name, "store");
});
