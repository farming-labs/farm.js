import assert from "node:assert/strict";
import { createServer, request as createRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { createNodePreviewGatewayHandler, MemoryPreviewGatewayStore } from "../dist/index.js";

test("localhost preview origins preserve the port and serve root-relative scripts", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, { domain: "localhost" });
  try {
    const registered = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "browser-demo" }),
    });
    const session = await registered.json();
    assert.equal(session.publicUrl, `http://browser-demo.localhost:${new URL(gateway.url).port}`);
    const pending = requestWithHeaders(`${gateway.url}/@farm/client.js`, {
      host: new URL(session.publicUrl).host,
    });
    const poll = await (
      await fetch(
        `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
      )
    ).json();
    assert.equal(poll.requests[0].path, "/@farm/client.js");
    assert.equal(poll.requests[0].headers["x-forwarded-proto"], "http");
    await store.saveResponse(session.id, poll.requests[0].id, {
      status: 200,
      headers: { "content-type": "text/javascript" },
      body: Buffer.from("window.previewReady = true;").toString("base64"),
      encoding: "base64",
    });
    const response = await pending;
    assert.equal(response.headers["content-type"], "text/javascript");
    assert.equal(response.body, "window.previewReady = true;");
  } finally {
    await gateway.close();
  }
});

test("proxies a public preview request through the gateway queue", async () => {
  const store = new MemoryPreviewGatewayStore();
  const activity = [];
  const gateway = await createGatewayServer(store, {
    observer: {
      session(event) {
        assert.equal(event.token, undefined);
      },
      request(event) {
        activity.push(event);
        throw new Error("optional telemetry failed");
      },
    },
  });

  try {
    const sessionResponse = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "docs-check",
        localUrl: "http://localhost:4321",
      }),
    });
    const session = await sessionResponse.json();

    assert.equal(session.publicUrl, `${gateway.url}/__preview/docs-check`);

    const publicRequest = fetch(`${gateway.url}/__preview/docs-check/docs?hello=world`, {
      headers: {
        forwarded: "for=127.0.0.1;host=evil.example;proto=https",
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });
    const pollResponse = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    );
    const poll = await pollResponse.json();

    assert.equal(poll.requests.length, 1);
    assert.equal(poll.requests[0].method, "GET");
    assert.equal(poll.requests[0].path, "/docs?hello=world");
    assert.equal(poll.requests[0].headers.forwarded, undefined);
    assert.equal(poll.requests[0].headers["x-forwarded-for"], undefined);
    assert.equal(poll.requests[0].headers["x-forwarded-host"], new URL(gateway.url).host);
    assert.equal(poll.requests[0].headers["x-forwarded-proto"], "http");

    await fetch(
      `${gateway.url}/api/sessions/${session.id}/responses/${poll.requests[0].id}?token=${session.token}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: 202,
          headers: {
            "content-type": "text/plain",
          },
          body: Buffer.from("preview-ok").toString("base64"),
          encoding: "base64",
        }),
      },
    );

    const response = await publicRequest;
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "preview-ok");
    assert.equal(activity.length, 1);
    assert.equal(activity[0].path, "/docs");
    assert.equal(activity[0].status, 202);
    assert.equal(activity[0].headers, undefined);
    assert.equal(activity[0].body, undefined);
  } finally {
    await gateway.close();
  }
});

test("rejects oversized agent responses and completes the public request safely", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, { maxResponseBodyBytes: 8 });

  try {
    const session = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "response-limit", localUrl: "http://localhost:4321" }),
    }).then((response) => response.json());

    const publicRequest = fetch(`${gateway.url}/__preview/response-limit/large`);
    const poll = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    ).then((response) => response.json());
    const upload = await fetch(
      `${gateway.url}/api/sessions/${session.id}/responses/${poll.requests[0].id}?token=${session.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("123456789").toString("base64"),
          encoding: "base64",
        }),
      },
    );

    assert.equal(upload.status, 413);
    const response = await publicRequest;
    assert.equal(response.status, 502);
    assert.match(await response.text(), /exceeded the 8 byte limit/);
  } finally {
    await gateway.close();
  }
});

test("does not resurrect a deleted session when a stale touch lands late", async () => {
  const store = new MemoryPreviewGatewayStore();
  const session = {
    id: "sess-1",
    name: "late-touch",
    localUrl: "http://localhost:4321",
    token: "tok",
    expiresAt: Date.now() + 60_000,
    lastHeartbeatAt: Date.now(),
  };
  await store.createSession(session, 60_000);

  // The preview is stopped: the session is deleted while a poll handler still
  // holds the old snapshot.
  await store.deleteSession(session);
  await store.touchSession(session, 60_000);

  // A late touch must not bring the session (or its name mapping) back.
  assert.equal(await store.getSessionById("sess-1"), undefined);
  assert.equal(await store.getSessionByName("late-touch"), undefined);
});

test("replays every Set-Cookie header to the public visitor", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const sessionResponse = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cookie-check", localUrl: "http://localhost:4321" }),
    });
    const session = await sessionResponse.json();

    const publicRequest = fetch(`${gateway.url}/__preview/cookie-check/login`, { method: "POST" });
    const pollResponse = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    );
    const poll = await pollResponse.json();

    // A login response commonly sets both a session and a CSRF cookie.
    await fetch(
      `${gateway.url}/api/sessions/${session.id}/responses/${poll.requests[0].id}?token=${session.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: 200,
          headers: {
            "content-type": "text/plain",
            "set-cookie": ["session=abc; Path=/; HttpOnly", "csrf=xyz; Path=/"],
          },
          body: Buffer.from("ok").toString("base64"),
          encoding: "base64",
        }),
      },
    );

    const response = await publicRequest;
    assert.equal(response.status, 200);
    const setCookie = response.headers.getSetCookie();
    assert.equal(setCookie.length, 2);
    assert.ok(setCookie.some((cookie) => cookie.startsWith("session=abc")));
    assert.ok(setCookie.some((cookie) => cookie.startsWith("csrf=xyz")));
  } finally {
    await gateway.close();
  }
});

test("removes headers nominated by Connection in both polling proxy directions", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const session = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "connection-check", localUrl: "http://localhost:4321" }),
    }).then((response) => response.json());

    const publicRequest = requestWithHeaders(`${gateway.url}/__preview/connection-check/headers`, {
      connection: "x-request-hop",
      "x-request-hop": "remove-me",
    });
    const poll = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    ).then((response) => response.json());
    assert.equal(poll.requests[0].headers["x-request-hop"], undefined);

    await fetch(
      `${gateway.url}/api/sessions/${session.id}/responses/${poll.requests[0].id}?token=${session.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: 200,
          headers: {
            connection: "x-response-hop",
            "x-response-hop": "remove-me",
          },
          body: Buffer.from("ok").toString("base64"),
          encoding: "base64",
        }),
      },
    );

    const response = await publicRequest;
    assert.equal(response.status, 200);
    assert.equal(response.headers["x-response-hop"], undefined);
  } finally {
    await gateway.close();
  }
});

test("preserves Content-Encoding for compressed public request bodies", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const session = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "encoding-check", localUrl: "http://localhost:4321" }),
    }).then((response) => response.json());
    const compressedBody = gzipSync(JSON.stringify({ message: "compressed" }));

    const publicRequest = fetch(`${gateway.url}/__preview/encoding-check/messages`, {
      method: "POST",
      headers: {
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
      body: compressedBody,
    });
    const poll = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    ).then((response) => response.json());
    const queued = poll.requests[0];

    assert.equal(queued.headers["content-encoding"], "gzip");
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(queued.body, "base64")).toString("utf8")), {
      message: "compressed",
    });

    await fetch(
      `${gateway.url}/api/sessions/${session.id}/responses/${queued.id}?token=${session.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: 204 }),
      },
    );
    assert.equal((await publicRequest).status, 204);
  } finally {
    await gateway.close();
  }
});

test("expires stale preview clients before queueing public requests", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, {
    clientHeartbeatTimeoutMs: 20,
    requestTimeoutMs: 2000,
  });

  try {
    const sessionResponse = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "stale-check",
        localUrl: "http://localhost:4321",
      }),
    });
    assert.equal(sessionResponse.status, 200);

    await delay(50);

    const startedAt = Date.now();
    const response = await fetch(`${gateway.url}/__preview/stale-check/docs`);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(response.status, 404);
    assert.match(await response.text(), /No active Farm preview/);
    assert.ok(elapsedMs < 1000, `expected stale request to fail quickly, got ${elapsedMs}ms`);
  } finally {
    await gateway.close();
  }
});

test("queues cancellation when a public visitor disconnects", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const session = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "cancel-check", localUrl: "http://localhost:4321" }),
    }).then((response) => response.json());

    const publicRequest = createRequest(`${gateway.url}/__preview/cancel-check/slow`);
    publicRequest.on("error", () => undefined);
    publicRequest.end();

    const firstPoll = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    ).then((response) => response.json());
    assert.equal(firstPoll.requests[0].cancelled, undefined);
    publicRequest.destroy();

    const secondPoll = await fetch(
      `${gateway.url}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
    ).then((response) => response.json());
    assert.equal(secondPoll.requests[0].id, firstPoll.requests[0].id);
    assert.equal(secondPoll.requests[0].cancelled, true);
  } finally {
    await gateway.close();
  }
});

test("rejects claiming a preview name that is actively in use", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store);

  try {
    const first = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4321" }),
    });
    assert.equal(first.status, 200);
    const firstSession = await first.json();

    const second = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:9999" }),
    });
    assert.equal(second.status, 409);
    assert.match(await second.text(), /already active/);

    // The original session still owns its name.
    const session = await store.getSessionByName("demo");
    assert.equal(session.id, firstSession.id);
  } finally {
    await gateway.close();
  }
});

test("keeps a taken-over name routable after the stale session is deleted", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, {
    clientHeartbeatTimeoutMs: 20,
    requestTimeoutMs: 2000,
  });

  try {
    const first = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4321" }),
    });
    assert.equal(first.status, 200);
    const stale = await first.json();

    // Let the first session miss its heartbeat window, then take the name over.
    await delay(50);
    const second = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4322" }),
    });
    assert.equal(second.status, 200);
    const takeover = await second.json();

    // Deleting the stale session must not unroute the takeover session.
    const deletion = await fetch(`${gateway.url}/api/sessions/${stale.id}?token=${stale.token}`, {
      method: "DELETE",
    });
    assert.equal(deletion.status, 200);

    const session = await store.getSessionByName("demo");
    assert.ok(session, "expected the takeover session to still own the name");
    assert.equal(session.id, takeover.id);

    // Public traffic still reaches the takeover session's queue.
    const publicRequest = fetch(`${gateway.url}/__preview/demo/health`);
    const poll = await fetch(
      `${gateway.url}/api/sessions/${takeover.id}/requests?token=${takeover.token}&wait=1000`,
    ).then((response) => response.json());
    assert.equal(poll.requests.length, 1);
    assert.equal(poll.requests[0].path, "/health");

    await fetch(
      `${gateway.url}/api/sessions/${takeover.id}/responses/${poll.requests[0].id}?token=${takeover.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("takeover-ok").toString("base64"),
          encoding: "base64",
        }),
      },
    );
    const response = await publicRequest;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "takeover-ok");
  } finally {
    await gateway.close();
  }
});

test("reports an online session name as claimed for the other preview transport", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, { clientHeartbeatTimeoutMs: 20 });

  try {
    const created = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", localUrl: "http://localhost:4321" }),
    });
    assert.equal(created.status, 200);

    // The persistent relay serves the same hostnames from its own namespace and
    // its route wins, so it asks this before accepting a name claim.
    assert.equal(await gateway.handler.isPreviewNameClaimed("demo"), true);
    assert.equal(await gateway.handler.isPreviewNameClaimed("Demo"), true);
    assert.equal(await gateway.handler.isPreviewNameClaimed("other"), false);
    assert.equal(await gateway.handler.isPreviewNameClaimed(""), false);

    // A session that stopped heartbeating no longer holds its name, matching
    // how public routing and session creation treat it.
    await delay(50);
    assert.equal(await gateway.handler.isPreviewNameClaimed("demo"), false);
  } finally {
    await gateway.close();
  }
});

test("exchanges GitHub login for a scoped expiring preview session", async () => {
  const store = new MemoryPreviewGatewayStore();
  const signingSecret = "managed-preview-test-secret-that-is-long-enough";
  const gateway = await createGatewayServer(store, {
    auth: {
      signingSecret,
      githubClientId: "github-client-id",
      defaultSessionTtlMs: 60_000,
      maxSessionTtlMs: 120_000,
      fetch: async (_url, init) => {
        assert.equal(init.headers.authorization, "Bearer github-provider-token");
        return Response.json({
          id: 42,
          login: "farm-user",
          name: "Farm User",
          avatar_url: "https://avatars.example.com/farm-user",
        });
      },
    },
  });

  try {
    const config = await fetch(`${gateway.url}/api/auth/config`).then((response) =>
      response.json(),
    );
    assert.deepEqual(config, {
      enabled: true,
      controlAuth: "bearer",
      provider: "github",
      clientId: "github-client-id",
      scope: "read:user",
      defaultSessionTtlMs: 60_000,
      maxSessionTtlMs: 120_000,
    });

    const accountResponse = await fetch(`${gateway.url}/api/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", accessToken: "github-provider-token" }),
    });
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.equal(account.user.login, "farm-user");
    assert.ok(account.token);

    const invalidExpiry = await fetch(`${gateway.url}/api/tunnel/grants`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "managed-demo", expiresInMs: 1.5 }),
    });
    assert.equal(invalidExpiry.status, 400);

    const grantResponse = await fetch(`${gateway.url}/api/tunnel/grants`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "managed-demo", expiresInMs: 90_000 }),
    });
    assert.equal(grantResponse.status, 200);
    const grant = await grantResponse.json();
    assert.equal(grant.name, "managed-demo");
    assert.ok(grant.expiresAt > Date.now() + 80_000);

    const mismatchedGrant = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${grant.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "another-name" }),
    });
    assert.equal(mismatchedGrant.status, 401);

    const [prefix, payload, signature] = grant.token.split(".");
    const tamperedPayload = `${payload.startsWith("A") ? "B" : "A"}${payload.slice(1)}`;
    const tamperedToken = `${prefix}.${tamperedPayload}.${signature}`;
    const tamperedGrant = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tamperedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "managed-demo" }),
    });
    assert.equal(tamperedGrant.status, 401);

    const unauthenticated = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "managed-demo" }),
    });
    assert.equal(unauthenticated.status, 401);

    const sessionResponse = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${grant.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "managed-demo", localUrl: "http://localhost:4321" }),
    });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.expiresAt, grant.expiresAt);

    const heartbeat = await fetch(`${gateway.url}/api/sessions/${session.id}/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(heartbeat.status, 200);
    assert.equal((await heartbeat.json()).expiresAt, grant.expiresAt);
  } finally {
    await gateway.close();
  }
});

test("slides default self-hosted sessions but preserves explicit absolute expiry", async () => {
  const store = new MemoryPreviewGatewayStore();
  const gateway = await createGatewayServer(store, { sessionTtlMs: 60_000 });

  try {
    const sliding = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sliding-session" }),
    }).then((response) => response.json());
    assert.equal(sliding.expiresAt, undefined);

    const storedSliding = await store.getSessionById(sliding.id);
    assert.ok(storedSliding);
    const forcedNearExpiry = Date.now() + 10_000;
    storedSliding.expiresAt = forcedNearExpiry;
    const slidingHeartbeatResponse = await fetch(
      `${gateway.url}/api/sessions/${sliding.id}/heartbeat`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${sliding.token}` },
      },
    );
    assert.equal(slidingHeartbeatResponse.status, 200);
    const slidingHeartbeat = await slidingHeartbeatResponse.json();
    assert.equal(slidingHeartbeat.expiresAt, undefined);
    const renewedSliding = await store.getSessionById(sliding.id);
    assert.ok(renewedSliding);
    assert.ok(renewedSliding.expiresAt > forcedNearExpiry + 10_000);

    const absolute = await fetch(`${gateway.url}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "absolute-session", expiresInMs: 60_000 }),
    }).then((response) => response.json());
    assert.ok(absolute.expiresAt > Date.now());
    const absoluteHeartbeat = await fetch(`${gateway.url}/api/sessions/${absolute.id}/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${absolute.token}` },
    }).then((response) => response.json());
    assert.equal(absoluteHeartbeat.expiresAt, absolute.expiresAt);
  } finally {
    await gateway.close();
  }
});

test("rate limits managed auth exchange before contacting GitHub", async () => {
  const store = new MemoryPreviewGatewayStore();
  let limitChecks = 0;
  let githubRequests = 0;
  const gateway = await createGatewayServer(store, {
    auth: {
      signingSecret: "managed-preview-test-secret-that-is-long-enough",
      githubClientId: "github-client-id",
      rateLimitExchange: (request) => {
        limitChecks += 1;
        assert.equal(request.headers.get("x-forwarded-for"), "203.0.113.8");
        return limitChecks === 1 ? { allowed: true } : { allowed: false, retryAfterMs: 1_250 };
      },
      fetch: async () => {
        githubRequests += 1;
        return Response.json({ id: 42, login: "farm-user" });
      },
    },
  });

  try {
    const exchange = (
      body = JSON.stringify({ provider: "github", accessToken: "provider-token" }),
    ) =>
      fetch(`${gateway.url}/api/auth/exchange`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.8",
        },
        body,
      });

    assert.equal((await exchange()).status, 200);
    const limited = await exchange("not-json");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "2");
    assert.match(await limited.text(), /Too many Farm Preview login attempts/);
    assert.equal(limitChecks, 2);
    assert.equal(githubRequests, 1);
  } finally {
    await gateway.close();
  }
});

test("fails managed auth exchange closed when its rate limiter is unavailable", async () => {
  const store = new MemoryPreviewGatewayStore();
  let githubRequests = 0;
  const gateway = await createGatewayServer(store, {
    auth: {
      signingSecret: "managed-preview-test-secret-that-is-long-enough",
      githubClientId: "github-client-id",
      rateLimitExchange: async (request) => {
        assert.equal(request.bodyUsed, false);
        throw new Error("private redis connection details");
      },
      fetch: async () => {
        githubRequests += 1;
        return Response.json({ id: 42, login: "farm-user" });
      },
    },
  });

  try {
    const response = await fetch(`${gateway.url}/api/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", accessToken: "provider-token" }),
    });

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "1");
    const body = await response.text();
    assert.match(body, /Farm Preview login is temporarily unavailable/);
    assert.ok(!body.includes("private redis connection details"));
    assert.equal(githubRequests, 0);
  } finally {
    await gateway.close();
  }
});

test("shows browser visitors a friendly expired preview page", async () => {
  const deletedSessionIds = [];
  const store = new (class extends MemoryPreviewGatewayStore {
    async deleteSession(session) {
      deletedSessionIds.push(session.id);
      await super.deleteSession(session);
    }
  })();
  const gateway = await createGatewayServer(store);
  const expiredSession = {
    id: "sess_expired",
    name: "finished-demo",
    hostname: "finished-demo.preview.farmjs.dev",
    publicUrl: `${gateway.url}/__preview/finished-demo`,
    token: "expired-token",
    createdAt: Date.now() - 120_000,
    expiresAt: Date.now() - 60_000,
    lastHeartbeatAt: Date.now() - 60_000,
  };

  try {
    await store.createSession(expiredSession, 1);
    assert.deepEqual(deletedSessionIds, []);
    const response = await fetch(`${gateway.url}/__preview/finished-demo`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 410);
    assert.match(await response.text(), /This Farm preview has expired/);
    assert.deepEqual(deletedSessionIds, [expiredSession.id]);
    assert.equal(await store.getSessionById(expiredSession.id), undefined);
  } finally {
    await gateway.close();
  }
});

async function createGatewayServer(store, options = {}) {
  const handler = createNodePreviewGatewayHandler({
    store,
    domain: "preview.farmjs.dev",
    requestTimeoutMs: 2000,
    pollTimeoutMs: 1000,
    pollIntervalMs: 10,
    ...options,
  });
  const server = createServer(handler);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://localhost:${address.port}`,
    handler,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function requestWithHeaders(value, headers) {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString(),
            headers: response.headers,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}
