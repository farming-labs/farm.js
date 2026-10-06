import assert from "node:assert/strict";
import test from "node:test";
import { createInfraPreviewIntegration } from "../lib/infra.ts";

const env = {
  FARM_INFRA_URL: "https://infra.example.com",
  FARM_PREVIEW_GATEWAY_SECRET: "fixture-only-backchannel-secret-at-least-32-bytes",
};

test("access checks send only verified grant metadata and reject incomplete or unavailable authority", async () => {
  let status = 200;
  const calls: Record<string, unknown>[] = [];
  const integration = createInfraPreviewIntegration(env, (async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ allowed: true }, { status });
  }) as typeof fetch)!;
  const session = { id: "session", name: "store", ownerId: "device:owner", project: "store", keyId: "key_ci", grantId: "grant_one", expiresAt: Date.now() + 60_000 };
  assert.equal(await integration.authorizeSession(session), true);
  assert.deepEqual(calls[0], { userId: "owner", project: "store", keyId: "key_ci", grantId: "grant_one", expiresAt: session.expiresAt });
  assert.equal(await integration.authorizeSession({ ...session, grantId: undefined }), false);
  assert.equal(await integration.authorizeSession({ ...session, ownerId: "github:owner" }), false);
  status = 403;
  assert.equal(await integration.authorizeSession(session), false);
  status = 503;
  await assert.rejects(integration.authorizeSession(session), /unavailable/);
});

test("Infra backchannel requires a safe origin and a separate secret", () => {
  assert.equal(createInfraPreviewIntegration({}), undefined);
  for (const FARM_INFRA_URL of [
    "http://public.example.com",
    "https://user:pass@infra.example.com",
    "https://infra.example.com/path",
    "https://infra.example.com?token=secret",
  ])
    assert.throws(() => createInfraPreviewIntegration({ ...env, FARM_INFRA_URL }));
  assert.throws(() =>
    createInfraPreviewIntegration({ ...env, FARM_PREVIEW_GATEWAY_SECRET: "short" }),
  );
});

test("account verification uses the private backchannel and fails closed", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let status = 200;
  const integration = createInfraPreviewIntegration(env, (async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      status === 200
        ? { subject: "owner", login: "Farm Infra" }
        : { error: "private provider detail" },
      { status },
    );
  }) as typeof fetch)!;
  assert.deepEqual(await integration.deviceAuth.authorizeAccount("farmjs_fixture"), {
    subject: "owner",
    login: "Farm Infra",
  });
  assert.equal(calls[0].url, "https://infra.example.com/api/previews/identity");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer farmjs_fixture");
  assert.equal(
    new Headers(calls[0].init?.headers).get("x-farm-gateway-token"),
    env.FARM_PREVIEW_GATEWAY_SECRET,
  );
  assert.equal(calls[0].init?.redirect, "error");
  status = 401;
  assert.equal(await integration.deviceAuth.authorizeAccount("revoked"), null);
  status = 503;
  await assert.rejects(
    integration.deviceAuth.authorizeAccount("credential"),
    /Farm Infra authentication unavailable/,
  );
});

test("activity delivery stays ordered, throttles heartbeats, and retries session races", async () => {
  const work: Promise<unknown>[] = [];
  const payloads: Record<string, unknown>[] = [];
  let attempts = 0;
  const integration = createInfraPreviewIntegration(
    env,
    (async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      return new Response(null, {
        status: payload.type === "request" && attempts++ === 0 ? 409 : 200,
      });
    }) as typeof fetch,
    (promise) => work.push(promise),
  )!;
  const observer = integration.observer("websocket");
  const at = Date.now();
  const event = {
    id: "session",
    name: "docs",
    ownerId: "device:owner",
    publicUrl: "https://docs.preview.example.com",
    expiresAt: at + 60000,
    state: "connected" as const,
    at,
  };
  observer.session?.(event);
  observer.session?.({ ...event, at: at + 1000 });
  observer.request?.({
    sessionId: event.id,
    method: "GET",
    path: "/docs",
    status: 200,
    durationMs: 12,
    at,
  });
  await Promise.all(work);
  assert.deepEqual(
    payloads.map((p) => p.type),
    ["session", "request", "request"],
  );
  assert.equal(payloads[0].userId, "owner");
  assert.equal(payloads[0].ownerId, undefined);
  assert.equal(payloads[0].transport, "websocket");
  assert.equal(payloads[1].id, payloads[2].id);
  assert.ok(!JSON.stringify(payloads).includes(env.FARM_PREVIEW_GATEWAY_SECRET));
});
