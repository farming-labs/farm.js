import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
// previewFarm loads the native package dynamically. Keep its ordinary behavior
// for every test except the one high-level result-boundary fixture below.
let nativeTunnel;
let nativeTunnelRuntimeOverride;
try {
  nativeTunnel = require("@farm.js/tunnel");
  const originals = {
    startPreviewAgent: nativeTunnel.startPreviewAgent,
    stopPreviewAgent: nativeTunnel.stopPreviewAgent,
    waitPreviewAgent: nativeTunnel.waitPreviewAgent,
  };
  nativeTunnel.startPreviewAgent = (...args) =>
    (nativeTunnelRuntimeOverride || originals).startPreviewAgent(...args);
  nativeTunnel.stopPreviewAgent = (...args) =>
    (nativeTunnelRuntimeOverride || originals).stopPreviewAgent(...args);
  nativeTunnel.waitPreviewAgent = (...args) =>
    (nativeTunnelRuntimeOverride || originals).waitPreviewAgent(...args);
} catch {
  // The optional native package intentionally falls back to gateway polling.
}
const {
  authorizePreviewGatewayPlan,
  createPreviewGatewayPlan,
  createPreviewTunnelPlan,
  forwardGatewayRequest,
  loadPreviewAuthConfig,
  parsePreviewPublicUrl,
  parsePreviewDuration,
  previewFarm,
  resolvePreviewTarget,
  runNativePreviewTunnel,
  runPreviewGateway,
  runPreviewTunnel,
} = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("parses public preview urls from tunnel output", () => {
  assert.equal(
    parsePreviewPublicUrl("your url is: https://stripe-demo.preview.farmjs.dev"),
    "https://stripe-demo.preview.farmjs.dev",
  );
  assert.equal(
    parsePreviewPublicUrl(
      "docs: https://developers.cloudflare.com\nready: https://stripe-demo.preview.farmjs.dev",
      "stripe-demo.preview.farmjs.dev",
    ),
    "https://stripe-demo.preview.farmjs.dev",
  );
  assert.equal(
    parsePreviewPublicUrl("legacy: https://stripe-demo.preview.farming-labs.dev"),
    "https://stripe-demo.preview.farming-labs.dev",
  );
  assert.equal(
    parsePreviewPublicUrl("docs: https://example.com\nready: https://stripe-demo.loca.lt"),
    "https://stripe-demo.loca.lt",
  );
});

test("parses explicit preview expiry durations", () => {
  assert.equal(parsePreviewDuration("30m"), 30 * 60 * 1000);
  assert.equal(parsePreviewDuration("2h"), 2 * 60 * 60 * 1000);
  assert.equal(parsePreviewDuration("1d"), 24 * 60 * 60 * 1000);
  assert.throws(() => parsePreviewDuration("90"), /minutes, hours, or days/);
  assert.throws(() => parsePreviewDuration("0h"), /outside the supported range/);
});

test("keeps working while a pre-auth preview gateway is being upgraded", async () => {
  const config = await loadPreviewAuthConfig("https://preview.example.com", async () =>
    Response.json({
      ok: true,
      message: "Farm Preview Gateway",
      createSession: "/api/sessions",
      health: "/api/health",
    }),
  );

  assert.deepEqual(config, {
    enabled: false,
    controlAuth: "query",
    defaultSessionTtlMs: 30 * 60 * 1000,
    maxSessionTtlMs: 30 * 60 * 1000,
  });
});

test("uses a sliding session when a pre-auth gateway has no explicit expiry", async () => {
  let prompted = false;
  const plan = {
    provider: "farm-gateway",
    gatewayUrl: "https://preview.example.com",
    relayUrl: "wss://preview.example.com/agent",
    target: { localUrl: "http://localhost:3000", host: "localhost", port: 3000, source: "port" },
    requestedName: "sliding",
    requestedHostname: "sliding.preview.example.com",
    requestedPublicUrl: "https://sliding.preview.example.com",
  };
  const runtime = {
    fetch: async () => new Response(null, { status: 404 }),
    async openBrowser() {
      return false;
    },
    async wait() {},
    credentials: {
      async get() {},
      async set() {},
      async delete() {},
    },
    async promptDuration() {
      prompted = true;
      return 60_000;
    },
  };

  const authorized = await authorizePreviewGatewayPlan(plan, { runtime });
  assert.equal(authorized.expiresInMs, undefined);
  assert.equal(prompted, false);
  assert.equal(
    (await authorizePreviewGatewayPlan(plan, { runtime, expiresInMs: 120_000 })).expiresInMs,
    120_000,
  );
});

test("returns to the CLI after first-run device login with a scoped tunnel grant", async () => {
  const calls = [];
  let savedCredential;
  const plan = {
    provider: "farm-gateway",
    gatewayUrl: "https://preview.example.com",
    relayUrl: "wss://preview.example.com/agent",
    target: {
      localUrl: "http://localhost:3000",
      host: "localhost",
      port: 3000,
      source: "port",
    },
    requestedName: "first-preview",
    requestedHostname: "first-preview.preview.example.com",
    requestedPublicUrl: "https://first-preview.preview.example.com",
  };
  const runtime = {
    async fetch(url, init = {}) {
      calls.push({ url, init });
      if (url.endsWith("/api/auth/config")) {
        return Response.json({
          enabled: true,
          provider: "github",
          clientId: "github-client",
          scope: "read:user",
          defaultSessionTtlMs: 3_600_000,
          maxSessionTtlMs: 86_400_000,
        });
      }
      if (url === "https://github.com/login/device/code") {
        return Response.json({
          device_code: "device-secret",
          user_code: "FARM-CODE",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=FARM-CODE",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "github-access-token" });
      }
      if (url.endsWith("/api/auth/exchange")) {
        return Response.json({
          token: "farm-account-token",
          expiresAt: Date.now() + 86_400_000,
          user: { login: "farm-user" },
        });
      }
      if (url.endsWith("/api/tunnel/grants")) {
        assert.equal(init.headers.authorization, "Bearer farm-account-token");
        assert.deepEqual(JSON.parse(init.body), {
          name: "first-preview",
          expiresInMs: 7_200_000,
        });
        return Response.json({ token: "single-preview-grant", expiresAt: Date.now() + 7_200_000 });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    async openBrowser(url) {
      assert.equal(url, "https://github.com/login/device?user_code=FARM-CODE");
      return true;
    },
    async wait() {},
    credentials: {
      async get() {
        return undefined;
      },
      async set(_gatewayUrl, token) {
        savedCredential = token;
      },
      async delete() {},
    },
    async promptDuration() {
      return 7_200_000;
    },
  };

  const authorized = await authorizePreviewGatewayPlan(plan, { runtime, forceLogin: true });
  assert.equal(savedCredential, "farm-account-token");
  assert.equal(authorized.controlAuth, "bearer");
  assert.equal(authorized.relayToken, "single-preview-grant");
  assert.equal(authorized.expiresInMs, 7_200_000);
  assert.ok(authorized.expiresAt > Date.now());
  assert.ok(calls.some((call) => call.url.endsWith("/api/auth/exchange")));
});

test("accepts server grants within clock skew and rejects older grants", async () => {
  const plan = {
    provider: "farm-gateway",
    gatewayUrl: "https://preview.example.com",
    relayUrl: "wss://preview.example.com/agent",
    target: { localUrl: "http://localhost:3000", host: "localhost", port: 3000, source: "port" },
    requestedName: "clock-skew",
    requestedHostname: "clock-skew.preview.example.com",
    requestedPublicUrl: "https://clock-skew.preview.example.com",
  };
  let serverExpiry = Date.now() - 60_000;
  const runtime = {
    async fetch(url) {
      if (url.endsWith("/api/auth/config")) {
        return Response.json({
          enabled: true,
          provider: "github",
          clientId: "github-client",
          defaultSessionTtlMs: 60_000,
          maxSessionTtlMs: 600_000,
        });
      }
      if (url.endsWith("/api/tunnel/grants")) {
        return Response.json({ token: "clock-skew-grant", expiresAt: serverExpiry });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    async openBrowser() {
      return false;
    },
    async wait() {},
    credentials: {
      async get() {
        return "stored-account-token";
      },
      async set() {},
      async delete() {},
    },
    async promptDuration() {
      return 60_000;
    },
  };

  const authorized = await authorizePreviewGatewayPlan(plan, { runtime });
  assert.equal(authorized.relayToken, "clock-skew-grant");
  assert.equal(authorized.expiresAt, serverExpiry);

  serverExpiry = Date.now() - 6 * 60_000;
  await assert.rejects(
    () => authorizePreviewGatewayPlan(plan, { runtime }),
    /Farm Preview returned an invalid tunnel grant\./,
  );
});

test("resolves a running local preview target", async () => {
  const server = await createTestServer();

  try {
    const target = await resolvePreviewTarget({
      port: server.port,
      timeoutMs: 1000,
    });

    assert.equal(target.localUrl, `http://localhost:${server.port}`);
    assert.equal(target.port, server.port);
    assert.equal(target.source, "port");
  } finally {
    await server.close();
  }
});

test("formats a bare IPv6 preview host as a valid local URL", async () => {
  const target = await resolvePreviewTarget({ host: "::1", port: 4321, noProbe: true });

  assert.equal(target.localUrl, "http://[::1]:4321");
  assert.equal(new URL(target.localUrl).hostname, "[::1]");
});

test("rejects invalid explicit preview targets", async () => {
  await assert.rejects(resolvePreviewTarget({ url: "ftp://127.0.0.1:21" }), /http or https/);
  await assert.rejects(resolvePreviewTarget({ url: "file:///tmp/farm" }), /http or https/);
  await assert.rejects(
    resolvePreviewTarget({ url: "http://user:secret@127.0.0.1:3000" }),
    /cannot include credentials/,
  );
  await assert.rejects(
    resolvePreviewTarget({ url: "http://127.0.0.1:3000/app?token=secret" }),
    /query string or fragment/,
  );
  await assert.rejects(resolvePreviewTarget({ port: "3000oops" }), /integer between 1 and 65535/);
  await assert.rejects(resolvePreviewTarget({ port: 0 }), /integer between 1 and 65535/);
});

test("normalizes a valid explicit preview URL", async () => {
  const target = await resolvePreviewTarget({ url: "  http://127.0.0.1:3000/app/  " });

  assert.equal(target.localUrl, "http://127.0.0.1:3000/app");
  assert.equal(target.host, "127.0.0.1");
  assert.equal(target.port, 3000);
});

test("creates a tunnel plan from the preview command template", () => {
  const previousCommand = process.env.FARM_PREVIEW_TUNNEL_COMMAND;
  const previousDomain = process.env.FARM_PREVIEW_DOMAIN;
  process.env.FARM_PREVIEW_TUNNEL_COMMAND =
    "farm-preview-agent tunnel --url {url} --hostname {hostname}";
  process.env.FARM_PREVIEW_DOMAIN = "preview.farmjs.dev";

  try {
    const plan = createPreviewTunnelPlan(
      {
        localUrl: "http://localhost:3000",
        host: "localhost",
        port: 3000,
        source: "port",
      },
      {
        name: "Stripe Webhook",
      },
    );

    assert.equal(plan.shell, true);
    assert.match(plan.command, /farm-preview-agent tunnel/);
    assert.match(plan.command, /"http:\/\/localhost:3000"/);
    assert.match(plan.command, /"stripe-webhook.preview.farmjs.dev"/);
  } finally {
    restoreEnv("FARM_PREVIEW_TUNNEL_COMMAND", previousCommand);
    restoreEnv("FARM_PREVIEW_DOMAIN", previousDomain);
  }
});

test("marks the npx localtunnel plan for Windows shell resolution", () => {
  const plan = createPreviewTunnelPlan(
    {
      localUrl: "http://localhost:3000",
      host: "localhost",
      port: 3000,
      source: "port",
    },
    { name: "Local Tunnel" },
  );

  if (plan.provider === "localtunnel") {
    assert.equal(plan.shell, process.platform === "win32");
  }
});

test("creates a managed gateway preview plan by default", () => {
  const previousGateway = process.env.FARM_PREVIEW_GATEWAY_URL;
  const previousDomain = process.env.FARM_PREVIEW_DOMAIN;
  process.env.FARM_PREVIEW_GATEWAY_URL = "https://preview.farmjs.dev";
  process.env.FARM_PREVIEW_DOMAIN = "preview.farmjs.dev";

  try {
    const plan = createPreviewGatewayPlan(
      {
        localUrl: "http://localhost:3000",
        host: "localhost",
        port: 3000,
        source: "port",
      },
      {
        name: "Stripe Webhook",
      },
    );

    assert.equal(plan.provider, "farm-gateway");
    assert.equal(plan.gatewayUrl, "https://preview.farmjs.dev");
    assert.equal(plan.relayUrl, "wss://preview.farmjs.dev/agent");
    assert.equal(plan.relayToken, undefined);
    assert.equal(plan.requestedPublicUrl, "https://stripe-webhook.preview.farmjs.dev");
  } finally {
    restoreEnv("FARM_PREVIEW_GATEWAY_URL", previousGateway);
    restoreEnv("FARM_PREVIEW_DOMAIN", previousDomain);
  }
});

test("carries a configured relay credential without putting it in the relay URL", async () => {
  const previousToken = process.env.FARM_PREVIEW_RELAY_TOKEN;
  process.env.FARM_PREVIEW_RELAY_TOKEN = "relay-secret";

  const target = {
    localUrl: "http://localhost:3000",
    host: "localhost",
    port: 3000,
    source: "port",
  };
  const calls = [];
  const runtime = {
    async startPreviewAgent(...args) {
      calls.push(args);
      return { sessionId: "native-session", publicUrl: "https://native.preview.example.com" };
    },
    async stopPreviewAgent() {
      return true;
    },
    async waitPreviewAgent() {
      return true;
    },
  };

  try {
    const plan = createPreviewGatewayPlan(target, { name: "credentialed" });
    assert.equal(plan.relayToken, "relay-secret");
    // The CLI prints plan.relayUrl, so the credential must not be on it.
    assert.ok(!plan.relayUrl.includes("relay-secret"));

    await runNativePreviewTunnel(plan, { runtime });
    assert.equal(
      calls[0][0],
      `${plan.relayUrl}?token=relay-secret`,
      "expected the native agent to receive the relay credential",
    );
  } finally {
    restoreEnv("FARM_PREVIEW_RELAY_TOKEN", previousToken);
  }
});

test("keeps relay credentials out of public preview results", async () => {
  const previousToken = process.env.FARM_PREVIEW_RELAY_TOKEN;
  process.env.FARM_PREVIEW_RELAY_TOKEN = "do-not-expose-this-relay-credential";

  try {
    const result = await previewFarm({
      provider: "farm",
      port: 3000,
      noProbe: true,
      dryRun: true,
      name: "redacted-result",
    });

    assert.equal("relayToken" in result.plan, false);
    assert.ok(!JSON.stringify(result).includes("do-not-expose-this-relay-credential"));
  } finally {
    restoreEnv("FARM_PREVIEW_RELAY_TOKEN", previousToken);
  }
});

test("keeps relay credentials out of native preview results", { skip: !nativeTunnel }, async () => {
  const gateway = await createPreviewGatewayTestServer();
  const previousRelay = process.env.FARM_PREVIEW_RELAY_URL;
  const previousToken = process.env.FARM_PREVIEW_RELAY_TOKEN;
  process.env.FARM_PREVIEW_RELAY_URL = "ws://native.preview.test/agent";
  process.env.FARM_PREVIEW_RELAY_TOKEN = "do-not-expose-native-relay-token";
  const calls = [];
  nativeTunnelRuntimeOverride = {
    async startPreviewAgent(...args) {
      calls.push(["start", ...args]);
      return {
        sessionId: "native-result-session",
        publicUrl: "https://native-result.preview.farmjs.dev",
      };
    },
    async stopPreviewAgent(sessionId) {
      calls.push(["stop", sessionId]);
      return true;
    },
    async waitPreviewAgent(sessionId) {
      calls.push(["wait", sessionId]);
      return true;
    },
  };

  try {
    const result = await previewFarm({
      provider: "farm",
      port: 3000,
      noProbe: true,
      gatewayUrl: gateway.url,
      name: "native-result",
    });

    assert.equal("relayToken" in result.plan, false);
    assert.ok(!JSON.stringify(result).includes("do-not-expose-native-relay-token"));
    assert.deepEqual(calls[0], [
      "start",
      "ws://native.preview.test/agent?token=do-not-expose-native-relay-token",
      "native-result",
      "http://localhost:3000",
    ]);
    assert.equal(result.session.sessionId, "native-result-session");
  } finally {
    nativeTunnelRuntimeOverride = undefined;
    restoreEnv("FARM_PREVIEW_RELAY_URL", previousRelay);
    restoreEnv("FARM_PREVIEW_RELAY_TOKEN", previousToken);
    await gateway.close();
  }
});

test("runs the managed preview through the native tunnel lifecycle", async () => {
  let resolveWait;
  const wait = new Promise((resolve) => {
    resolveWait = resolve;
  });
  const calls = [];
  const runtime = {
    async startPreviewAgent(...args) {
      calls.push(["start", ...args]);
      return {
        sessionId: "native-session",
        publicUrl: "https://native.preview.farmjs.dev",
      };
    },
    async stopPreviewAgent(sessionId) {
      calls.push(["stop", sessionId]);
      return false;
    },
    async waitPreviewAgent(sessionId) {
      calls.push(["wait", sessionId]);
      return await wait;
    },
  };
  const plan = {
    provider: "farm-gateway",
    gatewayUrl: "https://preview.farmjs.dev",
    relayUrl: "wss://preview.farmjs.dev/agent",
    target: {
      localUrl: "http://localhost:3000",
      host: "localhost",
      port: 3000,
      source: "port",
    },
    requestedName: "native",
    requestedHostname: "native.preview.farmjs.dev",
    requestedPublicUrl: "https://native.preview.farmjs.dev",
  };

  const running = runNativePreviewTunnel(plan, { runtime });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    ["start", "wss://preview.farmjs.dev/agent", "native", "http://localhost:3000"],
    ["wait", "native-session"],
  ]);

  resolveWait(true);
  const session = await running;
  assert.equal(session.sessionId, "native-session");
  assert.deepEqual(calls.at(-1), ["stop", "native-session"]);
});

test("treats a managed native disconnect before expiry as a fallback signal", async () => {
  const plan = {
    provider: "farm-gateway",
    gatewayUrl: "https://preview.farmjs.dev",
    relayUrl: "wss://preview.farmjs.dev/agent",
    expiresAt: Date.now() + 10 * 60_000,
    target: {
      localUrl: "http://localhost:3000",
      host: "localhost",
      port: 3000,
      source: "port",
    },
    requestedName: "reconnect",
    requestedHostname: "reconnect.preview.farmjs.dev",
    requestedPublicUrl: "https://reconnect.preview.farmjs.dev",
  };
  const runtime = {
    async startPreviewAgent() {
      return {
        sessionId: "native-session",
        publicUrl: "https://reconnect.preview.farmjs.dev",
      };
    },
    async stopPreviewAgent() {
      return true;
    },
    async waitPreviewAgent() {
      return true;
    },
  };

  await assert.rejects(
    runNativePreviewTunnel(plan, { runtime }),
    /disconnected before the preview expired/,
  );
});

test("treats a native disconnect within clock skew as hosted expiry", async () => {
  const plan = {
    provider: "farm-gateway",
    gatewayUrl: "https://preview.farmjs.dev",
    relayUrl: "wss://preview.farmjs.dev/agent",
    expiresAt: Date.now() + 60_000,
    target: { localUrl: "http://localhost:3000", host: "localhost", port: 3000, source: "port" },
    requestedName: "expiring",
    requestedHostname: "expiring.preview.farmjs.dev",
    requestedPublicUrl: "https://expiring.preview.farmjs.dev",
  };
  const runtime = {
    async startPreviewAgent() {
      return { sessionId: "native-session", publicUrl: plan.requestedPublicUrl };
    },
    async stopPreviewAgent() {
      return true;
    },
    async waitPreviewAgent() {
      return true;
    },
  };

  assert.equal((await runNativePreviewTunnel(plan, { runtime })).sessionId, "native-session");
});

test("forwards a gateway request to the local target", async () => {
  const server = await createTestServer((req, res) => {
    res.statusCode = 201;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ method: req.method, url: req.url }));
  });

  try {
    const response = await forwardGatewayRequest(
      {
        localUrl: `http://localhost:${server.port}`,
        host: "localhost",
        port: server.port,
        source: "port",
      },
      {
        id: "req_1",
        method: "POST",
        path: "/api/hello?from=gateway",
        headers: {
          "content-type": "text/plain",
        },
        body: Buffer.from("hello").toString("base64"),
        encoding: "base64",
      },
    );

    assert.equal(response.status, 201);
    assert.equal(response.encoding, "base64");
    assert.deepEqual(JSON.parse(Buffer.from(response.body, "base64").toString()), {
      method: "POST",
      url: "/api/hello?from=gateway",
    });
  } finally {
    await server.close();
  }
});

test("keeps gateway requests beneath the configured target path", async () => {
  const requests = [];
  const server = await createTestServer((req, res) => {
    requests.push(req.url);
    res.end(req.url);
  });
  const target = {
    localUrl: `http://localhost:${server.port}/console`,
    host: "localhost",
    port: server.port,
    source: "url",
  };

  try {
    const response = await forwardGatewayRequest(target, {
      id: "req_nested",
      method: "GET",
      path: "/dashboard?view=compact",
    });
    assert.equal(
      Buffer.from(response.body, "base64").toString(),
      "/console/dashboard?view=compact",
    );

    await assert.rejects(
      forwardGatewayRequest(target, {
        id: "req_escape",
        method: "GET",
        path: "/%2e%2e/admin",
      }),
      /cannot leave the local target path/,
    );
    assert.deepEqual(requests, ["/console/dashboard?view=compact"]);
  } finally {
    await server.close();
  }
});

test("removes headers nominated by Connection in both gateway directions", async () => {
  const server = await createTestServer((req, res) => {
    res.setHeader("connection", "x-response-hop");
    res.setHeader("x-response-hop", "remove-me");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ requestHop: req.headers["x-request-hop"] }));
  });

  try {
    const response = await forwardGatewayRequest(
      {
        localUrl: `http://localhost:${server.port}`,
        host: "localhost",
        port: server.port,
        source: "port",
      },
      {
        id: "req_connection_headers",
        method: "GET",
        path: "/",
        headers: {
          connection: "x-request-hop",
          "x-request-hop": "remove-me",
        },
      },
    );

    assert.equal(JSON.parse(Buffer.from(response.body, "base64").toString()).requestHop, undefined);
    assert.equal(response.headers["x-response-hop"], undefined);
  } finally {
    await server.close();
  }
});

test("forwards local redirects without following them", async () => {
  const server = await createTestServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/destination" });
      res.end();
      return;
    }
    res.end("destination");
  });

  try {
    const response = await forwardGatewayRequest(
      {
        localUrl: `http://localhost:${server.port}`,
        host: "localhost",
        port: server.port,
        source: "port",
      },
      {
        id: "req_redirect",
        method: "GET",
        path: "/redirect",
      },
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, "/destination");
  } finally {
    await server.close();
  }
});

test("removes content encoding after fetch decodes a local response", async () => {
  const body = gzipSync("compressed response");
  const server = await createTestServer((_req, res) => {
    res.writeHead(200, {
      "content-encoding": "gzip",
      "content-length": body.byteLength,
    });
    res.end(body);
  });

  try {
    const response = await forwardGatewayRequest(
      {
        localUrl: `http://localhost:${server.port}`,
        host: "localhost",
        port: server.port,
        source: "port",
      },
      {
        id: "req_gzip",
        method: "GET",
        path: "/compressed",
      },
    );

    assert.equal(response.headers["content-encoding"], undefined);
    assert.equal(Buffer.from(response.body, "base64").toString(), "compressed response");
  } finally {
    await server.close();
  }
});

test("stops buffering gateway responses above the configured limit", async () => {
  const server = await createTestServer((_req, res) => {
    res.write("12345678");
    res.end("9");
  });

  try {
    await assert.rejects(
      forwardGatewayRequest(
        {
          localUrl: `http://localhost:${server.port}`,
          host: "localhost",
          port: server.port,
          source: "port",
        },
        {
          id: "req_large",
          method: "GET",
          path: "/large",
        },
        { maxResponseBodyBytes: 8 },
      ),
      /exceeded the 8 byte limit/,
    );
  } finally {
    await server.close();
  }
});

test("cancels a forwarded local request at its deadline", async () => {
  const server = await createTestServer(() => undefined);

  try {
    await assert.rejects(
      forwardGatewayRequest(
        {
          localUrl: `http://localhost:${server.port}`,
          host: "localhost",
          port: server.port,
          source: "port",
        },
        {
          id: "req_timeout",
          method: "GET",
          path: "/slow",
        },
        { signal: AbortSignal.timeout(20) },
      ),
      (error) => error?.name === "TimeoutError",
    );
  } finally {
    await server.close();
  }
});

test("closes the gateway session when the local target stops", async () => {
  const app = await createTestServer();
  const gateway = await createPreviewGatewayTestServer();
  const plan = createPreviewGatewayPlan(
    {
      localUrl: `http://localhost:${app.port}`,
      host: "localhost",
      port: app.port,
      source: "port",
    },
    {
      gatewayUrl: gateway.url,
      name: "watch-check",
    },
  );

  try {
    const preview = runPreviewGateway(plan, {
      pollTimeoutMs: 25,
      localProbeIntervalMs: 20,
      localProbeTimeoutMs: 50,
    });

    await gateway.waitForSession();
    await app.close();

    await Promise.race([
      preview,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("preview did not stop after local target closed")), 1000),
      ),
    ]);

    assert.equal(gateway.deletedSessions.length, 1);
    assert.equal(gateway.deletedSessions[0], "sess_watch");
  } finally {
    await app.close().catch(() => undefined);
    await gateway.close();
  }
});

test("keeps the gateway session alive after one local request fails", async () => {
  const app = await createTestServer((req, res) => {
    if (req.url === "/fail") {
      req.socket.destroy();
      return;
    }
    res.end("ok");
  });
  const gateway = await createQueuedPreviewGatewayTestServer(
    [
      { id: "req_fail", method: "GET", path: "/fail" },
      { id: "req_ok", method: "GET", path: "/ok" },
    ],
    { expectedControlAuth: "bearer" },
  );
  const plan = createPreviewGatewayPlan(
    {
      localUrl: `http://localhost:${app.port}`,
      host: "localhost",
      port: app.port,
      source: "port",
    },
    { gatewayUrl: gateway.url, name: "request-isolation" },
  );

  try {
    await runPreviewGateway(plan, {
      maxRequests: 2,
      pollTimeoutMs: 10,
      localProbeIntervalMs: 1_000,
    });

    assert.deepEqual(
      gateway.responses.map(({ requestId, response }) => [requestId, response.status]),
      [
        ["req_fail", 502],
        ["req_ok", 200],
      ],
    );
  } finally {
    await app.close();
    await gateway.close();
  }
});

test("aborts local gateway work after a public cancellation", async () => {
  let markSlowClosed;
  const slowClosed = new Promise((resolve) => {
    markSlowClosed = resolve;
  });
  const app = await createTestServer((req, res) => {
    if (req.url === "/slow") {
      res.once("close", markSlowClosed);
      return;
    }
    res.end("ok");
  });
  const gateway = await createQueuedPreviewGatewayTestServer(
    [
      { id: "req_cancel", method: "GET", path: "/slow" },
      { id: "req_cancel", method: "GET", path: "/slow", cancelled: true },
      { id: "req_ok", method: "GET", path: "/ok" },
    ],
    { pollDelayMs: 20 },
  );
  const plan = createPreviewGatewayPlan(
    {
      localUrl: `http://localhost:${app.port}`,
      host: "localhost",
      port: app.port,
      source: "port",
    },
    { gatewayUrl: gateway.url, name: "request-cancellation" },
  );

  try {
    await runPreviewGateway(plan, {
      maxRequests: 1,
      pollTimeoutMs: 10,
      localProbeIntervalMs: 1_000,
    });
    await Promise.race([
      slowClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("cancelled local request remained active")), 500),
      ),
    ]);
    assert.deepEqual(
      gateway.responses.map(({ requestId, response }) => [requestId, response.status]),
      [["req_ok", 200]],
    );
  } finally {
    await app.close();
    await gateway.close();
  }
});

test("cancels streaming local health probe responses", async () => {
  const app = await createStreamingTestServer();
  const gateway = await createPreviewGatewayTestServer();
  const plan = createPreviewGatewayPlan(
    {
      localUrl: `http://localhost:${app.port}`,
      host: "localhost",
      port: app.port,
      source: "port",
    },
    { gatewayUrl: gateway.url, name: "probe-cleanup" },
  );

  try {
    const preview = runPreviewGateway(plan, {
      pollTimeoutMs: 25,
      localProbeIntervalMs: 20,
      localProbeTimeoutMs: 200,
    });

    await gateway.waitForSession();
    await Promise.race([
      app.waitForCancellation(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("streaming health probe was not cancelled")), 500),
      ),
    ]);
    await app.close();
    await preview;
  } finally {
    await app.close().catch(() => undefined);
    await gateway.close();
  }
});

test("falls back to gateway polling while the hosted native relay is unavailable", async () => {
  const app = await createTestServer();
  const gateway = await createPreviewGatewayTestServer();
  const previousRelay = process.env.FARM_PREVIEW_RELAY_URL;
  const previousToken = process.env.FARM_PREVIEW_RELAY_TOKEN;
  process.env.FARM_PREVIEW_RELAY_URL = "ws://127.0.0.1:1/agent";
  process.env.FARM_PREVIEW_RELAY_TOKEN = "do-not-expose-fallback-relay-token";

  try {
    const preview = previewFarm({
      port: app.port,
      gatewayUrl: gateway.url,
      name: "fallback-check",
      timeoutMs: 1000,
    });

    await gateway.waitForSession();
    await app.close();

    const result = await Promise.race([
      preview,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("fallback preview did not stop")), 4000),
      ),
    ]);

    assert.equal(result.session.id, "sess_watch");
    assert.equal("relayToken" in result.plan, false);
    assert.equal("token" in result.session, false);
    assert.ok(!JSON.stringify(result).includes("token_watch"));
    assert.ok(!JSON.stringify(result).includes("do-not-expose-fallback-relay-token"));
    assert.equal(gateway.deletedSessions.length, 1);
  } finally {
    restoreEnv("FARM_PREVIEW_RELAY_URL", previousRelay);
    restoreEnv("FARM_PREVIEW_RELAY_TOKEN", previousToken);
    await app.close().catch(() => undefined);
    await gateway.close();
  }
});

test("uses query credentials advertised by the polling gateway", async () => {
  const app = await createTestServer((_req, res) => {
    res.statusCode = 201;
    res.end("legacy-ok");
  });
  const gateway = await createQueuedPreviewGatewayTestServer(
    [{ id: "req_legacy", method: "GET", path: "/legacy", headers: {} }],
    { advertisedControlAuth: "query", expectedControlAuth: "query" },
  );
  const plan = createPreviewGatewayPlan(
    {
      localUrl: `http://localhost:${app.port}`,
      host: "localhost",
      port: app.port,
      source: "port",
    },
    { gatewayUrl: gateway.url, name: "legacy-auth" },
  );
  const runtime = {
    fetch,
    async openBrowser() {
      return false;
    },
    async wait() {},
    credentials: {
      async get() {},
      async set() {},
      async delete() {},
    },
    async promptDuration() {},
  };

  try {
    const authorized = await authorizePreviewGatewayPlan(plan, { runtime });
    assert.equal(authorized.controlAuth, "query");
    assert.deepEqual(gateway.configRequests, ["/api/auth/config"]);
    await runPreviewGateway(authorized, {
      maxRequests: 1,
      pollTimeoutMs: 10,
      localProbeIntervalMs: 1_000,
    });
    assert.deepEqual(
      gateway.responses.map(({ requestId, response }) => [requestId, response.status]),
      [["req_legacy", 201]],
    );
    assert.deepEqual(
      new Set(gateway.controlRequests),
      new Set([
        "GET /api/sessions/sess_queue/requests",
        "POST /api/sessions/sess_queue/responses/req_legacy",
        "DELETE /api/sessions/sess_queue",
      ]),
    );
  } finally {
    await app.close();
    await gateway.close();
  }
});

test("runs farm preview dry-run through the managed gateway by default", async () => {
  const server = await createTestServer();

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliBin,
        "preview",
        "--port",
        String(server.port),
        "--name",
        "checkout-test",
        "--gateway",
        "https://preview.farmjs.dev",
        "--expires",
        "2h",
        "--dry-run",
      ],
      {
        env: {
          ...process.env,
          FARM_PREVIEW_PROVIDER: "",
          FARM_PREVIEW_TUNNEL_COMMAND: "",
        },
      },
    );

    assert.match(stdout, /Creating public preview/);
    assert.match(stdout, /Gateway: https:\/\/preview\.farmjs\.dev/);
    assert.match(stdout, new RegExp(`Local:\\s+http://localhost:${server.port}`));
    assert.match(stdout, /checkout-test\.preview\.farmjs\.dev/);
    assert.match(stdout, /Expires: after 2h/);
    assert.match(stdout, /gateway dry run completed/i);
  } finally {
    await server.close();
  }
});

test("runs farm preview dry-run through the CLI", async () => {
  const server = await createTestServer();

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliBin, "preview", "--port", String(server.port), "--name", "checkout-test", "--dry-run"],
      {
        env: {
          ...process.env,
          FARM_PREVIEW_TUNNEL_COMMAND:
            "farm-preview-agent tunnel --url {url} --hostname {hostname}",
        },
      },
    );

    assert.match(stdout, /Creating public preview/);
    assert.match(stdout, new RegExp(`Local:\\s+http://localhost:${server.port}`));
    assert.match(stdout, /farm-preview-agent tunnel/);
    assert.match(stdout, /checkout-test\.preview\.farmjs\.dev/);
    assert.match(stdout, /dry run completed/i);
  } finally {
    await server.close();
  }
});

async function createTestServer(handler) {
  const server = createServer(
    handler ||
      ((_req, res) => {
        res.statusCode = 200;
        res.end("ok");
      }),
  );

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function createStreamingTestServer() {
  let resolveCancellation;
  const cancellation = new Promise((resolve) => {
    resolveCancellation = resolve;
  });
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("streaming");
    res.once("close", resolveCancellation);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    waitForCancellation: () => cancellation,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function createPreviewGatewayTestServer() {
  let resolveSession;
  const sessionReady = new Promise((resolve) => {
    resolveSession = resolve;
  });
  const deletedSessions = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      await readRequestBody(req);
      resolveSession();
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "sess_watch",
          name: "watch-check",
          token: "token_watch",
          publicUrl: "https://watch-check.preview.farmjs.dev",
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sessions/sess_watch/requests") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/sessions/sess_watch") {
      deletedSessions.push("sess_watch");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://localhost:${address.port}`,
    deletedSessions,
    waitForSession: () => sessionReady,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function createQueuedPreviewGatewayTestServer(requests, options = {}) {
  const queued = [...requests];
  const responses = [];
  const configRequests = [];
  const controlRequests = [];
  const server = await createTestServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (
      req.method === "GET" &&
      url.pathname === "/api/auth/config" &&
      options.advertisedControlAuth
    ) {
      configRequests.push(url.pathname);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          enabled: false,
          controlAuth: options.advertisedControlAuth,
          defaultSessionTtlMs: 30 * 60 * 1000,
          maxSessionTtlMs: 30 * 60 * 1000,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      await readRequestBody(req);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "sess_queue",
          name: "request-isolation",
          token: "token_queue",
          publicUrl: "https://request-isolation.preview.farmjs.dev",
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sessions/sess_queue/requests") {
      assertGatewayControlAuth(req, url, options.expectedControlAuth, "token_queue");
      controlRequests.push(`${req.method} ${url.pathname}`);
      if (options.pollDelayMs)
        await new Promise((resolve) => setTimeout(resolve, options.pollDelayMs));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ requests: queued.length ? [queued.shift()] : [] }));
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sessions/sess_queue/responses/")) {
      assertGatewayControlAuth(req, url, options.expectedControlAuth, "token_queue");
      controlRequests.push(`${req.method} ${url.pathname}`);
      responses.push({
        requestId: url.pathname.split("/").pop(),
        response: JSON.parse(await readRequestBody(req)),
      });
      res.end("ok");
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/sessions/sess_queue") {
      assertGatewayControlAuth(req, url, options.expectedControlAuth, "token_queue");
      controlRequests.push(`${req.method} ${url.pathname}`);
      res.end("ok");
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  return {
    url: `http://localhost:${server.port}`,
    configRequests,
    controlRequests,
    responses,
    close: server.close,
  };
}

function assertGatewayControlAuth(req, url, expected, token) {
  if (!expected) return;
  if (expected === "query") {
    assert.equal(url.searchParams.get("token"), token);
    assert.equal(req.headers.authorization, undefined);
    return;
  }
  assert.equal(url.searchParams.get("token"), null);
  assert.equal(req.headers.authorization, `Bearer ${token}`);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

test("terminates the tunnel process when the preview URL times out", async () => {
  const pidFile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-preview-timeout-")),
    "child.pid",
  );
  // A tunnel that starts, prints something that is not a URL, and then hangs.
  const script =
    "require('node:fs').writeFileSync(process.env.FARM_TEST_PID_FILE, String(process.pid));" +
    "process.stdout.write('starting tunnel\\n');" +
    "setInterval(() => {}, 1000);";

  const plan = {
    command: process.execPath,
    args: ["-e", script],
    target: { localUrl: "http://127.0.0.1:3000", host: "127.0.0.1", port: 3000, source: "port" },
    requestedName: "timeout-preview",
    requestedHostname: "timeout-preview.preview.farmjs.dev",
  };

  const previousPidFile = process.env.FARM_TEST_PID_FILE;
  process.env.FARM_TEST_PID_FILE = pidFile;
  try {
    await assert.rejects(runPreviewTunnel(plan, 300), /Timed out waiting for the preview URL/);

    const pid = Number(await fs.readFile(pidFile, "utf8"));
    assert.ok(Number.isInteger(pid) && pid > 0, "the tunnel child should have recorded its pid");

    // The child must not outlive the command that spawned it.
    let alive = true;
    for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, "the tunnel process should be terminated after the timeout");
  } finally {
    if (previousPidFile === undefined) delete process.env.FARM_TEST_PID_FILE;
    else process.env.FARM_TEST_PID_FILE = previousPidFile;
  }
});

test("ignores vendor documentation URLs before a built-in tunnel is ready", async () => {
  const script =
    "process.stdout.write('Learn more: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/\\n');" +
    "setTimeout(() => {" +
    "  process.stdout.write('tunnel ready at https://actual-preview.trycloudflare.com\\n');" +
    "}, 50);";

  const plan = {
    command: process.execPath,
    args: ["-e", script],
    provider: "cloudflared",
    target: { localUrl: "http://127.0.0.1:3000", host: "127.0.0.1", port: 3000, source: "port" },
    requestedName: "actual-preview",
    requestedHostname: "actual-preview.preview.farmjs.dev",
  };

  const publicUrl = await runPreviewTunnel(plan, 2_000);
  assert.equal(publicUrl, "https://actual-preview.trycloudflare.com");
});

test("finds the preview URL after a noisy tunnel prologue", async () => {
  // The scan buffer is bounded, so a tunnel that prints a lot before announcing
  // its URL must still be matched - including when the URL lands in a later
  // chunk than the noise.
  const script =
    "for (let i = 0; i < 4000; i += 1) process.stdout.write('warming up the tunnel ' + i + '\\n');" +
    "setTimeout(() => {" +
    "  process.stdout.write('tunnel ready at https://noisy-preview.trycloudflare.com\\n');" +
    "  setInterval(() => {}, 1000).unref();" +
    "}, 50);";

  const plan = {
    command: process.execPath,
    args: ["-e", script],
    target: { localUrl: "http://127.0.0.1:3000", host: "127.0.0.1", port: 3000, source: "port" },
    requestedName: "noisy-preview",
    requestedHostname: "noisy-preview.preview.farmjs.dev",
  };

  const publicUrl = await runPreviewTunnel(plan, 10_000);
  assert.equal(publicUrl, "https://noisy-preview.trycloudflare.com");
});
