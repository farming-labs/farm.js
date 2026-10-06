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
  assert.equal((await poll).status, 403);
  assert.equal((await f.handler(new Request(session.publicUrl))).status, 403);
  assert.equal(
    (await f.call(`/api/sessions/${session.id}/heartbeat`, session.token, {})).status,
    403,
  );
  assert.equal(
    (await f.call(`/api/sessions/${session.id}`, session.token, undefined, "DELETE")).status,
    200,
  );
  assert.equal((await f.call("/api/sessions", grant.token, { name: "store" })).status, 403);
});

test("access authority failure fails closed and hides provider details", async () => {
  const f = fixture(async () => {
    throw new Error("private authority detail");
  });
  const grant = await (await f.call("/api/tunnel/grants", "key", { name: "store" })).json();
  const response = await f.call("/api/sessions", grant.token, { name: "store" });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("private authority detail"));
});
