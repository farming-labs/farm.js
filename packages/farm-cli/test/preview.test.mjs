import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const {
  createPreviewGatewayPlan,
  createPreviewTunnelPlan,
  forwardGatewayRequest,
  parsePreviewPublicUrl,
  previewFarm,
  resolvePreviewTarget,
  runNativePreviewTunnel,
  runPreviewGateway,
} = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("parses public preview urls from tunnel output", () => {
  assert.equal(
    parsePreviewPublicUrl("your url is: https://stripe-demo.preview.farming-labs.dev"),
    "https://stripe-demo.preview.farming-labs.dev",
  );
  assert.equal(
    parsePreviewPublicUrl(
      "docs: https://developers.cloudflare.com\nready: https://stripe-demo.preview.farming-labs.dev",
      "stripe-demo.preview.farming-labs.dev",
    ),
    "https://stripe-demo.preview.farming-labs.dev",
  );
  assert.equal(
    parsePreviewPublicUrl("docs: https://example.com\nready: https://stripe-demo.loca.lt"),
    "https://stripe-demo.loca.lt",
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
  process.env.FARM_PREVIEW_DOMAIN = "preview.farming-labs.dev";

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
    assert.match(plan.command, /"stripe-webhook.preview.farming-labs.dev"/);
  } finally {
    restoreEnv("FARM_PREVIEW_TUNNEL_COMMAND", previousCommand);
    restoreEnv("FARM_PREVIEW_DOMAIN", previousDomain);
  }
});

test("creates a managed gateway preview plan by default", () => {
  const previousGateway = process.env.FARM_PREVIEW_GATEWAY_URL;
  const previousDomain = process.env.FARM_PREVIEW_DOMAIN;
  process.env.FARM_PREVIEW_GATEWAY_URL = "https://preview.farming-labs.dev";
  process.env.FARM_PREVIEW_DOMAIN = "preview.farming-labs.dev";

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
    assert.equal(plan.gatewayUrl, "https://preview.farming-labs.dev");
    assert.equal(plan.relayUrl, "wss://preview.farming-labs.dev/agent");
    assert.equal(plan.requestedPublicUrl, "https://stripe-webhook.preview.farming-labs.dev");
  } finally {
    restoreEnv("FARM_PREVIEW_GATEWAY_URL", previousGateway);
    restoreEnv("FARM_PREVIEW_DOMAIN", previousDomain);
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
        publicUrl: "https://native.preview.farming-labs.dev",
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
    gatewayUrl: "https://preview.farming-labs.dev",
    relayUrl: "wss://preview.farming-labs.dev/agent",
    target: {
      localUrl: "http://localhost:3000",
      host: "localhost",
      port: 3000,
      source: "port",
    },
    requestedName: "native",
    requestedHostname: "native.preview.farming-labs.dev",
    requestedPublicUrl: "https://native.preview.farming-labs.dev",
  };

  const running = runNativePreviewTunnel(plan, { runtime });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    ["start", "wss://preview.farming-labs.dev/agent", "native", "http://localhost:3000"],
    ["wait", "native-session"],
  ]);

  resolveWait(true);
  const session = await running;
  assert.equal(session.sessionId, "native-session");
  assert.deepEqual(calls.at(-1), ["stop", "native-session"]);
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
  const gateway = await createQueuedPreviewGatewayTestServer([
    { id: "req_fail", method: "GET", path: "/fail" },
    { id: "req_ok", method: "GET", path: "/ok" },
  ]);
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
  process.env.FARM_PREVIEW_RELAY_URL = "ws://127.0.0.1:1/agent";

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
    assert.equal(gateway.deletedSessions.length, 1);
  } finally {
    restoreEnv("FARM_PREVIEW_RELAY_URL", previousRelay);
    await app.close().catch(() => undefined);
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
        "https://preview.farming-labs.dev",
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
    assert.match(stdout, /Gateway: https:\/\/preview\.farming-labs\.dev/);
    assert.match(stdout, new RegExp(`Local:\\s+http://localhost:${server.port}`));
    assert.match(stdout, /checkout-test\.preview\.farming-labs\.dev/);
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
    assert.match(stdout, /checkout-test\.preview\.farming-labs\.dev/);
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
          publicUrl: "https://watch-check.preview.farming-labs.dev",
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
  const server = await createTestServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      await readRequestBody(req);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "sess_queue",
          name: "request-isolation",
          token: "token_queue",
          publicUrl: "https://request-isolation.preview.farming-labs.dev",
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sessions/sess_queue/requests") {
      if (options.pollDelayMs)
        await new Promise((resolve) => setTimeout(resolve, options.pollDelayMs));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ requests: queued.length ? [queued.shift()] : [] }));
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sessions/sess_queue/responses/")) {
      responses.push({
        requestId: url.pathname.split("/").pop(),
        response: JSON.parse(await readRequestBody(req)),
      });
      res.end("ok");
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/sessions/sess_queue") {
      res.end("ok");
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  return {
    url: `http://localhost:${server.port}`,
    responses,
    close: server.close,
  };
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
