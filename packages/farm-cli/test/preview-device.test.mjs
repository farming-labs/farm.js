import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const { authorizePreviewGatewayPlan } = createRequire(import.meta.url)("../dist/index.js");
const plan = {
  provider: "farm-gateway",
  gatewayUrl: "https://preview.example.com",
  relayUrl: "wss://preview.example.com/agent",
  requestedName: "my-app",
  target: { localUrl: "http://localhost:3000", host: "localhost", port: 3000, source: "port" },
  requestedHostname: "my-app.preview.example.com",
  requestedPublicUrl: "https://my-app.preview.example.com",
};
function fixture(options = {}) {
  const calls = [],
    waits = [],
    opened = [],
    saved = [];
  let polling = 0;
  const config = {
    enabled: true,
    provider: "device",
    issuer: "https://infra.example.com/api/auth",
    clientId: "farm-preview",
    dashboardUrl: "https://infra.example.com/dashboard/previews",
    defaultSessionTtlMs: 3600_000,
    maxSessionTtlMs: 86400_000,
    ...options.config,
  };
  const runtime = {
    interactive: options.interactive ?? true,
    credentials: {
      async get() {
        return options.cached;
      },
      async set(_gateway, value) {
        saved.push(value);
      },
      async delete() {},
    },
    async openBrowser(url) {
      opened.push(url);
      return true;
    },
    async promptDuration() {
      assert.ok(options.cached || saved.length);
      return 7200_000;
    },
    async wait(ms) {
      waits.push(ms);
    },
    async fetch(url, init = {}) {
      calls.push({ url, init });
      if (url.endsWith("/api/auth/config")) return Response.json(config);
      if (url.endsWith("/device/code"))
        return Response.json({
          device_code: "private-device-code",
          user_code: "ABCD1234",
          verification_uri: "https://infra.example.com/device",
          verification_uri_complete:
            options.browserUrl || "https://infra.example.com/device?user_code=ABCD1234",
          expires_in: 600,
          interval: 5,
        });
      if (url.endsWith("/device/token")) {
        const error = options.failure || ["authorization_pending", "slow_down"][polling++];
        if (error) return Response.json({ error }, { status: 400 });
        return Response.json({ access_token: "device-session", expires_in: 86400 });
      }
      if (url.endsWith("/api/tunnel/grants"))
        return options.reject
          ? Response.json({ error: "unauthorized" }, { status: 401 })
          : Response.json({ token: "scoped-grant", expiresAt: Date.now() + 3600_000 });
      throw new Error(`Unexpected URL ${url}`);
    },
  };
  return { runtime, calls, waits, opened, saved };
}
test("Farm Infra device sign-in handles pending/slow-down and returns dashboard after approval", async () => {
  const f = fixture();
  const result = await authorizePreviewGatewayPlan(plan, { runtime: f.runtime, forceLogin: true });
  assert.deepEqual(f.waits, [5000, 5000, 10000]);
  assert.deepEqual(f.saved, ["device-session"]);
  assert.equal(result.relayToken, "scoped-grant");
  assert.equal(result.dashboardUrl, "https://infra.example.com/dashboard/previews");
  assert.equal(result.expiresInMs, 7200_000);
  assert.equal(f.calls.at(-1).init.headers.authorization, "Bearer device-session");
  assert.ok(!JSON.stringify(result).includes("device-session"));
});
test("Farm Infra API keys skip browser approval in CI and do not get persisted", async () => {
  const previous = process.env.FARM_PREVIEW_TOKEN;
  process.env.FARM_PREVIEW_TOKEN = "farmjs_fixture_key";
  try {
    const f = fixture({ interactive: false });
    const result = await authorizePreviewGatewayPlan(plan, {
      runtime: f.runtime,
      expiresInMs: 60000,
    });
    assert.equal(f.opened.length, 0);
    assert.equal(f.saved.length, 0);
    assert.equal(f.calls.at(-1).init.headers.authorization, "Bearer farmjs_fixture_key");
    assert.equal(result.expiresInMs, 60000);
    const rejected = fixture({ reject: true, interactive: false });
    await assert.rejects(
      authorizePreviewGatewayPlan(plan, { runtime: rejected.runtime, expiresInMs: 60000 }),
      /FARM_PREVIEW_TOKEN was rejected/,
    );
    assert.equal(rejected.opened.length, 0);
  } finally {
    if (previous === undefined) delete process.env.FARM_PREVIEW_TOKEN;
    else process.env.FARM_PREVIEW_TOKEN = previous;
  }
});
test("missing CI credentials, denied/expired codes and off-origin verification URLs fail clearly", async () => {
  const ci = fixture({ interactive: false });
  await assert.rejects(
    authorizePreviewGatewayPlan(plan, { runtime: ci.runtime, forceLogin: true }),
    /non-interactive/,
  );
  assert.equal(ci.opened.length, 0);
  for (const [failure, expected] of [
    ["access_denied", /declined/],
    ["expired_token", /expired/],
  ]) {
    const f = fixture({ failure });
    await assert.rejects(
      authorizePreviewGatewayPlan(plan, { runtime: f.runtime, forceLogin: true }),
      expected,
    );
    assert.equal(f.saved.length, 0);
  }
  for (const browserUrl of [
    "https://evil.example/device",
    "javascript:alert(1)",
    "https://u:p@infra.example.com/device",
  ]) {
    const f = fixture({ browserUrl });
    await assert.rejects(
      authorizePreviewGatewayPlan(plan, { runtime: f.runtime, forceLogin: true }),
      /unsafe/,
    );
    assert.equal(f.opened.length, 0);
  }
});
