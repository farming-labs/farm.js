import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreviewGatewayHandler,
  MemoryPreviewGatewayStore,
  verifyPreviewTunnelGrant,
} from "../dist/index.js";
const signingSecret = "fixture-signing-secret-at-least-32-bytes-long";
function fixture(resolve, rateLimitExchange) {
  const sessions = [];
  const store = new MemoryPreviewGatewayStore();
  const handler = createPreviewGatewayHandler({
    store,
    auth: {
      signingSecret,
      rateLimitExchange,
      dashboardUrl: "https://infra.example.com/dashboard/previews",
      deviceAuth: {
        issuer: "https://infra.example.com/api/auth",
        clientId: "farm-preview",
        authorizeAccount: resolve,
      },
    },
    observer: { session: (event) => sessions.push(event) },
  });
  const grant = (token, input = {}) =>
    handler(
      new Request("https://preview.example.com/api/tunnel/grants", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "docs", expiresInMs: 7200_000, ...input }),
      }),
    );
  return { handler, grant, store, sessions };
}
test("validates Infra credentials per grant and attributes sessions from verified claims", async () => {
  let valid = true;
  const expiresAt = Date.now() + 3600_000;
  const f = fixture(async (token) =>
    valid && token === "api-key"
      ? { subject: "owner-1", login: "Owner", expiresAt, keyId: "key_verified" }
      : null,
  );
  const config = await (
    await f.handler(new Request("https://preview.example.com/api/auth/config"))
  ).json();
  assert.equal(config.provider, "device");
  assert.equal(config.clientId, "farm-preview");
  assert.ok(!JSON.stringify(config).includes(signingSecret));
  const grant = await (await f.grant("api-key", { project: "my-app", keyId: "spoofed" })).json();
  assert.equal(grant.expiresAt, expiresAt);
  const claims = verifyPreviewTunnelGrant(grant.token, { signingSecret, name: "docs" });
  assert.equal(claims.provider, "device");
  assert.equal(claims.subject, "owner-1");
  assert.equal(claims.project, "my-app");
  assert.equal(claims.keyId, "key_verified");
  const session = await f.handler(
    new Request("https://preview.example.com/api/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${grant.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: "docs",
        ownerId: "attacker",
        project: "spoofed",
        keyId: "spoofed",
      }),
    }),
  );
  assert.equal(session.status, 200);
  assert.equal(f.sessions[0].ownerId, "device:owner-1");
  assert.equal(f.sessions[0].project, "my-app");
  assert.equal(f.sessions[0].keyId, "key_verified");
  for (const project of ["../app", "APP", "", "x".repeat(64), {}])
    assert.equal((await f.grant("api-key", { project })).status, 400);
  assert.ok(!JSON.stringify(f.sessions).includes(grant.token));
  valid = false;
  assert.equal((await f.grant("api-key")).status, 401);
});
test("identity service errors fail closed without leaking provider errors", async () => {
  const f = fixture(async () => {
    throw new Error("secret provider details");
  });
  const response = await f.grant("api-key");
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("secret provider details"));
});

test("device grants honor the shared limiter before verifying credentials", async () => {
  let verifications = 0;
  const f = fixture(
    async () => {
      verifications++;
      return { subject: "owner", login: "Owner" };
    },
    () => ({ allowed: false, retryAfterMs: 1500 }),
  );
  const response = await f.grant("api-key");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal(verifications, 0);
});
