import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
const cli = createRequire(import.meta.url)("../dist/index.js");
const { previewCredentialFromEnvironment } = cli;
// preview.example.com stands for a gateway the developer runs, so it is trusted explicitly.
const authorizePreviewGatewayPlan = (plan, options) =>
  cli.authorizePreviewGatewayPlan(plan, { trustGateway: true, ...options });
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
  // Retry-After seconds for each rate-limited poll before the usual replies (0 = no header).
  const rateLimited = [...(options.rateLimited ?? [])];
  // Replies returned, in order, before the usual ones (outages, proxies, gateways).
  const pollReplies = [...(options.pollReplies ?? [])];
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
    async confirm() {
      return true;
    },
    async chooseProject() {
      return undefined;
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
        if (pollReplies.length) return pollReplies.shift()();
        if (rateLimited.length) {
          const seconds = rateLimited.shift();
          return Response.json(
            { message: "Too many requests" },
            { status: 429, headers: seconds ? { "retry-after": String(seconds) } : {} },
          );
        }
        const error = options.failure || ["authorization_pending", "slow_down"][polling++];
        if (error) return Response.json({ error }, { status: 400 });
        return Response.json({ access_token: "device-session", expires_in: 86400 });
      }
      if (url.endsWith("/api/previews/key"))
        return Response.json({ key: "farmjs_cli_key_fixture" }, { status: 201 });
      if (url.endsWith("/api/tunnel/grants"))
        return options.reject
          ? Response.json({ error: "unauthorized" }, { status: 401 })
          : Response.json({ token: "scoped-grant", expiresAt: Date.now() + 3600_000 });
      throw new Error(`Unexpected URL ${url}`);
    },
  };
  return { runtime, calls, waits, opened, saved };
}
test("Farm.js Infrastructure device sign-in handles pending/slow-down and returns dashboard after approval", async () => {
  const f = fixture();
  const result = await authorizePreviewGatewayPlan(plan, { runtime: f.runtime, forceLogin: true });
  assert.deepEqual(f.waits, [5000, 5000, 10000]);
  // The approved sign-in becomes an API key; only the key is saved and sent.
  assert.deepEqual(f.saved, ["farmjs_cli_key_fixture"]);
  assert.equal(result.relayToken, "scoped-grant");
  assert.equal(result.dashboardUrl, "https://infra.example.com/dashboard/previews");
  assert.equal(result.expiresInMs, 7200_000);
  assert.equal(f.calls.at(-1).init.headers.authorization, "Bearer farmjs_cli_key_fixture");
  assert.ok(!JSON.stringify(result).includes("device-session"));
  assert.ok(!JSON.stringify(result).includes("farmjs_cli_key_fixture"));
});
test("a rate-limited poll waits as Infrastructure asks and keeps waiting for approval", async () => {
  // Infra counts every poll while someone takes their time approving. A 429 must not end
  // a sign-in the person may be confirming right now.
  const f = fixture({ rateLimited: [12, 0] });
  await authorizePreviewGatewayPlan(plan, { runtime: f.runtime, forceLogin: true });
  assert.deepEqual(f.waits, [5000, 12000, 5000, 5000, 5000, 5000, 10000]);
  assert.deepEqual(f.saved, ["farmjs_cli_key_fixture"]);
});

test("a 5xx or unreadable poll keeps waiting for approval instead of failing sign-in", async () => {
  const f = fixture({
    pollReplies: [
      () => new Response("upstream unavailable", { status: 503 }),
      () => new Response("<html>Bad gateway</html>", { status: 502 }),
      () => Response.json({ error: "internal" }, { status: 500 }),
      () => new Response("<html>ok</html>", { status: 200 }),
    ],
  });
  await authorizePreviewGatewayPlan(plan, { runtime: f.runtime, forceLogin: true });
  assert.deepEqual(f.waits, [5000, 5000, 5000, 5000, 5000, 5000, 10000]);
  assert.deepEqual(f.saved, ["farmjs_cli_key_fixture"]);

  // A client error that isn't JSON is still an answer, not an outage.
  const notFound = fixture({
    pollReplies: [() => new Response("<html>Not found</html>", { status: 404 })],
  });
  await assert.rejects(
    authorizePreviewGatewayPlan(plan, { runtime: notFound.runtime, forceLogin: true }),
    /sign-in failed \(404\)/,
  );
});

test("Farm.js Infrastructure API keys skip browser approval in CI and do not get persisted", async () => {
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

async function withEnv(values, run) {
  const names = ["FARMJS_API_KEY", "FARMJS_API_URL", "FARM_PREVIEW_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("FARMJS_API_KEY signs previews in without a browser on its own Infrastructure", async () => {
  await withEnv(
    { FARMJS_API_KEY: "farmjs_fixture_key", FARMJS_API_URL: "https://infra.example.com" },
    async () => {
      for (const interactive of [true, false]) {
        const f = fixture({ interactive });
        const result = await authorizePreviewGatewayPlan(plan, {
          runtime: f.runtime,
          expiresInMs: 60000,
        });
        assert.equal(f.opened.length, 0);
        assert.equal(f.saved.length, 0);
        assert.equal(f.calls.at(-1).init.headers.authorization, "Bearer farmjs_fixture_key");
        assert.equal(result.relayToken, "scoped-grant");
      }
      const rejected = fixture({ reject: true, interactive: false });
      await assert.rejects(
        authorizePreviewGatewayPlan(plan, { runtime: rejected.runtime, expiresInMs: 60000 }),
        /FARMJS_API_KEY was rejected/,
      );
      assert.equal(rejected.opened.length, 0);
    },
  );
});

test("FARMJS_API_KEY never goes to a GitHub sign-in gateway or another Infrastructure", async () => {
  for (const [env, config] of [
    // The hosted gateway still signs in with GitHub, which has no idea what an API key is.
    [{ FARMJS_API_KEY: "farmjs_fixture_key" }, { provider: "github", issuer: undefined }],
    // An API key belongs to one installation; the default is https://app.farmjs.dev.
    [{ FARMJS_API_KEY: "farmjs_fixture_key" }, {}],
    [{ FARMJS_API_KEY: "farmjs_fixture_key", FARMJS_API_URL: "https://other.example.com" }, {}],
  ]) {
    await withEnv(env, async () => {
      const f = fixture({ cached: "saved-login", config });
      await authorizePreviewGatewayPlan(plan, { runtime: f.runtime, expiresInMs: 60000 });
      assert.equal(f.calls.at(-1).init.headers.authorization, "Bearer saved-login");
      assert.ok(!f.calls.some(({ init }) => JSON.stringify(init).includes("farmjs_fixture_key")));
    });
  }
});

test("FARM_PREVIEW_TOKEN still works, deprecated, and can't disagree with FARMJS_API_KEY", () => {
  const infra = { provider: "device", issuer: "https://app.farmjs.dev/api/auth" };
  const warnings = [];
  const warn = (message) => warnings.push(message);
  assert.deepEqual(
    previewCredentialFromEnvironment(infra, { FARMJS_API_KEY: " farmjs_k " }, warn),
    {
      token: "farmjs_k",
      source: "FARMJS_API_KEY",
    },
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    previewCredentialFromEnvironment(infra, { FARM_PREVIEW_TOKEN: "legacy" }, warn),
    {
      token: "legacy",
      source: "FARM_PREVIEW_TOKEN",
    },
  );
  assert.match(warnings[0], /FARM_PREVIEW_TOKEN is deprecated\. Set FARMJS_API_KEY/);
  // A GitHub sign-in gateway has no API-key replacement to point to.
  const github = { provider: "github" };
  assert.equal(
    previewCredentialFromEnvironment(github, { FARM_PREVIEW_TOKEN: "legacy" }, warn).token,
    "legacy",
  );
  assert.equal(warnings.length, 1);
  assert.equal(
    previewCredentialFromEnvironment(github, { FARMJS_API_KEY: "farmjs_k" }, warn),
    undefined,
  );
  // The same value in both is fine; different values are ambiguous.
  assert.equal(
    previewCredentialFromEnvironment(
      infra,
      { FARMJS_API_KEY: "farmjs_k", FARM_PREVIEW_TOKEN: "farmjs_k" },
      warn,
    ).source,
    "FARMJS_API_KEY",
  );
  assert.throws(
    () =>
      previewCredentialFromEnvironment(
        infra,
        { FARMJS_API_KEY: "farmjs_k", FARM_PREVIEW_TOKEN: "other" },
        warn,
      ),
    /Unset FARM_PREVIEW_TOKEN/,
  );
});

test("the CI error only suggests an API key where the gateway accepts one", async () => {
  await withEnv({}, async () => {
    const infra = fixture({ interactive: false });
    await assert.rejects(
      authorizePreviewGatewayPlan(plan, { runtime: infra.runtime }),
      /Set FARMJS_API_KEY to a Farm\.js Infrastructure API key/,
    );
    const github = fixture({
      interactive: false,
      config: { provider: "github", issuer: undefined },
    });
    await assert.rejects(
      authorizePreviewGatewayPlan(plan, { runtime: github.runtime }),
      (error) =>
        /only supports browser sign-in/.test(error.message) && !/API key/.test(error.message),
    );
  });
});

/** A gateway on this machine that says it signs in through the hosted Infrastructure. */
async function startClaimingGateway() {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push(`${request.url} ${JSON.stringify(request.headers)} ${body}`);
    const json = { "content-type": "application/json" };
    if (request.url === "/api/auth/config")
      return response.writeHead(200, json).end(
        JSON.stringify({
          enabled: true,
          provider: "device",
          issuer: "https://app.farmjs.dev/api/auth",
          clientId: "farm-preview",
          defaultSessionTtlMs: 3600_000,
          maxSessionTtlMs: 86400_000,
        }),
      );
    if (request.url === "/api/tunnel/grants")
      return response
        .writeHead(200, json)
        .end(JSON.stringify({ token: "scoped-grant", expiresAt: Date.now() + 3600_000 }));
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `http://127.0.0.1:${server.address().port}`;
  const saved = new Map();
  const runtime = (interactive) => ({
    interactive,
    // Only the local gateway may be reached; a sign-in would have to go elsewhere.
    async fetch(url, init) {
      if (!String(url).startsWith(gatewayUrl)) throw new Error(`Unexpected request to ${url}`);
      return fetch(url, init);
    },
    credentials: {
      async get(url) {
        return saved.get(url);
      },
      async set(url, value) {
        saved.set(url, value);
      },
      async delete(url) {
        saved.delete(url);
      },
    },
    async openBrowser() {
      return true;
    },
    async wait() {},
    async promptDuration() {
      return undefined;
    },
    async confirm() {
      return true;
    },
  });
  return {
    server,
    received,
    runtime,
    plan: { ...plan, gatewayUrl, relayUrl: `ws://127.0.0.1:${server.address().port}/agent` },
  };
}

test("a gateway that only claims to use Farm.js Infrastructure never receives FARMJS_API_KEY", async () => {
  const gateway = await startClaimingGateway();
  try {
    await withEnv({ FARMJS_API_KEY: "farmjs_fixture_key" }, async () => {
      for (const interactive of [false, true]) {
        await assert.rejects(
          cli.authorizePreviewGatewayPlan(gateway.plan, {
            runtime: gateway.runtime(interactive),
            expiresInMs: 60000,
          }),
          /isn't the hosted Farm Preview gateway \(https:\/\/preview\.farmjs\.dev\).*pass --trust-gateway/,
        );
      }
      assert.ok(gateway.received.length > 0);
      assert.ok(!gateway.received.some((entry) => entry.includes("farmjs_fixture_key")));

      // The developer runs this gateway and says so: now it gets the key.
      const result = await cli.authorizePreviewGatewayPlan(gateway.plan, {
        runtime: gateway.runtime(false),
        expiresInMs: 60000,
        trustGateway: true,
      });
      assert.equal(result.relayToken, "scoped-grant");
      assert.match(gateway.received.at(-1), /Bearer farmjs_fixture_key/);
    });
  } finally {
    gateway.server.close();
  }
});

test("the hosted gateway gets FARMJS_API_KEY without opting in, and a saved key stays with its gateway", async () => {
  const hosted = {
    ...plan,
    gatewayUrl: "https://preview.farmjs.dev",
    relayUrl: "wss://preview.farmjs.dev/agent",
  };
  await withEnv({ FARMJS_API_KEY: "farmjs_fixture_key" }, async () => {
    const f = fixture({
      interactive: false,
      config: { issuer: "https://app.farmjs.dev/api/auth" },
    });
    await cli.authorizePreviewGatewayPlan(hosted, { runtime: f.runtime, expiresInMs: 60000 });
    assert.equal(f.calls.at(-1).url, "https://preview.farmjs.dev/api/tunnel/grants");
    assert.equal(f.calls.at(-1).init.headers.authorization, "Bearer farmjs_fixture_key");
    assert.equal(f.calls.at(-1).init.redirect, "error");

    // A key saved for a self-hosted gateway was made for it, so it is still sent there.
    const saved = fixture({
      interactive: false,
      cached: "farmjs_saved_for_gateway",
      config: { issuer: "https://app.farmjs.dev/api/auth" },
    });
    await cli.authorizePreviewGatewayPlan(plan, { runtime: saved.runtime, expiresInMs: 60000 });
    assert.equal(saved.calls.at(-1).init.headers.authorization, "Bearer farmjs_saved_for_gateway");
    assert.ok(!saved.calls.some(({ init }) => JSON.stringify(init).includes("farmjs_fixture_key")));
  });
});

test("farm login won't make a key for a gateway nobody vouched for", async () => {
  const f = fixture({ config: { issuer: "https://app.farmjs.dev/api/auth" } });
  await assert.rejects(
    cli.signInToPreviewGateway(plan.gatewayUrl, f.runtime),
    /pass --trust-gateway/,
  );
  assert.deepEqual(
    f.calls.map(({ url }) => url),
    ["https://preview.example.com/api/auth/config"],
  );
  assert.equal(f.saved.length, 0);
});

test("a gateway must use https unless it is on this machine", () => {
  const target = {
    localUrl: "http://localhost:3000",
    host: "localhost",
    port: 3000,
    source: "port",
  };
  assert.throws(
    () => cli.createPreviewGatewayPlan(target, { gatewayUrl: "http://preview.example.com" }),
    /must use https/,
  );
  for (const gatewayUrl of [
    "https://preview.example.com/",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "http://[::1]:8787",
  ]) {
    assert.equal(
      cli.createPreviewGatewayPlan(target, { gatewayUrl }).gatewayUrl,
      gatewayUrl.replace(/\/$/, ""),
    );
  }
});
