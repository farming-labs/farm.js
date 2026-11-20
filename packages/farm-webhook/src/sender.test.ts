import { afterEach, expect, it, vi } from "vitest";
import { createWebhook, createWebhookSender } from "./sender";
const url = "https://app.example/api/inbox/fixture";
const sendKey = "fws_" + "a".repeat(43);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shares a single token exchange across concurrent sends, then renews before expiry", async () => {
  vi.useFakeTimers();
  const requests: { url: string; auth: string }[] = [];
  let exchanges = 0;
  vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
    const auth = new Headers(options.headers).get("authorization")!;
    requests.push({ url: url.href, auth });
    expect(options.redirect).toBe("error");
    if (url.pathname.endsWith("/token"))
      return Response.json({
        token: "short-" + ++exchanges,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });
    return Response.json({ id: "accepted" }, { status: 202 });
  });
  const sender = createWebhookSender({ url, sendKey });
  await Promise.all([sender.send({ n: 1 }), sender.send({ n: 2 })]);
  expect(exchanges).toBe(1);
  expect(requests.filter((r) => r.url === url).map((r) => r.auth)).toEqual([
    "Bearer short-1",
    "Bearer short-1",
  ]);
  vi.setSystemTime(Date.now() + 890000);
  await sender.send({ n: 3 });
  expect(exchanges).toBe(2);
  expect(requests.at(-1)?.auth).toBe("Bearer short-2");
});

it("sends directly in one call and refuses plaintext transport", async () => {
  const fetch = vi.fn(async () => Response.json({ id: "ok" }, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  await createWebhookSender({ url, sendKey, auth: "direct" }).send(
    { x: 1 },
    { idempotencyKey: "stock-1" },
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    new URL(url),
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer " + sendKey,
        "idempotency-key": "stock-1",
      }),
    }),
  );
  expect(() => createWebhookSender({ url: "http://shop.example/hook", sendKey })).toThrow("HTTPS");
});

it("resolves a named receiver on first send and shares its short-lived credential", async () => {
  const calls: { path: string; key: string | null }[] = [];
  const fetcher = vi.fn(async (target: URL, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({ path: target.pathname, key: headers.get("authorization") });
    if (target.pathname === "/api/inbox/receivers") {
      expect(target.searchParams.get("intent")).toBe("send");
      expect(headers.get("x-farm-project")).toBe("proj_demo");
      return Response.json({
        url,
        token: "test-receiver-token",
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });
    }
    return Response.json({ id: "receipt" }, { status: 202 });
  });
  vi.stubGlobal("fetch", fetcher);
  const sender = createWebhook({
    apiKey: "test-project-key",
    project: "proj_demo",
    environment: "development",
    infraOrigin: "https://app.example",
    name: "stock",
    destination: "https://shop.example/api/stock",
    verification: { mode: "bearer", deliverySecret: "fixture-secret" },
  });
  expect(fetcher).not.toHaveBeenCalled();
  await Promise.all([sender.send({ n: 1 }), sender.send({ n: 2 })]);
  expect(calls).toEqual([
    { path: "/api/inbox/receivers", key: "Bearer test-project-key" },
    { path: "/api/inbox/fixture", key: "Bearer test-receiver-token" },
    { path: "/api/inbox/fixture", key: "Bearer test-receiver-token" },
  ]);
});
